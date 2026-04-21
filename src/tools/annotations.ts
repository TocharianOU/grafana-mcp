import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit } from "../utils/token-limiter.js";

export function registerAnnotationTools(
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

  // Tool: list_annotations
  tool(
    "list_annotations",
    "List Grafana annotation events. Annotations are time-based markers on dashboards. Filter by dashboard UID, panel ID, time range, tags, or alert state.",
    {
      dashboardUid: z
        .string()
        .optional()
        .describe("Filter annotations by dashboard UID"),
      panelId: z
        .number()
        .optional()
        .describe("Filter annotations by panel ID (requires dashboardUid)"),
      from: z
        .number()
        .optional()
        .describe("Start of time range as Unix timestamp in milliseconds"),
      to: z
        .number()
        .optional()
        .describe("End of time range as Unix timestamp in milliseconds"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter annotations that have all of these tags"),
      type: z
        .enum(["alert", "annotation"])
        .optional()
        .describe("Filter by type: 'alert' or 'annotation'"),
      limit: z
        .number()
        .optional()
        .default(100)
        .describe("Maximum number of annotations to return (default: 100, max: 10000)"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations."),
    },
    async (args) => {
      const { dashboardUid, panelId, from, to, tags, type, limit, break_token_rule } =
        args as {
          dashboardUid?: string;
          panelId?: number;
          from?: number;
          to?: number;
          tags?: string[];
          type?: "alert" | "annotation";
          limit: number;
          break_token_rule: boolean;
        };
      try {
        const params: Record<string, string | number | boolean | undefined> = {
          limit: Math.min(limit, 10000),
        };
        if (dashboardUid) params.dashboardUID = dashboardUid;
        if (panelId !== undefined) params.panelId = panelId;
        if (from !== undefined) params.from = from;
        if (to !== undefined) params.to = to;
        if (type) params.type = type;
        if (tags && tags.length > 0) params.tags = tags.join(",");

        const result = await client.get<unknown>("/api/annotations", params);
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

  // Tool: create_annotation
  tool(
    "create_annotation",
    "Create a Grafana annotation event on a dashboard panel. Annotations are useful for marking deployments, incidents, or other events on time-series graphs.",
    {
      dashboardUid: z
        .string()
        .optional()
        .describe("The UID of the dashboard to annotate"),
      panelId: z
        .number()
        .optional()
        .describe("The panel ID within the dashboard to annotate"),
      time: z
        .number()
        .optional()
        .describe(
          "Unix timestamp in milliseconds for the annotation. Defaults to current time."
        ),
      timeEnd: z
        .number()
        .optional()
        .describe(
          "End Unix timestamp in milliseconds for region annotations. Omit for point annotations."
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags to attach to the annotation"),
      text: z.string().describe("The annotation text/description"),
    },
    async (args) => {
      const { dashboardUid, panelId, time, timeEnd, tags, text } = args as {
        dashboardUid?: string;
        panelId?: number;
        time?: number;
        timeEnd?: number;
        tags?: string[];
        text: string;
      };
      try {
        const body: Record<string, unknown> = { text };
        if (dashboardUid) body.dashboardUID = dashboardUid;
        if (panelId !== undefined) body.panelId = panelId;
        if (time !== undefined) body.time = time;
        if (timeEnd !== undefined) body.timeEnd = timeEnd;
        if (tags && tags.length > 0) body.tags = tags;

        const result = await client.post<unknown>("/api/annotations", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: update_annotation
  tool(
    "update_annotation",
    "Update an existing Grafana annotation by its numeric ID. You can change the text, tags, and time range.",
    {
      id: z.number().describe("The numeric ID of the annotation to update"),
      text: z.string().optional().describe("New annotation text"),
      tags: z.array(z.string()).optional().describe("New tags for the annotation"),
      time: z
        .number()
        .optional()
        .describe("New start time as Unix timestamp in milliseconds"),
      timeEnd: z
        .number()
        .optional()
        .describe("New end time as Unix timestamp in milliseconds"),
    },
    async (args) => {
      const { id, text, tags, time, timeEnd } = args as {
        id: number;
        text?: string;
        tags?: string[];
        time?: number;
        timeEnd?: number;
      };
      try {
        const body: Record<string, unknown> = {};
        if (text !== undefined) body.text = text;
        if (tags !== undefined) body.tags = tags;
        if (time !== undefined) body.time = time;
        if (timeEnd !== undefined) body.timeEnd = timeEnd;

        const result = await client.patch<unknown>(`/api/annotations/${id}`, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: delete_annotation
  tool(
    "delete_annotation",
    "Delete a Grafana annotation event by its numeric ID. This action is irreversible.",
    {
      id: z.number().describe("The numeric ID of the annotation to delete"),
    },
    async (args) => {
      const { id } = args as { id: number };
      try {
        const result = await client.delete<unknown>(`/api/annotations/${id}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
