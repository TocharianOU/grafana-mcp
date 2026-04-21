import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit } from "../utils/token-limiter.js";

/**
 * Universal Grafana HTTP API executor.
 *
 * Covers every Grafana REST endpoint not handled by a dedicated tool:
 *   - Folder CRUD  (GET/POST/PUT/DELETE /api/folders/*)
 *   - Datasource CRUD  (/api/datasources/*)
 *   - Annotations  (/api/annotations/*)
 *   - Alerting  (/api/v1/provisioning/*)
 *   - Admin / org / users  (/api/admin/* /api/org /api/users/*)
 *   - Service accounts / permissions / plugins / provisioning
 *   - Library panels, playlists, teams …
 *
 * Grafana API reference: https://grafana.com/docs/grafana/latest/developers/http_api/
 */
export function registerExecuteApiTool(
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

  tool(
    "execute_grafana_api",
    `Execute any Grafana HTTP API endpoint directly. Use this for all operations not covered by dedicated tools.

Common API paths:
  Dashboards  : GET  /api/dashboards/uid/:uid  |  DELETE /api/dashboards/uid/:uid
  Folders     : GET  /api/folders  |  POST /api/folders  |  DELETE /api/folders/:uid
  Datasources : GET  /api/datasources  |  POST /api/datasources  |  DELETE /api/datasources/uid/:uid
  Annotations : GET  /api/annotations  |  POST /api/annotations  |  PATCH /api/annotations/:id
  Alerting    : GET  /api/v1/provisioning/alert-rules  |  POST /api/v1/provisioning/alert-rules
  Contact pts : GET  /api/v1/provisioning/contact-points
  Policies    : GET  /api/v1/provisioning/policies
  Admin/org   : GET  /api/health  |  GET /api/org  |  GET /api/org/users
  Service accs: GET  /api/serviceaccounts/search  |  POST /api/serviceaccounts
  Permissions : GET  /api/dashboards/uid/:uid/permissions  |  POST /api/folders/:uid/permissions
  Plugins     : GET  /api/plugins  |  GET /api/plugins/:id/settings
  Provisioning: POST /api/admin/provisioning/:type/reload
  Library     : GET  /api/library-elements
  Teams       : GET  /api/teams/search
  Playlists   : GET  /api/playlists

Full API reference: https://grafana.com/docs/grafana/latest/developers/http_api/`,
    {
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
        .describe("HTTP method"),
      path: z
        .string()
        .min(1)
        .describe(
          "API path starting with /api/ (e.g. '/api/folders', '/api/dashboards/uid/abc123')"
        ),
      body: z
        .record(z.unknown())
        .optional()
        .describe("Request body for POST/PUT/PATCH requests"),
      params: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe("URL query parameters"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Set to true to bypass token limits for large responses. Use sparingly."
        ),
    },
    async (args) => {
      const { method, path, body, params, break_token_rule } = args as {
        method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
        path: string;
        body?: Record<string, unknown>;
        params?: Record<string, string | number | boolean>;
        break_token_rule: boolean;
      };

      try {
        let result: unknown;

        switch (method) {
          case "GET":
            result = await client.get<unknown>(
              path,
              params as Record<string, string | number | boolean | undefined>
            );
            break;
          case "POST":
            result = await client.post<unknown>(path, body);
            break;
          case "PUT":
            result = await client.put<unknown>(path, body);
            break;
          case "PATCH":
            result = await client.patch<unknown>(path, body);
            break;
          case "DELETE":
            result = await client.delete<unknown>(path);
            break;
        }

        const content = {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };

        const tokenCheck = checkTokenLimit(content, maxTokenCall, break_token_rule);
        if (!tokenCheck.allowed) {
          return {
            content: [
              {
                type: "text" as const,
                text: tokenCheck.error ?? "Token limit exceeded",
              },
            ],
            isError: true,
          };
        }
        return content;
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
