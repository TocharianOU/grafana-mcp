import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit } from "../utils/token-limiter.js";

export function registerDatasourceTools(
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

  // Tool: list_datasources
  tool(
    "list_datasources",
    "List all configured datasources in Grafana. Returns datasource id, uid, name, type, and default status. Use this to discover available datasources and their UIDs before running queries.",
    {
      type: z
        .string()
        .optional()
        .describe(
          "Filter by datasource type (e.g., 'prometheus', 'loki', 'elasticsearch', 'mysql')"
        ),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations."),
    },
    async (args) => {
      const { type, break_token_rule } = args as {
        type?: string;
        break_token_rule: boolean;
      };
      try {
        const datasources = await client.get<Array<Record<string, unknown>>>(
          "/api/datasources"
        );

        const filtered = type
          ? datasources.filter((ds) =>
              String(ds.type ?? "")
                .toLowerCase()
                .includes(type.toLowerCase())
            )
          : datasources;

        const summary = filtered.map((ds) => ({
          id: ds.id,
          uid: ds.uid,
          name: ds.name,
          type: ds.type,
          url: ds.url,
          isDefault: ds.isDefault,
          access: ds.access,
        }));

        const content = {
          content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
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

  // Tool: get_datasource
  tool(
    "get_datasource",
    "Get detailed information about a specific Grafana datasource by UID or name. Returns the full datasource configuration including type, URL, access settings, and JSON data fields.",
    {
      uid: z
        .string()
        .optional()
        .describe("The UID of the datasource. Takes priority over name if both are provided."),
      name: z
        .string()
        .optional()
        .describe("The name of the datasource. Used when UID is not provided."),
    },
    async (args) => {
      const { uid, name } = args as { uid?: string; name?: string };
      if (!uid && !name) {
        return { content: [{ type: "text" as const, text: "Error: either uid or name must be provided" }], isError: true };
      }
      try {
        let result: unknown;
        if (uid) {
          result = await client.get<unknown>(`/api/datasources/uid/${uid}`);
        } else {
          result = await client.get<unknown>(`/api/datasources/name/${encodeURIComponent(name!)}`);
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: create_datasource
  tool(
    "create_datasource",
    "Create a new Grafana datasource. Provide the datasource configuration object with at minimum 'name' and 'type' fields.",
    {
      datasource: z
        .record(z.unknown())
        .describe(
          "The datasource configuration object. Required fields: 'name' (string) and 'type' (string, e.g. 'prometheus', 'loki', 'elasticsearch'). Optional fields: 'url', 'access' ('proxy' or 'direct'), 'isDefault', 'jsonData', 'secureJsonData'."
        ),
    },
    async (args) => {
      const { datasource } = args as { datasource: Record<string, unknown> };
      try {
        const result = await client.post<unknown>("/api/datasources", datasource);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: update_datasource
  tool(
    "update_datasource",
    "Update an existing Grafana datasource configuration by its numeric ID. Provide the complete datasource object including all fields you want to preserve.",
    {
      id: z.number().describe("The numeric ID of the datasource to update"),
      datasource: z
        .record(z.unknown())
        .describe("The complete datasource configuration object with all fields to update"),
    },
    async (args) => {
      const { id, datasource } = args as {
        id: number;
        datasource: Record<string, unknown>;
      };
      try {
        const result = await client.put<unknown>(`/api/datasources/${id}`, datasource);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: delete_datasource
  tool(
    "delete_datasource",
    "Delete a Grafana datasource by its UID. This action is irreversible and may break dashboards that rely on this datasource.",
    {
      uid: z.string().min(1).describe("The UID of the datasource to delete"),
    },
    async (args) => {
      const { uid } = args as { uid: string };
      try {
        const result = await client.delete<unknown>(`/api/datasources/uid/${uid}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
