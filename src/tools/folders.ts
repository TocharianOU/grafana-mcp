import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";

export function registerFolderTools(
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

  // Tool: list_folders
  tool(
    "list_folders",
    "List all Grafana folders. Returns folder id, uid, title, and parent information. Use this to discover available folders when organizing dashboards.",
    {
      limit: z
        .number()
        .optional()
        .default(100)
        .describe("Maximum number of folders to return (default: 100, max: 1000)"),
      page: z
        .number()
        .optional()
        .default(1)
        .describe("Page number for pagination (default: 1)"),
      parentUid: z
        .string()
        .optional()
        .describe("Filter by parent folder UID to list subfolders"),
    },
    async (args) => {
      const { limit, page, parentUid } = args as {
        limit: number;
        page: number;
        parentUid?: string;
      };
      try {
        const result = await client.get<unknown>("/api/folders", {
          limit: Math.min(limit, 1000),
          page,
          parentUid,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: get_folder_by_uid
  tool(
    "get_folder_by_uid",
    "Get detailed information about a specific Grafana folder by its UID, including its title, parent folder, and permissions.",
    {
      uid: z.string().min(1).describe("The UID of the folder to retrieve"),
    },
    async (args) => {
      const { uid } = args as { uid: string };
      try {
        const result = await client.get<unknown>(`/api/folders/${uid}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: create_folder
  tool(
    "create_folder",
    "Create a new Grafana folder. Optionally specify a UID and a parent folder UID for nested folders.",
    {
      title: z.string().min(1).describe("The display title of the folder"),
      uid: z
        .string()
        .optional()
        .describe("Optional custom UID for the folder. Grafana generates one if omitted."),
      parentUid: z
        .string()
        .optional()
        .describe("Optional parent folder UID to create a subfolder"),
    },
    async (args) => {
      const { title, uid, parentUid } = args as {
        title: string;
        uid?: string;
        parentUid?: string;
      };
      try {
        const body: Record<string, unknown> = { title };
        if (uid) body.uid = uid;
        if (parentUid) body.parentUid = parentUid;

        const result = await client.post<unknown>("/api/folders", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: update_folder
  tool(
    "update_folder",
    "Update an existing Grafana folder's title or move it to a different parent folder.",
    {
      uid: z.string().min(1).describe("The UID of the folder to update"),
      title: z.string().min(1).describe("New title for the folder"),
      version: z
        .number()
        .optional()
        .describe("Current folder version for optimistic locking"),
      overwrite: z
        .boolean()
        .optional()
        .default(false)
        .describe("Overwrite without version check"),
    },
    async (args) => {
      const { uid, title, version, overwrite } = args as {
        uid: string;
        title: string;
        version?: number;
        overwrite: boolean;
      };
      try {
        const body: Record<string, unknown> = { title, overwrite };
        if (version !== undefined) body.version = version;

        const result = await client.put<unknown>(`/api/folders/${uid}`, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: delete_folder
  tool(
    "delete_folder",
    "Delete a Grafana folder by its UID. This will also delete all dashboards and subfolders contained within it. This action is irreversible.",
    {
      uid: z.string().min(1).describe("The UID of the folder to delete"),
    },
    async (args) => {
      const { uid } = args as { uid: string };
      try {
        const result = await client.delete<unknown>(`/api/folders/${uid}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
