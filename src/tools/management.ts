import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";

/**
 * Management tools covering:
 * - Service Accounts & Tokens
 * - Dashboard / Folder Permissions
 * - Library Panels
 * - Plugins
 * - Provisioning reload
 * - RBAC Roles (Grafana Enterprise / Cloud)
 */
export function registerManagementTools(
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

  // -------------------------------------------------------------------------
  // Service Accounts
  // -------------------------------------------------------------------------

  tool(
    "list_service_accounts",
    "List Grafana Service Accounts in the current organization. Service Accounts are used to generate API tokens for programmatic access. Requires Admin role.",
    {
      query: z.string().optional().describe("Filter by service account name"),
      page: z.number().optional().default(1).describe("Page number (default: 1)"),
      perpage: z
        .number()
        .optional()
        .default(100)
        .describe("Results per page (default: 100)"),
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
        const result = await client.get<unknown>("/api/serviceaccounts/search", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  tool(
    "create_service_account",
    "Create a new Grafana Service Account. Returns the created service account including its ID, which is needed to create tokens.",
    {
      name: z.string().min(1).describe("Name of the service account"),
      role: z
        .enum(["Admin", "Editor", "Viewer", "None"])
        .optional()
        .default("Viewer")
        .describe("Organization role for the service account (default: Viewer)"),
    },
    async (args) => {
      const { name, role } = args as { name: string; role: string };
      try {
        const result = await client.post<unknown>("/api/serviceaccounts", { name, role });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  tool(
    "list_service_account_tokens",
    "List all API tokens for a specific Grafana Service Account.",
    {
      serviceAccountId: z
        .number()
        .describe("Numeric ID of the service account"),
    },
    async (args) => {
      const { serviceAccountId } = args as { serviceAccountId: number };
      try {
        const result = await client.get<unknown>(
          `/api/serviceaccounts/${serviceAccountId}/tokens`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  tool(
    "create_service_account_token",
    "Create a new API token for a Grafana Service Account. The token value is only returned once at creation time and cannot be retrieved again.",
    {
      serviceAccountId: z
        .number()
        .describe("Numeric ID of the service account"),
      name: z.string().min(1).describe("Display name for the token"),
      secondsToLive: z
        .number()
        .optional()
        .describe(
          "Token expiry in seconds. Omit or set to 0 for a non-expiring token."
        ),
    },
    async (args) => {
      const { serviceAccountId, name, secondsToLive } = args as {
        serviceAccountId: number;
        name: string;
        secondsToLive?: number;
      };
      try {
        const body: Record<string, unknown> = { name };
        if (secondsToLive !== undefined && secondsToLive > 0) {
          body.secondsToLive = secondsToLive;
        }
        const result = await client.post<unknown>(
          `/api/serviceaccounts/${serviceAccountId}/tokens`,
          body
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  tool(
    "delete_service_account",
    "Delete a Grafana Service Account and all its tokens by ID. This action is irreversible.",
    {
      serviceAccountId: z.number().describe("Numeric ID of the service account to delete"),
    },
    async (args) => {
      const { serviceAccountId } = args as { serviceAccountId: number };
      try {
        const result = await client.delete<unknown>(`/api/serviceaccounts/${serviceAccountId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Dashboard Permissions
  // -------------------------------------------------------------------------

  tool(
    "get_dashboard_permissions",
    "Get the permission list for a specific Grafana dashboard. Returns user, team, and role-based permissions with their access levels.",
    {
      uid: z.string().min(1).describe("The UID of the dashboard"),
    },
    async (args) => {
      const { uid } = args as { uid: string };
      try {
        const result = await client.get<unknown>(`/api/dashboards/uid/${uid}/permissions`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  tool(
    "update_dashboard_permissions",
    "Update the permission list for a Grafana dashboard. Provide the complete list of permissions — this replaces all existing permissions. Each item must specify permissionLevel ('View', 'Edit', or 'Admin') and one of: userId, teamId, or role ('Viewer', 'Editor', 'Admin').",
    {
      uid: z.string().min(1).describe("The UID of the dashboard"),
      items: z
        .array(
          z.object({
            userId: z.number().optional().describe("Numeric user ID"),
            teamId: z.number().optional().describe("Numeric team ID"),
            role: z
              .enum(["Viewer", "Editor", "Admin"])
              .optional()
              .describe("Organization role to assign permissions to"),
            permission: z
              .number()
              .describe("Permission level: 1=View, 2=Edit, 4=Admin"),
          })
        )
        .describe("Complete list of permission items (replaces all existing permissions)"),
    },
    async (args) => {
      const { uid, items } = args as {
        uid: string;
        items: Array<Record<string, unknown>>;
      };
      try {
        const result = await client.post<unknown>(
          `/api/dashboards/uid/${uid}/permissions`,
          { items }
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Folder Permissions
  // -------------------------------------------------------------------------

  tool(
    "get_folder_permissions",
    "Get the permission list for a specific Grafana folder. Returns user, team, and role-based permissions with their access levels.",
    {
      uid: z.string().min(1).describe("The UID of the folder"),
    },
    async (args) => {
      const { uid } = args as { uid: string };
      try {
        const result = await client.get<unknown>(`/api/folders/${uid}/permissions`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  tool(
    "update_folder_permissions",
    "Update the permission list for a Grafana folder. This replaces all existing folder permissions.",
    {
      uid: z.string().min(1).describe("The UID of the folder"),
      items: z
        .array(
          z.object({
            userId: z.number().optional(),
            teamId: z.number().optional(),
            role: z.enum(["Viewer", "Editor", "Admin"]).optional(),
            permission: z.number().describe("Permission level: 1=View, 2=Edit, 4=Admin"),
          })
        )
        .describe("Complete list of permission items"),
    },
    async (args) => {
      const { uid, items } = args as {
        uid: string;
        items: Array<Record<string, unknown>>;
      };
      try {
        const result = await client.post<unknown>(`/api/folders/${uid}/permissions`, { items });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Library Panels
  // -------------------------------------------------------------------------

  tool(
    "list_library_panels",
    "List reusable Grafana Library Panels. Library panels can be shared across multiple dashboards and updated in one place.",
    {
      searchString: z.string().optional().describe("Filter by panel name"),
      folderFilterUIDs: z
        .array(z.string())
        .optional()
        .describe("Filter by folder UIDs"),
      kind: z
        .number()
        .optional()
        .default(1)
        .describe("Element kind: 1=Panel (default)"),
      page: z.number().optional().default(1),
      perPage: z.number().optional().default(100),
    },
    async (args) => {
      const { searchString, folderFilterUIDs, kind, page, perPage } = args as {
        searchString?: string;
        folderFilterUIDs?: string[];
        kind: number;
        page: number;
        perPage: number;
      };
      try {
        const params: Record<string, string | number | undefined> = {
          kind,
          page,
          perPage,
        };
        if (searchString) params.searchString = searchString;
        if (folderFilterUIDs?.length) params.folderFilterUIDs = folderFilterUIDs.join(",");
        const result = await client.get<unknown>("/api/library-elements", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  tool(
    "get_library_panel",
    "Get full details of a Grafana Library Panel by its UID, including the panel JSON definition and list of dashboards that use it.",
    {
      uid: z.string().min(1).describe("The UID of the library panel"),
    },
    async (args) => {
      const { uid } = args as { uid: string };
      try {
        const result = await client.get<unknown>(`/api/library-elements/${uid}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Plugins
  // -------------------------------------------------------------------------

  tool(
    "list_plugins",
    "List all installed Grafana plugins with their id, name, type, version, and enabled status. Use this to discover installed datasource plugins or panel plugins.",
    {
      pluginType: z
        .enum(["datasource", "panel", "app"])
        .optional()
        .describe("Filter by plugin type"),
      enabled: z
        .boolean()
        .optional()
        .describe("Filter by enabled/disabled status"),
    },
    async (args) => {
      const { pluginType, enabled } = args as {
        pluginType?: "datasource" | "panel" | "app";
        enabled?: boolean;
      };
      try {
        const params: Record<string, string | boolean | undefined> = {};
        if (pluginType) params.type = pluginType;
        if (enabled !== undefined) params.enabled = enabled;
        const result = await client.get<unknown>("/api/plugins", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  tool(
    "get_plugin_settings",
    "Get the settings for a specific Grafana plugin by its plugin ID. Returns the plugin's JSON data configuration (excluding secure fields). Useful for retrieving OnCall, IRM, or other app plugin configurations.",
    {
      pluginId: z
        .string()
        .min(1)
        .describe("The plugin ID (e.g. 'grafana-oncall-app', 'grafana-irm-app', 'grafana-incident-app')"),
    },
    async (args) => {
      const { pluginId } = args as { pluginId: string };
      try {
        const result = await client.get<unknown>(`/api/plugins/${pluginId}/settings`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Provisioning reload
  // -------------------------------------------------------------------------

  tool(
    "reload_provisioning",
    "Reload Grafana provisioning configuration from disk. This allows applying changes to provisioned dashboards, datasources, alert rules, or plugins without restarting Grafana. Requires Admin role.",
    {
      type: z
        .enum(["dashboards", "datasources", "alerts", "plugins", "access-control"])
        .describe(
          "Which provisioning type to reload: 'dashboards', 'datasources', 'alerts', 'plugins', or 'access-control'"
        ),
    },
    async (args) => {
      const { type } = args as { type: string };
      try {
        const result = await client.post<unknown>(
          `/api/admin/provisioning/${type}/reload`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result ?? { message: `Provisioning ${type} reloaded successfully` }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // -------------------------------------------------------------------------
  // RBAC Roles (Grafana Enterprise / Cloud)
  // -------------------------------------------------------------------------

  tool(
    "list_roles",
    "List all RBAC roles available in Grafana (requires Grafana Enterprise or Grafana Cloud). Returns built-in and custom roles with their permissions.",
    {
      delegatableOnly: z
        .boolean()
        .optional()
        .default(false)
        .describe("Return only roles that the current user can delegate to others"),
    },
    async (args) => {
      const { delegatableOnly } = args as { delegatableOnly: boolean };
      try {
        const params: Record<string, boolean> = {};
        if (delegatableOnly) params.delegatable = true;
        const result = await client.get<unknown>("/api/access-control/roles", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  tool(
    "list_role_assignments",
    "List all RBAC role assignments in Grafana (requires Grafana Enterprise or Grafana Cloud). Shows which users and teams have been assigned which roles.",
    {},
    async (_args) => {
      try {
        const result = await client.get<unknown>("/api/access-control/role-assignments");
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
