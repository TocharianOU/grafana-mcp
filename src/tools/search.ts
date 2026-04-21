import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit } from "../utils/token-limiter.js";

export function registerSearchTools(
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

  // Tool: search_dashboards
  tool(
    "search_dashboards",
    "Search Grafana for dashboards and folders using a query string or tags. Returns a list of matching items with their uid, title, type, url, folder info, and tags. Use this to discover dashboards before fetching their full content.",
    {
      query: z
        .string()
        .optional()
        .describe("Search query string to match against dashboard/folder titles"),
      tag: z
        .array(z.string())
        .optional()
        .describe("Filter by tags (all specified tags must match)"),
      type: z
        .enum(["dash-db", "dash-folder"])
        .optional()
        .describe("Filter by type: 'dash-db' for dashboards, 'dash-folder' for folders"),
      folderUids: z
        .array(z.string())
        .optional()
        .describe("Filter results to specific folder UIDs"),
      starred: z
        .boolean()
        .optional()
        .describe("Return only starred dashboards"),
      limit: z
        .number()
        .optional()
        .default(50)
        .describe("Maximum number of results to return (default: 50, max: 5000)"),
      page: z
        .number()
        .optional()
        .default(1)
        .describe("Page number for pagination"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations."),
    },
    async (args) => {
      const { query, tag, type, folderUids, starred, limit, page, break_token_rule } =
        args as {
          query?: string;
          tag?: string[];
          type?: "dash-db" | "dash-folder";
          folderUids?: string[];
          starred?: boolean;
          limit: number;
          page: number;
          break_token_rule: boolean;
        };
      try {
        const params: Record<string, string | number | boolean | undefined> = {
          limit: Math.min(limit, 5000),
          page,
        };
        if (query) params.query = query;
        if (type) params.type = type;
        if (starred !== undefined) params.starred = starred;
        if (tag && tag.length > 0) params.tag = tag.join(",");
        if (folderUids && folderUids.length > 0) {
          params.folderUIDs = folderUids.join(",");
        }

        const result = await client.get<unknown>("/api/search", params);
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
}
