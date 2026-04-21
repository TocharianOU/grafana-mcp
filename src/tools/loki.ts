import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit } from "../utils/token-limiter.js";

/**
 * All Loki API calls are routed through the Grafana datasource proxy:
 *   GET /api/datasources/proxy/uid/<uid>/loki/api/v1/<endpoint>
 *
 * This keeps authentication simple — Grafana adds the Loki auth headers itself.
 */

function lokiBase(datasourceUid: string): string {
  return `/api/datasources/proxy/uid/${datasourceUid}/loki/api/v1`;
}

/** Convert an RFC3339 string to Unix nanoseconds string expected by Loki. */
function toNanos(rfc3339: string): string {
  return String(new Date(rfc3339).getTime() * 1_000_000);
}

/** Default time range helpers. */
function defaultStart(): string {
  return new Date(Date.now() - 3_600_000).toISOString();
}

function defaultEnd(): string {
  return new Date().toISOString();
}

export function registerLokiTools(
  server: McpServer,
  client: GrafanaClient,
  maxTokenCall: number
) {
  const tool = (server as unknown as {
    tool: (
      name: string,
      desc: string,
      schema: unknown,
      handler: (args: unknown) => Promise<unknown>
    ) => void;
  }).tool.bind(server);

  // Tool: list_loki_label_names
  tool(
    "list_loki_label_names",
    "List all available label names (keys) found in logs within a Loki datasource for the given time range. Returns an array of label name strings (e.g. [\"app\", \"env\", \"pod\"]). Use this before writing LogQL queries to discover available labels for stream selectors.",
    {
      datasourceUid: z
        .string()
        .min(1)
        .describe("The UID of the Loki datasource to query"),
      start: z
        .string()
        .optional()
        .describe(
          "Start of the time range as RFC3339 (default: 1 hour ago)"
        ),
      end: z
        .string()
        .optional()
        .describe("End of the time range as RFC3339 (default: now)"),
    },
    async (args) => {
      const { datasourceUid, start, end } = args as {
        datasourceUid: string;
        start?: string;
        end?: string;
      };
      try {
        const params: Record<string, string | undefined> = {
          start: toNanos(start ?? defaultStart()),
          end: toNanos(end ?? defaultEnd()),
        };
        const result = await client.get<unknown>(
          `${lokiBase(datasourceUid)}/labels`,
          params
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: list_loki_label_values
  tool(
    "list_loki_label_values",
    "Retrieve all unique values for a specific label name in a Loki datasource. For example, querying label 'env' might return ['prod', 'staging', 'dev']. Use list_loki_label_names first to discover available labels.",
    {
      datasourceUid: z
        .string()
        .min(1)
        .describe("The UID of the Loki datasource to query"),
      labelName: z
        .string()
        .min(1)
        .describe(
          "The label name to retrieve values for (e.g. 'app', 'env', 'pod', 'namespace')"
        ),
      start: z
        .string()
        .optional()
        .describe("Start of the time range as RFC3339 (default: 1 hour ago)"),
      end: z
        .string()
        .optional()
        .describe("End of the time range as RFC3339 (default: now)"),
    },
    async (args) => {
      const { datasourceUid, labelName, start, end } = args as {
        datasourceUid: string;
        labelName: string;
        start?: string;
        end?: string;
      };
      try {
        const params: Record<string, string | undefined> = {
          start: toNanos(start ?? defaultStart()),
          end: toNanos(end ?? defaultEnd()),
        };
        const result = await client.get<unknown>(
          `${lokiBase(datasourceUid)}/label/${encodeURIComponent(labelName)}/values`,
          params
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: query_loki_logs
  tool(
    "query_loki_logs",
    "Execute a LogQL query against a Loki datasource via Grafana's datasource proxy. Supports log stream queries (e.g. '{app=\"nginx\"} |= \"error\"') and metric queries (e.g. 'rate({app=\"nginx\"}[5m])'). Use 'range' queryType for time-series results and 'instant' for current-point-in-time values. Returns log lines with timestamps, stream labels, and optional parsed/structured metadata.",
    {
      datasourceUid: z
        .string()
        .min(1)
        .describe("The UID of the Loki datasource to query"),
      logql: z
        .string()
        .min(1)
        .describe(
          "The LogQL expression to execute. Examples: '{app=\"nginx\"} |= \"error\"' (log filter), 'rate({app=\"nginx\"}[5m])' (metric query), '{namespace=\"prod\"} | json | level=\"error\"' (JSON parser with filter)"
        ),
      start: z
        .string()
        .optional()
        .describe("Start time as RFC3339 (default: 1 hour ago)"),
      end: z
        .string()
        .optional()
        .describe("End time as RFC3339 (default: now)"),
      limit: z
        .number()
        .optional()
        .default(100)
        .describe(
          "Maximum number of log lines to return for log stream queries (default: 100, max: 5000)"
        ),
      direction: z
        .enum(["forward", "backward"])
        .optional()
        .default("backward")
        .describe(
          "'backward' returns newest logs first (default), 'forward' returns oldest first"
        ),
      queryType: z
        .enum(["range", "instant"])
        .optional()
        .default("range")
        .describe(
          "'range' returns results over the time window (default), 'instant' returns a single value at the end time"
        ),
      step: z
        .number()
        .optional()
        .describe(
          "Resolution step in seconds for metric range queries (e.g. 60 for 1-minute resolution)"
        ),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations."),
    },
    async (args) => {
      const {
        datasourceUid,
        logql,
        start,
        end,
        limit,
        direction,
        queryType,
        step,
        break_token_rule,
      } = args as {
        datasourceUid: string;
        logql: string;
        start?: string;
        end?: string;
        limit: number;
        direction: "forward" | "backward";
        queryType: "range" | "instant";
        step?: number;
        break_token_rule: boolean;
      };

      try {
        const startStr = start ?? defaultStart();
        const endStr = end ?? defaultEnd();
        const params: Record<string, string | number | undefined> = {
          query: logql,
        };

        if (queryType === "instant") {
          // Instant query uses /query endpoint with single time param (Unix seconds)
          params.time = Math.floor(new Date(endStr).getTime() / 1000);
          const result = await client.get<unknown>(
            `${lokiBase(datasourceUid)}/query`,
            params
          );
          const content = {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
          const tokenCheck = checkTokenLimit(content, maxTokenCall, break_token_rule);
          if (!tokenCheck.allowed) {
            return { content: [{ type: "text" as const, text: tokenCheck.error ?? "Token limit exceeded" }], isError: true };
          }
          return content;
        } else {
          // Range query uses /query_range with start/end in nanoseconds
          params.start = toNanos(startStr);
          params.end = toNanos(endStr);
          params.limit = Math.min(limit, 5000);
          params.direction = direction;
          if (step !== undefined) params.step = step;

          const result = await client.get<unknown>(
            `${lokiBase(datasourceUid)}/query_range`,
            params
          );
          const content = {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
          const tokenCheck = checkTokenLimit(content, maxTokenCall, break_token_rule);
          if (!tokenCheck.allowed) {
            return { content: [{ type: "text" as const, text: tokenCheck.error ?? "Token limit exceeded" }], isError: true };
          }
          return content;
        }
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: query_loki_stats
  tool(
    "query_loki_stats",
    "Get index statistics for a Loki stream selector, showing the number of log streams, chunks, entries, and total bytes stored. Use this to verify that log streams exist before running a full query, or to understand log volume.",
    {
      datasourceUid: z
        .string()
        .min(1)
        .describe("The UID of the Loki datasource to query"),
      query: z
        .string()
        .min(1)
        .describe(
          "A LogQL stream selector (e.g. '{app=\"nginx\"}', '{namespace=\"prod\", level=\"error\"}') — must be a label matcher, not a full pipeline query"
        ),
      start: z
        .string()
        .optional()
        .describe("Start time as RFC3339 (default: 1 hour ago)"),
      end: z
        .string()
        .optional()
        .describe("End time as RFC3339 (default: now)"),
    },
    async (args) => {
      const { datasourceUid, query, start, end } = args as {
        datasourceUid: string;
        query: string;
        start?: string;
        end?: string;
      };
      try {
        const params: Record<string, string | undefined> = {
          query,
          start: toNanos(start ?? defaultStart()),
          end: toNanos(end ?? defaultEnd()),
        };
        const result = await client.get<unknown>(
          `${lokiBase(datasourceUid)}/index/stats`,
          params
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: list_loki_series
  tool(
    "list_loki_series",
    "List all log streams (time series) matching a LogQL stream selector in Loki. Returns the unique label sets that match the selector within the time range. Useful for discovering what instances, pods, or services are actively producing logs.",
    {
      datasourceUid: z
        .string()
        .min(1)
        .describe("The UID of the Loki datasource to query"),
      match: z
        .string()
        .min(1)
        .describe(
          "A LogQL stream selector to match (e.g. '{app=\"nginx\"}', '{namespace=\"prod\"}')"
        ),
      start: z
        .string()
        .optional()
        .describe("Start time as RFC3339 (default: 1 hour ago)"),
      end: z
        .string()
        .optional()
        .describe("End time as RFC3339 (default: now)"),
    },
    async (args) => {
      const { datasourceUid, match, start, end } = args as {
        datasourceUid: string;
        match: string;
        start?: string;
        end?: string;
      };
      try {
        const params: Record<string, string | undefined> = {
          "match[]": match,
          start: toNanos(start ?? defaultStart()),
          end: toNanos(end ?? defaultEnd()),
        };
        const result = await client.get<unknown>(
          `${lokiBase(datasourceUid)}/series`,
          params
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: list_loki_log_patterns
  tool(
    "list_loki_log_patterns",
    "Detect recurring log patterns in a Loki datasource using the Loki patterns API (requires Loki >= 2.9). Returns recognized patterns with their occurrence counts, helping identify common error templates or recurring events without reading every log line.",
    {
      datasourceUid: z
        .string()
        .min(1)
        .describe("The UID of the Loki datasource to query"),
      query: z
        .string()
        .min(1)
        .describe("A LogQL stream selector (e.g. '{app=\"nginx\"}')"),
      start: z
        .string()
        .optional()
        .describe("Start time as RFC3339 (default: 1 hour ago)"),
      end: z
        .string()
        .optional()
        .describe("End time as RFC3339 (default: now)"),
    },
    async (args) => {
      const { datasourceUid, query, start, end } = args as {
        datasourceUid: string;
        query: string;
        start?: string;
        end?: string;
      };
      try {
        const params: Record<string, string | undefined> = {
          query,
          start: toNanos(start ?? defaultStart()),
          end: toNanos(end ?? defaultEnd()),
        };
        const result = await client.get<unknown>(
          `${lokiBase(datasourceUid)}/patterns`,
          params
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
