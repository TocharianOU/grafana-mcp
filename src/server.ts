import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GrafanaClient } from "./client.js";
import { registerDashboardTools } from "./tools/dashboards.js";
import { registerFolderTools } from "./tools/folders.js";
import { registerDatasourceTools } from "./tools/datasources.js";
import { registerSearchTools } from "./tools/search.js";
import { registerAnnotationTools } from "./tools/annotations.js";
import { registerAlertingTools } from "./tools/alerting.js";
import { registerPrometheusTools } from "./tools/prometheus.js";
import { registerAdminTools } from "./tools/admin.js";

const ConfigSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Grafana URL cannot be empty")
    .describe("Grafana server URL"),
  token: z
    .string()
    .optional()
    .describe("Grafana Service Account Token for authentication"),
  username: z
    .string()
    .optional()
    .describe("Username for Grafana basic authentication"),
  password: z
    .string()
    .optional()
    .describe("Password for Grafana basic authentication"),
  orgId: z
    .number()
    .optional()
    .default(1)
    .describe("Grafana organization ID (defaults to 1)"),
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
    version: "1.0.0",
  });

  registerDashboardTools(server, client, maxTokenCall);
  registerFolderTools(server, client, maxTokenCall);
  registerDatasourceTools(server, client, maxTokenCall);
  registerSearchTools(server, client, maxTokenCall);
  registerAnnotationTools(server, client, maxTokenCall);
  registerAlertingTools(server, client, maxTokenCall);
  registerPrometheusTools(server, client, maxTokenCall);
  registerAdminTools(server, client, maxTokenCall);

  return server;
}
