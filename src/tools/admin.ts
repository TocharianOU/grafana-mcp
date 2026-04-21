import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";

export function registerAdminTools(
  server: McpServer,
  client: GrafanaClient,
  _maxTokenCall: number
) {
  const tool = (server as unknown as {
    tool: (
      name: string,
      desc: string,
      schema: unknown,
      handler: (args: unknown) => Promise<unknown>
    ) => void;
  }).tool.bind(server);

  // Tool: get_health
  tool(
    "get_health",
    "Check the health status of the Grafana instance. Returns database connectivity, version information, and overall health state. Use this to verify connectivity before running other operations.",
    {},
    async (_args) => {
      try {
        const result = await client.get<unknown>("/api/health");
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: get_grafana_stats
  tool(
    "get_grafana_stats",
    "Get Grafana server statistics including counts of dashboards, users, organizations, playlists, and alerts. Requires Admin role.",
    {},
    async (_args) => {
      try {
        const result = await client.get<unknown>("/api/admin/stats");
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: list_organizations
  tool(
    "list_organizations",
    "List all organizations in the Grafana instance. Requires Server Admin role. Returns id, name, and address for each organization.",
    {
      page: z
        .number()
        .optional()
        .default(1)
        .describe("Page number for pagination (default: 1)"),
      perpage: z
        .number()
        .optional()
        .default(1000)
        .describe("Number of organizations per page (default: 1000)"),
    },
    async (args) => {
      const { page, perpage } = args as { page: number; perpage: number };
      try {
        const result = await client.get<unknown>("/api/orgs", { page, perpage });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: get_current_organization
  tool(
    "get_current_organization",
    "Get information about the currently active Grafana organization, including id, name, and address.",
    {},
    async (_args) => {
      try {
        const result = await client.get<unknown>("/api/org");
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: list_users
  tool(
    "list_users",
    "List users in the current Grafana organization. Returns id, login, name, email, and role for each user. Requires Admin or Editor role.",
    {
      page: z
        .number()
        .optional()
        .default(1)
        .describe("Page number for pagination (default: 1)"),
      perpage: z
        .number()
        .optional()
        .default(100)
        .describe("Number of users per page (default: 100, max: 1000)"),
    },
    async (args) => {
      const { page, perpage } = args as { page: number; perpage: number };
      try {
        const result = await client.get<unknown>("/api/org/users", {
          page,
          perpage: Math.min(perpage, 1000),
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: get_user_profile
  tool(
    "get_user_profile",
    "Get the profile of the currently authenticated Grafana user, including id, login, name, email, and role.",
    {},
    async (_args) => {
      try {
        const result = await client.get<unknown>("/api/user");
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: list_teams
  tool(
    "list_teams",
    "List teams in the current Grafana organization. Returns team id, name, email, and member count.",
    {
      query: z
        .string()
        .optional()
        .describe("Filter teams by name"),
      page: z
        .number()
        .optional()
        .default(1)
        .describe("Page number for pagination"),
      perpage: z
        .number()
        .optional()
        .default(100)
        .describe("Number of teams per page (default: 100)"),
    },
    async (args) => {
      const { query, page, perpage } = args as {
        query?: string;
        page: number;
        perpage: number;
      };
      try {
        const params: Record<string, string | number | undefined> = { page, perpage };
        if (query) params.query = query;
        const result = await client.get<unknown>("/api/teams/search", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: list_playlists
  tool(
    "list_playlists",
    "List all Grafana playlists in the current organization. Playlists automatically cycle through a set of dashboards.",
    {
      query: z
        .string()
        .optional()
        .describe("Filter playlists by name"),
    },
    async (args) => {
      const { query } = args as { query?: string };
      try {
        const params: Record<string, string | undefined> = {};
        if (query) params.query = query;
        const result = await client.get<unknown>("/api/playlists", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
