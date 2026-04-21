import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit } from "../utils/token-limiter.js";

/**
 * Loki log query tools.
 *
 * Loki times are Unix nanoseconds when passed as integers.
 * All queries go through Grafana's datasource proxy so auth is transparent.
 */

function toNanos(rfc3339: string): string {
  return String(new Date(rfc3339).getTime() * 1_000_000);
}

function defaultStart(): string {
  return new Date(Date.now() - 3_600_000).toISOString();
}

function defaultEnd(): string {
  return new Date().toISOString();
}

export function registerLogsTools(
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

  // -------------------------------------------------------------------------
  // Tool 7: query_loki_logs
  // -------------------------------------------------------------------------
  tool(
    "query_loki_logs",
    `Execute a LogQL query against a Loki datasource via Grafana's proxy.

Supports both log stream queries and metric queries:
  Log stream : {app="nginx"} |= "error"
  Metric     : rate({app="nginx"}[5m])
  With parser: {namespace="prod"} | json | level="error"

queryType:
  'range'   — time series over the window (default, returns log lines or metric values)
  'instant' — single evaluation at end time (useful for current metric value)

Times are passed as RFC3339 strings; the tool handles nanosecond conversion internally.
Get the datasource UID from execute_grafana_api GET /api/datasources or list_loki_label_names.`,
    {
      datasourceUid: z.string().min(1).describe("UID of the Loki datasource"),
      logql: z
        .string()
        .min(1)
        .describe("LogQL expression to execute"),
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
        .describe("Max log lines for stream queries (default: 100, max: 5000)"),
      direction: z
        .enum(["backward", "forward"])
        .optional()
        .default("backward")
        .describe("'backward' = newest first (default), 'forward' = oldest first"),
      queryType: z
        .enum(["range", "instant"])
        .optional()
        .default("range")
        .describe("'range' for time-series, 'instant' for point-in-time"),
      step: z
        .number()
        .optional()
        .describe("Step in seconds for metric range queries (e.g. 60)"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Bypass token limits for large results."),
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
        direction: "backward" | "forward";
        queryType: "range" | "instant";
        step?: number;
        break_token_rule: boolean;
      };

      const base = `/api/datasources/proxy/uid/${datasourceUid}/loki/api/v1`;

      try {
        let result: unknown;

        if (queryType === "instant") {
          const endStr = end ?? defaultEnd();
          const params: Record<string, string | number> = {
            query: logql,
            time: Math.floor(new Date(endStr).getTime() / 1000),
          };
          result = await client.get<unknown>(`${base}/query`, params);
        } else {
          const params: Record<string, string | number> = {
            query: logql,
            start: toNanos(start ?? defaultStart()),
            end: toNanos(end ?? defaultEnd()),
            limit: Math.min(limit, 5000),
            direction,
          };
          if (step !== undefined) params.step = step;
          result = await client.get<unknown>(`${base}/query_range`, params);
        }

        const content = {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
        const tokenCheck = checkTokenLimit(content, maxTokenCall, break_token_rule);
        if (!tokenCheck.allowed) {
          return { content: [{ type: "text" as const, text: tokenCheck.error ?? "Token limit exceeded" }], isError: true };
        }
        return content;
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 8: list_loki_label_names
  // -------------------------------------------------------------------------
  tool(
    "list_loki_label_names",
    "List all label names (keys) available in a Loki datasource within the given time range. Returns an array like ['app', 'env', 'pod', 'namespace']. Use this to discover what labels exist before writing LogQL stream selectors.",
    {
      datasourceUid: z.string().min(1).describe("UID of the Loki datasource"),
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
      const { datasourceUid, start, end } = args as {
        datasourceUid: string;
        start?: string;
        end?: string;
      };
      try {
        const result = await client.get<unknown>(
          `/api/datasources/proxy/uid/${datasourceUid}/loki/api/v1/labels`,
          {
            start: toNanos(start ?? defaultStart()),
            end: toNanos(end ?? defaultEnd()),
          }
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 9: list_loki_label_values
  // -------------------------------------------------------------------------
  tool(
    "list_loki_label_values",
    "Retrieve all unique values for a specific Loki label name. For example, querying 'env' might return ['prod', 'staging', 'dev']. Use list_loki_label_names first to discover available label names.",
    {
      datasourceUid: z.string().min(1).describe("UID of the Loki datasource"),
      labelName: z
        .string()
        .min(1)
        .describe("Label name to retrieve values for (e.g. 'app', 'namespace', 'pod')"),
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
      const { datasourceUid, labelName, start, end } = args as {
        datasourceUid: string;
        labelName: string;
        start?: string;
        end?: string;
      };
      try {
        const result = await client.get<unknown>(
          `/api/datasources/proxy/uid/${datasourceUid}/loki/api/v1/label/${encodeURIComponent(labelName)}/values`,
          {
            start: toNanos(start ?? defaultStart()),
            end: toNanos(end ?? defaultEnd()),
          }
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
