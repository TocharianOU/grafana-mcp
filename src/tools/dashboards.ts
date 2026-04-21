import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit } from "../utils/token-limiter.js";

export function registerDashboardTools(
  server: McpServer,
  client: GrafanaClient,
  maxTokenCall: number
) {
  // Rebind to avoid TS2589 deep instantiation errors
  const tool = (server as unknown as {
    tool: (
      name: string,
      desc: string,
      schema: unknown,
      handler: (args: unknown) => Promise<unknown>
    ) => void;
  }).tool.bind(server);

  // Tool: get_dashboard_by_uid
  tool(
    "get_dashboard_by_uid",
    "Retrieve a complete Grafana dashboard by its UID, including all panels, variables, annotations, and settings. WARNING: large dashboards consume significant context. Prefer get_dashboard_summary for an overview.",
    {
      uid: z
        .string()
        .min(1)
        .describe("The UID of the dashboard to retrieve"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Set to true to bypass token limits in critical situations. Use sparingly to avoid context overflow."
        ),
    },
    async (args) => {
      const { uid, break_token_rule } = args as {
        uid: string;
        break_token_rule: boolean;
      };
      try {
        const result = await client.get<unknown>(`/api/dashboards/uid/${uid}`);
        const content = { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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

  // Tool: get_dashboard_summary
  tool(
    "get_dashboard_summary",
    "Get a compact summary of a Grafana dashboard including title, panel count, panel types, variables, and time range. Use this before get_dashboard_by_uid to avoid consuming large context windows.",
    {
      uid: z
        .string()
        .min(1)
        .describe("The UID of the dashboard to summarize"),
    },
    async (args) => {
      const { uid } = args as { uid: string };
      try {
        const data = await client.get<{
          dashboard: Record<string, unknown>;
          meta: Record<string, unknown>;
        }>(`/api/dashboards/uid/${uid}`);

        const db = data.dashboard as Record<string, unknown>;
        const panels = (db.panels as Array<Record<string, unknown>>) ?? [];

        const summary = {
          uid,
          title: db.title ?? "",
          description: db.description ?? "",
          tags: db.tags ?? [],
          refresh: db.refresh ?? "",
          timeRange: db.time ?? {},
          panelCount: panels.length,
          panels: panels.map((p) => ({
            id: p.id,
            title: p.title ?? "",
            type: p.type ?? "",
            queryCount: ((p.targets as unknown[]) ?? []).length,
          })),
          variables: ((db.templating as Record<string, unknown>)?.list as Array<Record<string, unknown>> ?? []).map((v) => ({
            name: v.name,
            type: v.type,
            label: v.label ?? "",
          })),
          folderTitle: data.meta?.folderTitle ?? "",
          folderUid: data.meta?.folderUid ?? "",
          version: db.version ?? 0,
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: update_dashboard
  tool(
    "update_dashboard",
    "Create or update a Grafana dashboard. Provide the full dashboard JSON object in the 'dashboard' field. Use 'folderUid' to place it in a specific folder, 'overwrite' to replace an existing dashboard, and 'message' for the version history commit message.",
    {
      dashboard: z
        .record(z.unknown())
        .describe(
          "The full Grafana dashboard JSON object. Must include 'title'. Omit 'id' to create a new dashboard."
        ),
      folderUid: z
        .string()
        .optional()
        .describe("UID of the folder to save the dashboard into"),
      message: z
        .string()
        .optional()
        .describe("Version history commit message"),
      overwrite: z
        .boolean()
        .optional()
        .default(false)
        .describe("Overwrite an existing dashboard with the same UID"),
    },
    async (args) => {
      const { dashboard, folderUid, message, overwrite } = args as {
        dashboard: Record<string, unknown>;
        folderUid?: string;
        message?: string;
        overwrite: boolean;
      };
      try {
        const body: Record<string, unknown> = { dashboard, overwrite };
        if (folderUid) body.folderUid = folderUid;
        if (message) body.message = message;

        const result = await client.post<unknown>("/api/dashboards/db", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: delete_dashboard
  tool(
    "delete_dashboard",
    "Delete a Grafana dashboard by its UID. This action is irreversible.",
    {
      uid: z.string().min(1).describe("The UID of the dashboard to delete"),
    },
    async (args) => {
      const { uid } = args as { uid: string };
      try {
        const result = await client.delete<unknown>(`/api/dashboards/uid/${uid}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: get_dashboard_versions
  tool(
    "get_dashboard_versions",
    "List the version history of a Grafana dashboard. Returns version metadata including who made changes and the commit message.",
    {
      uid: z.string().min(1).describe("The UID of the dashboard"),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("Maximum number of versions to return (default: 20)"),
    },
    async (args) => {
      const { uid, limit } = args as { uid: string; limit: number };
      try {
        const data = await client.get<{ id: number }>(`/api/dashboards/uid/${uid}`);
        const dashId = (data as unknown as { dashboard: { id: number } }).dashboard.id;
        const result = await client.get<unknown>(`/api/dashboards/id/${dashId}/versions`, { limit });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
