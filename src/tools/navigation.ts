import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit } from "../utils/token-limiter.js";
import type { GrafanaConfig } from "../server.js";

export function registerNavigationTools(
  server: McpServer,
  client: GrafanaClient,
  config: GrafanaConfig,
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

  const baseUrl = config.url.replace(/\/$/, "");

  // Tool: generate_deeplink
  tool(
    "generate_deeplink",
    "Generate a direct deep-link URL to a Grafana dashboard, panel, or Explore view. The returned URL can be opened in a browser to navigate directly to the resource. Useful for sharing investigation results or directing users to specific panels.",
    {
      resourceType: z
        .enum(["dashboard", "panel", "explore"])
        .describe(
          "'dashboard' — link to a whole dashboard; 'panel' — link to a single panel in view-mode; 'explore' — link to Explore with a pre-filled query"
        ),
      dashboardUid: z
        .string()
        .optional()
        .describe("Required for 'dashboard' and 'panel' resource types"),
      panelId: z
        .number()
        .optional()
        .describe("Required for 'panel' resource type"),
      datasourceUid: z
        .string()
        .optional()
        .describe("Required for 'explore' resource type"),
      queries: z
        .array(z.record(z.unknown()))
        .optional()
        .describe(
          "Query objects for 'explore' links (e.g. [{\"refId\":\"A\",\"expr\":\"up\"}])"
        ),
      from: z
        .string()
        .optional()
        .default("now-1h")
        .describe("Time range start (e.g. 'now-1h', 'now-6h', RFC3339)"),
      to: z
        .string()
        .optional()
        .default("now")
        .describe("Time range end (e.g. 'now', RFC3339)"),
      extraParams: z
        .record(z.string())
        .optional()
        .describe(
          "Additional URL query parameters to append (e.g. {\"var-job\": \"api-server\"})"
        ),
    },
    async (args) => {
      const {
        resourceType,
        dashboardUid,
        panelId,
        datasourceUid,
        queries,
        from,
        to,
        extraParams,
      } = args as {
        resourceType: "dashboard" | "panel" | "explore";
        dashboardUid?: string;
        panelId?: number;
        datasourceUid?: string;
        queries?: Array<Record<string, unknown>>;
        from: string;
        to: string;
        extraParams?: Record<string, string>;
      };

      try {
        let url = "";
        const qp = new URLSearchParams({ from, to, ...extraParams });

        switch (resourceType) {
          case "dashboard": {
            if (!dashboardUid) {
              return { content: [{ type: "text" as const, text: "Error: dashboardUid is required for 'dashboard' resource type" }], isError: true };
            }
            url = `${baseUrl}/d/${dashboardUid}?${qp}`;
            break;
          }
          case "panel": {
            if (!dashboardUid) {
              return { content: [{ type: "text" as const, text: "Error: dashboardUid is required for 'panel' resource type" }], isError: true };
            }
            if (panelId !== undefined) qp.set("viewPanel", String(panelId));
            url = `${baseUrl}/d/${dashboardUid}?${qp}`;
            break;
          }
          case "explore": {
            if (!datasourceUid) {
              return { content: [{ type: "text" as const, text: "Error: datasourceUid is required for 'explore' resource type" }], isError: true };
            }
            const left = JSON.stringify({
              datasource: datasourceUid,
              queries: queries ?? [],
              range: { from, to },
            });
            qp.set("left", left);
            url = `${baseUrl}/explore?${qp}`;
            break;
          }
        }

        return {
          content: [{ type: "text" as const, text: url }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: get_panel_image
  tool(
    "get_panel_image",
    "Render a Grafana dashboard panel as a PNG image using the Grafana Image Renderer plugin. Returns a base64-encoded PNG. Requires the Grafana Image Renderer plugin to be installed and configured on the Grafana instance.",
    {
      dashboardUid: z
        .string()
        .min(1)
        .describe("The UID of the dashboard containing the panel"),
      panelId: z
        .number()
        .optional()
        .describe(
          "The numeric panel ID to render. If omitted, renders the entire dashboard."
        ),
      from: z
        .string()
        .optional()
        .default("now-1h")
        .describe("Start of the time range (e.g. 'now-1h', RFC3339)"),
      to: z
        .string()
        .optional()
        .default("now")
        .describe("End of the time range (e.g. 'now', RFC3339)"),
      width: z
        .number()
        .optional()
        .default(1000)
        .describe("Image width in pixels (default: 1000)"),
      height: z
        .number()
        .optional()
        .default(500)
        .describe("Image height in pixels (default: 500)"),
      theme: z
        .enum(["dark", "light"])
        .optional()
        .default("dark")
        .describe("Grafana theme for the rendered image (default: dark)"),
      variables: z
        .record(z.string())
        .optional()
        .describe(
          "Dashboard variable values to apply (e.g. {\"var-job\": \"api-server\"})"
        ),
    },
    async (args) => {
      const { dashboardUid, panelId, from, to, width, height, theme, variables } =
        args as {
          dashboardUid: string;
          panelId?: number;
          from: string;
          to: string;
          width: number;
          height: number;
          theme: "dark" | "light";
          variables?: Record<string, string>;
        };

      try {
        const params = new URLSearchParams({
          from,
          to,
          width: String(width),
          height: String(height),
          theme,
        });

        if (panelId !== undefined) params.set("panelId", String(panelId));
        if (variables) {
          for (const [k, v] of Object.entries(variables)) {
            const key = k.startsWith("var-") ? k : `var-${k}`;
            params.set(key, v);
          }
        }

        const endpoint = panelId !== undefined
          ? `/render/d-solo/${dashboardUid}?${params}`
          : `/render/d/${dashboardUid}?${params}`;

        const imageData = await client.get<string>(endpoint);
        return {
          content: [
            {
              type: "text" as const,
              text: `Image rendered. URL: ${baseUrl}${endpoint}`,
            },
            {
              type: "image" as const,
              data: typeof imageData === "string" ? imageData : "",
              mimeType: "image/png",
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error rendering panel image: ${error instanceof Error ? error.message : String(error)}\n\nNote: This tool requires the Grafana Image Renderer plugin to be installed.` }],
          isError: true,
        };
      }
    }
  );

  // Tool: search_logs
  tool(
    "search_logs",
    "Search for log entries matching a text pattern across a Loki datasource. This is a high-level convenience tool that automatically constructs a LogQL filter query from a plain-text pattern. For complex LogQL queries, use query_loki_logs directly.",
    {
      datasourceUid: z
        .string()
        .min(1)
        .describe("The UID of a Loki datasource"),
      pattern: z
        .string()
        .min(1)
        .describe(
          "Text pattern or substring to search for in log messages (case-sensitive). Wrap in '/' for regex matching (e.g. '/ERROR|WARN/')."
        ),
      streamSelector: z
        .string()
        .optional()
        .describe(
          "Optional LogQL stream selector to narrow the search (e.g. '{app=\"nginx\"}', '{namespace=\"prod\"}'). Defaults to '{}'  which matches all streams."
        ),
      start: z
        .string()
        .optional()
        .describe("Start time as RFC3339 (default: 1 hour ago)"),
      end: z
        .string()
        .optional()
        .describe("End time as RFC3339 (default: now)"),
      limit: z
        .number()
        .optional()
        .default(100)
        .describe("Maximum number of log lines to return (default: 100)"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations."),
    },
    async (args) => {
      const {
        datasourceUid,
        pattern,
        streamSelector,
        start,
        end,
        limit,
        break_token_rule,
      } = args as {
        datasourceUid: string;
        pattern: string;
        streamSelector?: string;
        start?: string;
        end?: string;
        limit: number;
        break_token_rule: boolean;
      };

      try {
        const selector = streamSelector ?? "{}";
        // Build LogQL: {selector} |= "pattern" or |~ "regex"
        const isRegex = pattern.startsWith("/") && pattern.endsWith("/");
        const filterOp = isRegex ? "|~" : "|=";
        const filterVal = isRegex ? `\`${pattern.slice(1, -1)}\`` : `"${pattern.replace(/"/g, '\\"')}"`;
        const logql = `${selector} ${filterOp} ${filterVal}`;

        const startStr = start ?? new Date(Date.now() - 3_600_000).toISOString();
        const endStr = end ?? new Date().toISOString();

        const params: Record<string, string | number> = {
          query: logql,
          start: String(new Date(startStr).getTime() * 1_000_000),
          end: String(new Date(endStr).getTime() * 1_000_000),
          limit: Math.min(limit, 5000),
          direction: "backward",
        };

        const result = await client.get<unknown>(
          `/api/datasources/proxy/uid/${datasourceUid}/loki/api/v1/query_range`,
          params
        );
        const content = {
          content: [{ type: "text" as const, text: JSON.stringify({ logql, result }, null, 2) }],
        };
        const tokenCheck = checkTokenLimit(content, maxTokenCall, break_token_rule);
        if (!tokenCheck.allowed) {
          return { content: [{ type: "text" as const, text: tokenCheck.error ?? "Token limit exceeded" }], isError: true };
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
