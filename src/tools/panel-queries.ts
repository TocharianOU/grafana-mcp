import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit } from "../utils/token-limiter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeStr(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function safeNum(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  return 0;
}

function safeArr(obj: Record<string, unknown>, key: string): unknown[] {
  const v = obj[key];
  return Array.isArray(v) ? v : [];
}

function safeObj(
  obj: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const v = obj[key];
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Find a panel by numeric ID, including panels nested inside row panels. */
function findPanelById(
  db: Record<string, unknown>,
  panelId: number
): Record<string, unknown> | null {
  const panels = safeArr(db, "panels");
  for (const p of panels) {
    const panel = p as Record<string, unknown>;
    if (safeNum(panel, "id") === panelId) return panel;
    if (safeStr(panel, "type") === "row") {
      for (const np of safeArr(panel, "panels")) {
        const nested = np as Record<string, unknown>;
        if (safeNum(nested, "id") === panelId) return nested;
      }
    }
  }
  return null;
}

/** Collect all panels including those nested in rows. */
function collectAllPanels(db: Record<string, unknown>): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const p of safeArr(db, "panels")) {
    const panel = p as Record<string, unknown>;
    result.push(panel);
    if (safeStr(panel, "type") === "row") {
      for (const np of safeArr(panel, "panels")) {
        result.push(np as Record<string, unknown>);
      }
    }
  }
  return result;
}

/** Extract template variable current values from dashboard JSON. */
function extractTemplateVars(
  db: Record<string, unknown>
): Record<string, string> {
  const vars: Record<string, string> = {};
  const templating = safeObj(db, "templating");
  if (!templating) return vars;
  for (const v of safeArr(templating, "list")) {
    const variable = v as Record<string, unknown>;
    const name = safeStr(variable, "name");
    if (!name) continue;
    const current = safeObj(variable, "current");
    if (current) {
      const val = current["value"];
      if (typeof val === "string" && val !== "$__all") {
        vars[name] = val;
      } else if (Array.isArray(val) && val.length > 0) {
        const first = val[0];
        if (typeof first === "string" && first !== "$__all") vars[name] = first;
      }
    }
  }
  return vars;
}

/** Substitute Grafana template variable references in a query string. */
function substituteVars(query: string, vars: Record<string, string>): string {
  for (const [name, value] of Object.entries(vars)) {
    query = query.replaceAll(`\${${name}}`, value);
    query = query.replaceAll(`[[${name}]]`, value);
    query = query.replace(new RegExp(`\\$${name}\\b`, "g"), value);
  }
  return query;
}

/** Substitute Grafana temporal macros ($__range, $__interval, etc.). */
function substituteGrafanaMacros(
  query: string,
  startMs: number,
  endMs: number
): string {
  const durationMs = endMs - startMs;
  const durationSec = Math.floor(durationMs / 1000);
  const durationMin = Math.floor(durationSec / 60);

  const rangeStr =
    durationMin >= 60
      ? `${Math.floor(durationMin / 60)}h${durationMin % 60 > 0 ? `${durationMin % 60}m` : ""}`
      : durationMin >= 1
      ? `${durationMin}m`
      : `${durationSec}s`;

  const intervalMs = Math.max(1000, Math.floor(durationMs / 100));
  const intervalSec = Math.floor(intervalMs / 1000);
  const intervalStr =
    intervalSec >= 60 ? `${Math.floor(intervalSec / 60)}m` : `${intervalSec}s`;

  query = query.replaceAll("${__range_ms}", String(durationMs));
  query = query.replaceAll("$__range_ms", String(durationMs));
  query = query.replaceAll("${__range_s}", String(durationSec));
  query = query.replaceAll("$__range_s", String(durationSec));
  query = query.replaceAll("${__range}", rangeStr);
  query = query.replaceAll("$__range", rangeStr);
  query = query.replaceAll("${__rate_interval}", "1m");
  query = query.replaceAll("$__rate_interval", "1m");
  query = query.replaceAll("${__interval_ms}", String(intervalMs));
  query = query.replaceAll("$__interval_ms", String(intervalMs));
  query = query.replaceAll("${__interval}", intervalStr);
  query = query.replaceAll("$__interval", intervalStr);
  return query;
}

/** Parse a time string into a Unix ms timestamp. */
function parseTimeToMs(t: string): number {
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (t === "now") return Date.now();
  const relMatch = t.match(/^now-(\d+)([smhdw])$/);
  if (relMatch) {
    const amount = parseInt(relMatch[1], 10);
    const unit = relMatch[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
    };
    return Date.now() - amount * (multipliers[unit] ?? 60_000);
  }
  return new Date(t).getTime();
}

