import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GrafanaClient } from "./client.js";
import { registerExecuteApiTool } from "./tools/execute-api.js";
import { registerDashboardTools } from "./tools/dashboards.js";
import { registerPanelQueryTools } from "./tools/panel-queries.js";
import { registerMetricsTools } from "./tools/metrics.js";
import { registerLogsTools } from "./tools/logs.js";

const ConfigSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Grafana URL cannot be empty")
    .describe("Grafana server URL"),
  token: z.string().optional().describe("Grafana Service Account Token"),
  username: z.string().optional().describe("Basic auth username"),
  password: z.string().optional().describe("Basic auth password"),
  orgId: z.number().optional().default(1).describe("Grafana organization ID"),
});

export type GrafanaConfig = z.infer<typeof ConfigSchema>;

export async function createGrafanaMcpServer(config: GrafanaConfig) {
  const validatedConfig = ConfigSchema.parse(config);
  const maxTokenCall = parseInt(process.env.MAX_TOKEN_CALL ?? "20000", 10);

  const client = new GrafanaClient({
    url: validatedConfig.url,
    token: validatedConfig.token,
    username: validatedConfig.username,
    password: validatedConfig.password,
    orgId: validatedConfig.orgId,
  });

  const server = new McpServer({
    name: "grafana-mcp",
    version: "2.0.0",
  });

  // Tool 1: execute_grafana_api   — universal REST executor (covers everything not below)
  registerExecuteApiTool(server, client, maxTokenCall);

  // Tools 2-3: search_dashboards, get_dashboard_summary
  registerDashboardTools(server, client, maxTokenCall);

  // Tools 4-5: get_dashboard_panel_queries, run_panel_query
  registerPanelQueryTools(server, client, maxTokenCall);

  // Tools 6-8: query_prometheus, query_prometheus_range, list_prometheus_metric_names
  registerMetricsTools(server, client, maxTokenCall);

  // Tools 9-11: query_loki_logs, list_loki_label_names, list_loki_label_values
  registerLogsTools(server, client, maxTokenCall);

  return server;
}
