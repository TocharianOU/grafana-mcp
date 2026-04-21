import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit } from "../utils/token-limiter.js";

export function registerPrometheusTools(
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

  // Tool: query_prometheus
  tool(
    "query_prometheus",
    "Execute an instant PromQL query against a Prometheus datasource in Grafana. Returns the current value of a metric at a specific point in time. Use for current state queries like 'up' or rate calculations.",
    {
      datasourceUid: z
        .string()
        .min(1)
        .describe("The UID of the Prometheus datasource to query"),
      expr: z
        .string()
        .min(1)
        .describe("The PromQL expression to evaluate (e.g., 'rate(http_requests_total[5m])')"),
      time: z
        .string()
        .optional()
        .describe(
          "Evaluation timestamp as RFC3339 string or Unix timestamp (e.g., '2024-01-01T00:00:00Z'). Defaults to current time."
        ),
      timeout: z
        .string()
        .optional()
        .describe("Query timeout (e.g., '30s'). Defaults to datasource timeout."),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations."),
    },
    async (args) => {
      const { datasourceUid, expr, time, timeout, break_token_rule } = args as {
        datasourceUid: string;
        expr: string;
        time?: string;
        timeout?: string;
        break_token_rule: boolean;
      };
      try {
        const params: Record<string, string | undefined> = { query: expr };
        if (time) params.time = time;
        if (timeout) params.timeout = timeout;

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
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: query_prometheus_range
  tool(
    "query_prometheus_range",
    "Execute a range PromQL query against a Prometheus datasource in Grafana to get metric values over a time period. Returns a time series result suitable for graph panels. Use for trend analysis and time-series investigations.",
    {
      datasourceUid: z
        .string()
        .min(1)
        .describe("The UID of the Prometheus datasource to query"),
      expr: z
        .string()
        .min(1)
        .describe("The PromQL expression to evaluate"),
      start: z
        .string()
        .describe(
          "Start of the time range as RFC3339 string or Unix timestamp (e.g., '2024-01-01T00:00:00Z' or '1704067200')"
        ),
      end: z
        .string()
        .describe(
          "End of the time range as RFC3339 string or Unix timestamp (e.g., '2024-01-01T01:00:00Z' or '1704070800')"
        ),
      step: z
        .string()
        .describe(
          "Query resolution step width as duration string or float seconds (e.g., '15s', '1m', '60')"
        ),
      timeout: z
        .string()
        .optional()
        .describe("Query timeout (e.g., '30s'). Defaults to datasource timeout."),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations."),
    },
    async (args) => {
      const { datasourceUid, expr, start, end, step, timeout, break_token_rule } =
        args as {
          datasourceUid: string;
          expr: string;
          start: string;
          end: string;
          step: string;
          timeout?: string;
          break_token_rule: boolean;
        };
      try {
        const params: Record<string, string | undefined> = {
          query: expr,
          start,
          end,
          step,
        };
        if (timeout) params.timeout = timeout;

        const result = await client.get<unknown>(
          `/api/datasources/proxy/uid/${datasourceUid}/api/v1/query_range`,
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
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: list_prometheus_metric_names
  tool(
    "list_prometheus_metric_names",
    "List all available metric names in a Prometheus datasource. Use this to discover what metrics are available before constructing PromQL queries.",
    {
      datasourceUid: z
        .string()
        .min(1)
        .describe("The UID of the Prometheus datasource"),
      match: z
        .string()
        .optional()
        .describe("Optional regex pattern to filter metric names (e.g., 'http_.*')"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations."),
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
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: get_prometheus_metric_labels
  tool(
    "get_prometheus_metric_labels",
    "Get all label names available for a specific Prometheus metric. Useful for understanding the dimensions of a metric before writing PromQL queries with label selectors.",
    {
      datasourceUid: z
        .string()
        .min(1)
        .describe("The UID of the Prometheus datasource"),
      metricName: z
        .string()
        .min(1)
        .describe("The metric name to get labels for (e.g., 'http_requests_total')"),
      start: z
        .string()
        .optional()
        .describe("Optional start time for the label query"),
      end: z
        .string()
        .optional()
        .describe("Optional end time for the label query"),
    },
    async (args) => {
      const { datasourceUid, metricName, start, end } = args as {
        datasourceUid: string;
        metricName: string;
        start?: string;
        end?: string;
      };
      try {
        const params: Record<string, string | undefined> = {
          "match[]": `{__name__="${metricName}"}`,
        };
        if (start) params.start = start;
        if (end) params.end = end;

        const result = await client.get<unknown>(
          `/api/datasources/proxy/uid/${datasourceUid}/api/v1/labels`,
          params
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
