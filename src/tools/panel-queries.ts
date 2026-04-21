import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit } from "../utils/token-limiter.js";

// ---------------------------------------------------------------------------
// Shared helpers
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

function allPanels(db: Record<string, unknown>): Array<Record<string, unknown>> {
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

function findPanelById(
  db: Record<string, unknown>,
  id: number
): Record<string, unknown> | null {
  return allPanels(db).find((p) => safeNum(p, "id") === id) ?? null;
}

function extractVars(db: Record<string, unknown>): Record<string, string> {
  const vars: Record<string, string> = {};
  const tpl = safeObj(db, "templating");
  if (!tpl) return vars;
  for (const v of safeArr(tpl, "list")) {
    const variable = v as Record<string, unknown>;
    const name = safeStr(variable, "name");
    if (!name) continue;
    const cur = safeObj(variable, "current");
    if (!cur) continue;
    const val = cur["value"];
    if (typeof val === "string" && val !== "$__all") vars[name] = val;
    else if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string" && val[0] !== "$__all") {
      vars[name] = val[0];
    }
  }
  return vars;
}

function substituteVars(query: string, vars: Record<string, string>): string {
  for (const [name, value] of Object.entries(vars)) {
    query = query.replaceAll(`\${${name}}`, value);
    query = query.replaceAll(`[[${name}]]`, value);
    query = query.replace(new RegExp(`\\$${name}\\b`, "g"), value);
  }
  return query;
}

function substituteMacros(query: string, startMs: number, endMs: number): string {
  const durMs = endMs - startMs;
  const durSec = Math.floor(durMs / 1000);
  const durMin = Math.floor(durSec / 60);
  const rangeStr = durMin >= 60
    ? `${Math.floor(durMin / 60)}h${durMin % 60 > 0 ? `${durMin % 60}m` : ""}`
    : durMin >= 1 ? `${durMin}m` : `${durSec}s`;

  const intMs = Math.max(1000, Math.floor(durMs / 100));
  const intSec = Math.floor(intMs / 1000);
  const intStr = intSec >= 60 ? `${Math.floor(intSec / 60)}m` : `${intSec}s`;

  const r = (s: string) =>
    s.replaceAll("${__range_ms}", String(durMs)).replaceAll("$__range_ms", String(durMs))
     .replaceAll("${__range_s}", String(durSec)).replaceAll("$__range_s", String(durSec))
     .replaceAll("${__range}", rangeStr).replaceAll("$__range", rangeStr)
     .replaceAll("${__rate_interval}", "1m").replaceAll("$__rate_interval", "1m")
     .replaceAll("${__interval_ms}", String(intMs)).replaceAll("$__interval_ms", String(intMs))
     .replaceAll("${__interval}", intStr).replaceAll("$__interval", intStr);
  return r(query);
}

function parseTimeMs(t: string): number {
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (t === "now") return Date.now();
  const m = t.match(/^now-(\d+)([smhdw])$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const mul: Record<string, number> = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 };
    return Date.now() - n * (mul[m[2]] ?? 6e4);
  }
  return new Date(t).getTime();
}

