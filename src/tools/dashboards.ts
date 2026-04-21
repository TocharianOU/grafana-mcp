import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit, calculateTokens } from "../utils/token-limiter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchHit {
  uid?: string;
  id?: number;
  title?: string;
  type?: string;
  url?: string;
  folderTitle?: string;
  folderUid?: string;
  tags?: string[];
}

interface FolderGroup {
  folder: string;
  count: number;
  dashboards: string[];
}

interface SearchSummary {
  total: number;
  dashboards: number;
  folders: number;
  folderGroups: FolderGroup[];
  topTags: Array<{ tag: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Summary generators
// ---------------------------------------------------------------------------

function buildSearchSummary(hits: SearchHit[]): SearchSummary {
  const dashboards = hits.filter((h) => h.type !== "dash-folder");
  const folders = hits.filter((h) => h.type === "dash-folder");

  const folderMap = new Map<string, string[]>();
  for (const h of dashboards) {
    const folder = h.folderTitle ?? "(General)";
    if (!folderMap.has(folder)) folderMap.set(folder, []);
    folderMap.get(folder)!.push(h.title ?? "");
  }

  const folderGroups: FolderGroup[] = [];
  for (const [folder, dbs] of folderMap.entries()) {
    folderGroups.push({ folder, count: dbs.length, dashboards: dbs.slice(0, 5) });
  }
  folderGroups.sort((a, b) => b.count - a.count);

  const tagCount = new Map<string, number>();
  for (const h of hits) {
    for (const t of h.tags ?? []) {
      tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
  }
  const topTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  return {
    total: hits.length,
    dashboards: dashboards.length,
    folders: folders.length,
    folderGroups,
    topTags,
  };
}

function formatSearchSummaryFull(s: SearchSummary): string {
  let text = `Search Results: ${s.total} items (${s.dashboards} dashboards, ${s.folders} folders)\n\n`;
  text += `By Folder:\n`;
  for (const g of s.folderGroups) {
    text += `  ${g.folder} (${g.count}): ${g.dashboards.join(", ")}`;
    if (g.count > 5) text += ` … +${g.count - 5} more`;
    text += "\n";
  }
  if (s.topTags.length > 0) {
    text += `\nTop Tags: ${s.topTags.map((t) => `${t.tag}(${t.count})`).join(", ")}\n`;
  }
  return text;
}

function formatSearchSummaryCompact(s: SearchSummary, topN: number): string {
  let text = `Search Results: ${s.total} items (${s.dashboards} dashboards, ${s.folders} folders)\n`;
  text += `Top ${topN} folders: `;
  text += s.folderGroups
    .slice(0, topN)
    .map((g) => `${g.folder}(${g.count})`)
    .join(", ");
  text += "\n";
  if (s.topTags.length > 0) {
    text += `Tags: ${s.topTags
      .slice(0, 5)
      .map((t) => t.tag)
      .join(", ")}\n`;
  }
  return text;
}

function formatSearchSummaryMinimal(s: SearchSummary): string {
  return `${s.total} items found (${s.dashboards} dashboards, ${s.folders} folders across ${s.folderGroups.length} folders).\n`;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerDashboardTools(
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

  // -------------------------------------------------------------------------
  // Tool 1: search_dashboards
  // -------------------------------------------------------------------------
  tool(
    "search_dashboards",
    "Search Grafana for dashboards and folders by title, tag, or folder. This is the primary entry point for any Grafana investigation — use it first to discover relevant dashboards. For large result sets the tool automatically switches to a smart summary view to save context tokens, similar to how the Elasticsearch MCP handles large index sets. Use summary_mode to control the level of detail.",
    {
      query: z
        .string()
        .optional()
        .describe("Search query to match against dashboard/folder titles"),
      tag: z
        .array(z.string())
        .optional()
        .describe("Filter by one or more tags (all must match)"),
      type: z
        .enum(["dash-db", "dash-folder"])
        .optional()
        .describe("'dash-db' for dashboards only, 'dash-folder' for folders only"),
      folderUids: z
        .array(z.string())
        .optional()
        .describe("Restrict search to specific folder UIDs"),
      starred: z.boolean().optional().describe("Return only starred dashboards"),
      limit: z
        .number()
        .optional()
        .default(100)
        .describe("Maximum results (default: 100, max: 5000)"),
      summary_mode: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Return a grouped summary instead of full list. Auto-enabled for >50 results."
        ),
      summary_level: z
        .enum(["auto", "full", "compact", "minimal"])
        .optional()
        .default("auto")
        .describe(
          "Summary detail: auto (intelligent by size), full (all folders), compact (top folders), minimal (counts only)"
        ),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Bypass token limits for large result sets."),
    },
    async (args) => {
      const {
        query,
        tag,
        type,
        folderUids,
        starred,
        limit,
        summary_mode,
        summary_level,
        break_token_rule,
      } = args as {
        query?: string;
        tag?: string[];
        type?: "dash-db" | "dash-folder";
        folderUids?: string[];
        starred?: boolean;
        limit: number;
        summary_mode: boolean;
        summary_level: "auto" | "full" | "compact" | "minimal";
        break_token_rule: boolean;
      };

      try {
        const params: Record<string, string | number | boolean | undefined> = {
          limit: Math.min(limit, 5000),
        };
        if (query) params.query = query;
        if (type) params.type = type;
        if (starred) params.starred = true;
        if (tag?.length) params.tag = tag.join(",");
        if (folderUids?.length) params.folderUIDs = folderUids.join(",");

        const hits = await client.get<SearchHit[]>("/api/search", params);

        const AUTO_SUMMARY_THRESHOLD = 50;
        const useSummary = summary_mode || hits.length > AUTO_SUMMARY_THRESHOLD;

        if (!useSummary) {
          const content = {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(hits, null, 2),
              },
            ],
          };
          const tokenCheck = checkTokenLimit(content, maxTokenCall, break_token_rule);
          if (!tokenCheck.allowed) {
            // Fall through to summary
          } else {
            return content;
          }
        }

        // Smart summary mode
        const summary = buildSearchSummary(hits);
        const originalTokens = calculateTokens(JSON.stringify(hits));

        let resultText = "";
        let actualLevel = summary_level;

        if (actualLevel === "auto") {
          const full = formatSearchSummaryFull(summary);
          if (calculateTokens(full) <= maxTokenCall || break_token_rule) {
            resultText = full;
            actualLevel = "full";
          } else {
            const compact = formatSearchSummaryCompact(summary, 10);
            if (calculateTokens(compact) <= maxTokenCall || break_token_rule) {
              resultText = compact;
              actualLevel = "compact";
            } else {
              resultText = formatSearchSummaryMinimal(summary);
              actualLevel = "minimal";
            }
          }
        } else {
          if (actualLevel === "full") resultText = formatSearchSummaryFull(summary);
          else if (actualLevel === "compact") resultText = formatSearchSummaryCompact(summary, 10);
          else resultText = formatSearchSummaryMinimal(summary);
        }

        const optimizedTokens = calculateTokens(resultText);
        const saved = originalTokens - optimizedTokens;

        resultText += `\n${"─".repeat(50)}\n`;
        resultText += `Token stats: original=${originalTokens.toLocaleString()} → summary=${optimizedTokens.toLocaleString()} (saved ${saved.toLocaleString()}, level=${actualLevel})\n`;
        resultText += `Tip: use query/tag/folderUids to narrow results, or set summary_level='full' for all details.\n`;

        if (hits.length > AUTO_SUMMARY_THRESHOLD && !summary_mode) {
          resultText =
            `⚠ ${hits.length} results returned — auto-switched to summary mode.\n\n` +
            resultText;
        }

        return {
          content: [{ type: "text" as const, text: resultText }],
        };
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

  // -------------------------------------------------------------------------
  // Tool 2: get_dashboard_summary
  // -------------------------------------------------------------------------
  tool(
    "get_dashboard_summary",
    "Get a compact, token-efficient overview of a Grafana dashboard: title, tags, panel count, panel list (id, title, type, query count), template variables, and time range. Use this before get_dashboard_panel_queries or run_panel_query to understand the dashboard structure without fetching its full JSON.",
    {
      uid: z.string().min(1).describe("The UID of the dashboard to summarize"),
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

        const allPanels: Array<Record<string, unknown>> = [];
        for (const p of panels) {
          allPanels.push(p);
          if (p.type === "row") {
            for (const np of ((p.panels as Array<Record<string, unknown>>) ?? [])) {
              allPanels.push(np);
            }
          }
        }

        const summary = {
          uid,
          title: db.title ?? "",
          description: db.description ?? "",
          tags: db.tags ?? [],
          refresh: db.refresh ?? "",
          timeRange: db.time ?? {},
          version: db.version ?? 0,
          panelCount: allPanels.length,
          panels: allPanels.map((p) => ({
            id: p.id,
            title: p.title ?? "",
            type: p.type ?? "",
            queryCount: ((p.targets as unknown[]) ?? []).length,
          })),
          variables: (
            ((db.templating as Record<string, unknown>)?.list as Array<Record<string, unknown>>) ?? []
          ).map((v) => ({
            name: v.name,
            type: v.type,
            label: v.label ?? "",
          })),
          folderTitle: data.meta?.folderTitle ?? "",
          folderUid: data.meta?.folderUid ?? "",
        };

        const tokenCount = calculateTokens(JSON.stringify(summary));
        const fullDashTokens = calculateTokens(JSON.stringify(data));
        const saved = fullDashTokens - tokenCount;

        const output =
          JSON.stringify(summary, null, 2) +
          `\n\n${"─".repeat(50)}\n` +
          `Token stats: full dashboard=${fullDashTokens.toLocaleString()} → summary=${tokenCount.toLocaleString()} (saved ${saved.toLocaleString()})\n` +
          `Next: use get_dashboard_panel_queries to inspect queries, or run_panel_query to execute data.\n`;

        return { content: [{ type: "text" as const, text: output }] };
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