/** Try common query expression field names from a panel target. */
function extractQueryExpr(target: Record<string, unknown>): string {
  for (const field of ["expr", "query", "expression", "rawSql", "rawQuery"]) {
    const v = target[field];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerPanelQueryTools(
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

  // Tool: get_dashboard_panel_queries
  tool(
    "get_dashboard_panel_queries",
    "Retrieve the raw query expressions from all panels (or a specific panel) in a Grafana dashboard. Returns panel title, datasource uid/type, refId, and the query expression. Optionally applies variable substitutions to populate a processedQuery field. Use this before run_panel_query to understand what queries are inside a dashboard.",
    {
      uid: z.string().min(1).describe("The UID of the dashboard"),
      panelId: z
        .number()
        .optional()
        .describe("Filter to a specific panel by its numeric ID"),
      variables: z
        .record(z.string())
        .optional()
        .describe(
          "Optional variable overrides for substitution (e.g. {\"job\": \"api-server\"})"
        ),
    },
    async (args) => {
      const { uid, panelId, variables } = args as {
        uid: string;
        panelId?: number;
        variables?: Record<string, string>;
      };
      try {
        const data = await client.get<{
          dashboard: Record<string, unknown>;
          meta: Record<string, unknown>;
        }>(`/api/dashboards/uid/${uid}`);

        const db = data.dashboard;
        const dashVars = extractTemplateVars(db);
        const mergedVars = { ...dashVars, ...(variables ?? {}) };

        const panels =
          panelId !== undefined
            ? (() => {
                const p = findPanelById(db, panelId);
                return p ? [p] : [];
              })()
            : collectAllPanels(db);

        const result = panels.flatMap((panel) => {
          const targets = safeArr(panel, "targets");
          return targets.map((t) => {
            const target = t as Record<string, unknown>;
            const dsObj = safeObj(target, "datasource") ?? safeObj(panel, "datasource");
            const rawExpr = extractQueryExpr(target);
            const processedExpr = rawExpr ? substituteVars(rawExpr, mergedVars) : "";
            return {
              panelId: safeNum(panel, "id"),
              title: safeStr(panel, "title"),
              type: safeStr(panel, "type"),
              refId: safeStr(target, "refId"),
              datasource: dsObj
                ? { uid: safeStr(dsObj, "uid"), type: safeStr(dsObj, "type") }
                : null,
              query: rawExpr,
              processedQuery: processedExpr !== rawExpr ? processedExpr : undefined,
            };
          });
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: get_dashboard_property
  tool(
    "get_dashboard_property",
    "Extract a specific part of a Grafana dashboard JSON using a simple dot-notation path (e.g. 'title', 'panels', 'panels.0.title', 'templating.list', 'time'). Use this to inspect targeted dashboard fields without fetching the full JSON, saving context window space.",
    {
      uid: z.string().min(1).describe("The UID of the dashboard"),
      path: z
        .string()
        .min(1)
        .describe(
          "Dot-notation path into the dashboard object. Examples: 'title', 'panels', 'panels.0.title', 'templating.list', 'annotations.list', 'time', 'tags'"
        ),
    },
    async (args) => {
      const { uid, path } = args as { uid: string; path: string };
      try {
        const data = await client.get<{ dashboard: Record<string, unknown> }>(
          `/api/dashboards/uid/${uid}`
        );
        let current: unknown = data.dashboard;
        for (const segment of path.split(".")) {
          if (current === null || current === undefined) break;
          if (typeof current === "object" && !Array.isArray(current)) {
            current = (current as Record<string, unknown>)[segment];
          } else if (Array.isArray(current)) {
            const idx = parseInt(segment, 10);
            current = isNaN(idx) ? undefined : current[idx];
          } else {
            current = undefined;
          }
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(current, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: run_panel_query
  tool(
    "run_panel_query",
    "Execute the actual data query for one or more panels from a Grafana dashboard. Fetches the dashboard, extracts the query from the specified panels, substitutes Grafana template variables and temporal macros ($__range, $__interval, $__rate_interval), then routes the query to Grafana's /api/ds/query endpoint. Use get_dashboard_summary to find panel IDs and get_dashboard_panel_queries to preview queries before running them. Returns raw data frame results keyed by panel ID.",
    {
      dashboardUid: z
        .string()
        .min(1)
        .describe("The UID of the dashboard containing the panels"),
      panelIds: z
        .array(z.number())
        .min(1)
        .describe("One or more numeric panel IDs to execute"),
      queryIndex: z
        .number()
        .optional()
        .default(0)
        .describe(
          "Zero-based index of the query to execute within each panel's targets array (default: 0). Use get_dashboard_panel_queries to see all queries."
        ),
      start: z
        .string()
        .optional()
        .default("now-1h")
        .describe(
          "Start time override. Accepts relative (e.g. 'now-1h', 'now-6h'), RFC3339 (e.g. '2024-01-01T00:00:00Z'), or Unix ms."
        ),
      end: z
        .string()
        .optional()
        .default("now")
        .describe(
          "End time override. Accepts 'now', RFC3339, or Unix ms."
        ),
      variables: z
        .record(z.string())
        .optional()
        .describe(
          "Dashboard variable overrides to apply during query substitution (e.g. {\"job\": \"api-server\", \"instance\": \"host1\"})"
        ),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations."),
    },
    async (args) => {
      const {
        dashboardUid,
        panelIds,
        queryIndex,
        start,
        end,
        variables,
        break_token_rule,
      } = args as {
        dashboardUid: string;
        panelIds: number[];
        queryIndex: number;
        start: string;
        end: string;
        variables?: Record<string, string>;
        break_token_rule: boolean;
      };

      try {
        const data = await client.get<{
          dashboard: Record<string, unknown>;
          meta: Record<string, unknown>;
        }>(`/api/dashboards/uid/${dashboardUid}`);

        const db = data.dashboard;
        const dashVars = extractTemplateVars(db);
        const mergedVars = { ...dashVars, ...(variables ?? {}) };

        const startMs = parseTimeToMs(start);
        const endMs = parseTimeToMs(end);

        const results: Record<string, unknown> = {};
        const errors: Record<string, string> = {};

        for (const panelId of panelIds) {
          try {
            const panel = findPanelById(db, panelId);
            if (!panel) {
              errors[String(panelId)] = `Panel with ID ${panelId} not found`;
              continue;
            }

            const targets = safeArr(panel, "targets");
            if (targets.length === 0) {
              errors[String(panelId)] = `Panel ${panelId} has no query targets`;
              continue;
            }

            const idx = Math.min(queryIndex, targets.length - 1);
            const target = targets[idx] as Record<string, unknown>;

            // Resolve datasource UID from target or panel
            const targetDs = safeObj(target, "datasource");
            const panelDs = safeObj(panel, "datasource");
            const dsUid =
              safeStr(targetDs ?? {}, "uid") ||
              safeStr(panelDs ?? {}, "uid");
            const dsType =
              safeStr(targetDs ?? {}, "type") ||
              safeStr(panelDs ?? {}, "type");

            if (!dsUid || dsUid.startsWith("$")) {
              errors[String(panelId)] = `Could not resolve datasource UID for panel ${panelId} (value: "${dsUid}"). Provide variable overrides if needed.`;
              continue;
            }

            // Build the query expression with variable and macro substitution
            const rawExpr = extractQueryExpr(target);
            const substitutedExpr = substituteGrafanaMacros(
              substituteVars(rawExpr, mergedVars),
              startMs,
              endMs
            );

            // Build Grafana /api/ds/query payload
            const queryTarget: Record<string, unknown> = {
              ...target,
              datasource: { uid: dsUid, type: dsType },
              refId: safeStr(target, "refId") || "A",
            };

            // Patch the query expression fields with substituted values
            for (const field of ["expr", "query", "expression", "rawSql", "rawQuery"]) {
              if (typeof target[field] === "string" && (target[field] as string).trim()) {
                queryTarget[field] = substituteGrafanaMacros(
                  substituteVars(target[field] as string, mergedVars),
                  startMs,
                  endMs
                );
              }
            }

            const payload = {
              queries: [queryTarget],
              from: String(startMs),
              to: String(endMs),
            };

            const queryResult = await client.post<unknown>("/api/ds/query", payload);
            results[String(panelId)] = {
              panelId,
              panelTitle: safeStr(panel, "title"),
              datasourceUid: dsUid,
              datasourceType: dsType,
              query: substitutedExpr,
              data: queryResult,
            };
          } catch (err) {
            errors[String(panelId)] = err instanceof Error ? err.message : String(err);
          }
        }

        const output = {
          dashboardUid,
          timeRange: { start, end, startMs, endMs },
          results,
          errors: Object.keys(errors).length > 0 ? errors : undefined,
        };

        const content = {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        };
        const tokenCheck = checkTokenLimit(content, maxTokenCall, break_token_rule);
        if (!tokenCheck.allowed) {
          return {
            content: [{ type: "text" as const, text: tokenCheck.error ?? "Token limit exceeded" }],
            isError: true,
          };
        }
        return content;
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