function extractExpr(target: Record<string, unknown>): string {
  for (const f of ["expr", "query", "expression", "rawSql", "rawQuery"]) {
    const v = target[f];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function substituteAllFields(
  target: Record<string, unknown>,
  vars: Record<string, string>,
  startMs: number,
  endMs: number
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const f of ["expr", "query", "expression", "rawSql", "rawQuery"]) {
    if (typeof result[f] === "string" && (result[f] as string).trim()) {
      result[f] = substituteMacros(
        substituteVars(result[f] as string, vars),
        startMs,
        endMs
      );
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tools
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

  // -------------------------------------------------------------------------
  // Tool 3: get_dashboard_panel_queries
  // -------------------------------------------------------------------------
  tool(
    "get_dashboard_panel_queries",
    "Extract the raw query expressions from every panel in a Grafana dashboard (or a specific panel). Returns panel id, title, datasource uid/type, refId, and the query string. Optionally apply variable overrides to see the final substituted query (processedQuery). Use this after get_dashboard_summary to preview panel queries before executing them with run_panel_query.",
    {
      uid: z.string().min(1).describe("Dashboard UID"),
      panelId: z.number().optional().describe("Filter to a single panel by numeric ID"),
      variables: z
        .record(z.string())
        .optional()
        .describe("Variable overrides for substitution (e.g. {\"job\": \"api-server\"})"),
    },
    async (args) => {
      const { uid, panelId, variables } = args as {
        uid: string;
        panelId?: number;
        variables?: Record<string, string>;
      };
      try {
        const data = await client.get<{ dashboard: Record<string, unknown> }>(
          `/api/dashboards/uid/${uid}`
        );
        const db = data.dashboard;
        const dashVars = extractVars(db);
        const mergedVars = { ...dashVars, ...(variables ?? {}) };

        const panels = panelId !== undefined
          ? (() => { const p = findPanelById(db, panelId); return p ? [p] : []; })()
          : allPanels(db);

        const result = panels.flatMap((panel) =>
          safeArr(panel, "targets").map((t) => {
            const target = t as Record<string, unknown>;
            const dsObj =
              safeObj(target, "datasource") ?? safeObj(panel, "datasource");
            const raw = extractExpr(target);
            const processed = raw ? substituteVars(raw, mergedVars) : "";
            return {
              panelId: safeNum(panel, "id"),
              title: safeStr(panel, "title"),
              type: safeStr(panel, "type"),
              refId: safeStr(target, "refId"),
              datasource: dsObj
                ? { uid: safeStr(dsObj, "uid"), type: safeStr(dsObj, "type") }
                : null,
              query: raw,
              processedQuery:
                processed !== raw && processed ? processed : undefined,
            };
          })
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
  // Tool 4: run_panel_query
  // -------------------------------------------------------------------------
  tool(
    "run_panel_query",
    "Execute the live data query for one or more Grafana dashboard panels. Automatically fetches the dashboard, extracts queries from the specified panels, substitutes template variables and Grafana temporal macros ($__range, $__interval, $__rate_interval), then posts to /api/ds/query. Supports all datasource types (Prometheus, Loki, ClickHouse, CloudWatch, etc.). Returns raw data frame results keyed by panel ID. Use get_dashboard_summary to find panel IDs.",
    {
      dashboardUid: z.string().min(1).describe("Dashboard UID"),
      panelIds: z.array(z.number()).min(1).describe("One or more numeric panel IDs"),
      queryIndex: z
        .number()
        .optional()
        .default(0)
        .describe("Zero-based index of the query within each panel's targets (default: 0)"),
      start: z
        .string()
        .optional()
        .default("now-1h")
        .describe("Start time: relative ('now-1h', 'now-6h'), RFC3339, or Unix ms"),
      end: z
        .string()
        .optional()
        .default("now")
        .describe("End time: 'now', RFC3339, or Unix ms"),
      variables: z
        .record(z.string())
        .optional()
        .describe("Dashboard variable overrides (e.g. {\"job\": \"api-server\"})"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Bypass token limits for large results."),
    },
    async (args) => {
      const { dashboardUid, panelIds, queryIndex, start, end, variables, break_token_rule } =
        args as {
          dashboardUid: string;
          panelIds: number[];
          queryIndex: number;
          start: string;
          end: string;
          variables?: Record<string, string>;
          break_token_rule: boolean;
        };

      try {
        const data = await client.get<{ dashboard: Record<string, unknown> }>(
          `/api/dashboards/uid/${dashboardUid}`
        );
        const db = data.dashboard;
        const dashVars = extractVars(db);
        const mergedVars = { ...dashVars, ...(variables ?? {}) };

        const startMs = parseTimeMs(start);
        const endMs = parseTimeMs(end);

        const results: Record<string, unknown> = {};
        const errors: Record<string, string> = {};

        for (const panelId of panelIds) {
          try {
            const panel = findPanelById(db, panelId);
            if (!panel) { errors[panelId] = `Panel ${panelId} not found`; continue; }

            const targets = safeArr(panel, "targets");
            if (!targets.length) { errors[panelId] = `Panel ${panelId} has no targets`; continue; }

            const idx = Math.min(queryIndex, targets.length - 1);
            const target = targets[idx] as Record<string, unknown>;

            const targetDs = safeObj(target, "datasource");
            const panelDs = safeObj(panel, "datasource");
            const dsUid = safeStr(targetDs ?? {}, "uid") || safeStr(panelDs ?? {}, "uid");
            const dsType = safeStr(targetDs ?? {}, "type") || safeStr(panelDs ?? {}, "type");

            if (!dsUid || dsUid.startsWith("$")) {
              errors[panelId] = `Cannot resolve datasource UID for panel ${panelId} ("${dsUid}"). Use variables parameter to override.`;
              continue;
            }

            const substitutedTarget = substituteAllFields(target, mergedVars, startMs, endMs);
            const payload = {
              queries: [
                {
                  ...substitutedTarget,
                  datasource: { uid: dsUid, type: dsType },
                  refId: safeStr(target, "refId") || "A",
                },
              ],
              from: String(startMs),
              to: String(endMs),
            };

            const queryResult = await client.post<unknown>("/api/ds/query", payload);
            results[panelId] = {
              panelId,
              panelTitle: safeStr(panel, "title"),
              datasourceUid: dsUid,
              datasourceType: dsType,
              query: extractExpr(substitutedTarget),
              data: queryResult,
            };
          } catch (err) {
            errors[panelId] = err instanceof Error ? err.message : String(err);
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
