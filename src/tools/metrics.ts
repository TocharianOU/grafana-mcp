import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit } from "../utils/token-limiter.js";

/**
 * Prometheus tools.
 *
 * All queries are proxied through Grafana's datasource proxy so credentials
 * and TLS are handled by Grafana:
 *   GET /api/datasources/proxy/uid/<uid>/api/v1/query
 *   GET /api/datasources/proxy/uid/<uid>/api/v1/query_range
 *   GET /api/datasources/proxy/uid/<uid>/api/v1/label/__name__/values
 */
export function registerMetricsTools(
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
  // Tool 5: query_prometheus
  // -------------------------------------------------------------------------
  tool(
    "query_prometheus",
    "Execute an instant PromQL query against a Prometheus datasource via Grafana's proxy. Returns the current metric value at a point in time. Use for checking current state (e.g. 'up', 'rate(http_requests_total[5m])'). Get the datasource UID from list_datasources (via execute_grafana_api GET /api/datasources) or get_dashboard_panel_queries.",
    {
      datasourceUid: z.string().min(1).describe("UID of the Prometheus datasource"),
      expr: z.string().min(1).describe("PromQL expression to evaluate"),
      time: z
        .string()
        .optional()
        .describe("Evaluation time as RFC3339 or Unix seconds (default: now)"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Bypass token limits for large results."),
    },
    async (args) => {
      const { datasourceUid, expr, time, break_token_rule } = args as {
        datasourceUid: string;
        expr: string;
        time?: string;
        break_token_rule: boolean;
      };
      try {
        const params: Record<string, string | undefined> = { query: expr };
        if (time) params.time = time;

        const result = await client.get<unknown>(
          `/api/datasources/proxy/uid/${datasourceUid}/api/v1/query`,
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
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 6: query_prometheus_range
  // -------------------------------------------------------------------------
  tool(
    "query_prometheus_range",
    "Execute a range PromQL query against a Prometheus datasource via Grafana's proxy. Returns time-series values over a window. Use for trend analysis and graphing. Step controls resolution (e.g. '15s', '1m', '5m').",
    {
      datasourceUid: z.string().min(1).describe("UID of the Prometheus datasource"),
      expr: z.string().min(1).describe("PromQL expression to evaluate"),
      start: z
        .string()
        .describe("Start time — RFC3339 (e.g. '2024-01-01T00:00:00Z') or Unix seconds"),
      end: z
        .string()
        .describe("End time — RFC3339 or Unix seconds"),
      step: z
        .string()
        .describe("Resolution step (e.g. '15s', '1m', '5m', '60')"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Bypass token limits for large results."),
    },
    async (args) => {
      const { datasourceUid, expr, start, end, step, break_token_rule } = args as {
        datasourceUid: string;
        expr: string;
        start: string;
        end: string;
        step: string;
        break_token_rule: boolean;
      };
      try {
        const result = await client.get<unknown>(
          `/api/datasources/proxy/uid/${datasourceUid}/api/v1/query_range`,
          { query: expr, start, end, step }
        );
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
  // Bonus: list_prometheus_metric_names (lightweight discovery, small result)
  // -------------------------------------------------------------------------
  tool(
    "list_prometheus_metric_names",
    "List all available metric names in a Prometheus datasource. Use this to discover what metrics exist before writing PromQL queries. Optionally filter with a regex pattern.",
    {
      datasourceUid: z.string().min(1).describe("UID of the Prometheus datasource"),
      match: z
        .string()
        .optional()
        .describe("Optional regex filter (e.g. 'http_.*', 'node_cpu')"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Bypass token limits for large results."),
    },
    async (args) => {
      const { datasourceUid, match, break_token_rule } = args as {
        datasourceUid: string;
        match?: string;
        break_token_rule: boolean;
      };
      try {
        const params: Record<string, string | undefined> = {};
        if (match) params.match = match;

        const result = await client.get<unknown>(
          `/api/datasources/proxy/uid/${datasourceUid}/api/v1/label/__name__/values`,
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
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
