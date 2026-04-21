import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GrafanaClient } from "../client.js";
import { checkTokenLimit } from "../utils/token-limiter.js";

export function registerAlertingTools(
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

  // Tool: list_alert_rules
  tool(
    "list_alert_rules",
    "List Grafana alerting rules. Returns all alert rules with their state, labels, annotations, and evaluation data. Supports filtering by folder and rule group.",
    {
      folderUid: z
        .string()
        .optional()
        .describe("Filter alert rules by folder UID"),
      ruleGroup: z
        .string()
        .optional()
        .describe("Filter alert rules by rule group name"),
      limit: z
        .number()
        .optional()
        .default(100)
        .describe("Maximum number of rules to return (default: 100)"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations."),
    },
    async (args) => {
      const { folderUid, ruleGroup, limit, break_token_rule } = args as {
        folderUid?: string;
        ruleGroup?: string;
        limit: number;
        break_token_rule: boolean;
      };
      try {
        const params: Record<string, string | number | boolean | undefined> = {
          limit,
        };
        if (folderUid) params.folderUid = folderUid;
        if (ruleGroup) params.ruleGroup = ruleGroup;

        const result = await client.get<unknown>(
          "/api/v1/provisioning/alert-rules",
          params
        );
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

  // Tool: get_alert_rule
  tool(
    "get_alert_rule",
    "Get the full configuration of a specific Grafana alerting rule by its UID.",
    {
      uid: z.string().min(1).describe("The UID of the alert rule to retrieve"),
    },
    async (args) => {
      const { uid } = args as { uid: string };
      try {
        const result = await client.get<unknown>(
          `/api/v1/provisioning/alert-rules/${uid}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: create_alert_rule
  tool(
    "create_alert_rule",
    "Create a new Grafana alerting rule. Provide the complete alert rule definition including title, condition, data queries, folder UID, and evaluation interval.",
    {
      rule: z
        .record(z.unknown())
        .describe(
          "The alert rule definition object. Required fields: 'title' (string), 'condition' (string, refId of condition query), 'data' (array of query objects), 'folderUID' (string), 'ruleGroup' (string), 'for' (string, e.g. '5m'). Optional: 'labels', 'annotations', 'noDataState', 'execErrState'."
        ),
    },
    async (args) => {
      const { rule } = args as { rule: Record<string, unknown> };
      try {
        const result = await client.post<unknown>(
          "/api/v1/provisioning/alert-rules",
          rule
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: update_alert_rule
  tool(
    "update_alert_rule",
    "Update an existing Grafana alerting rule by its UID. Provide the complete updated rule definition.",
    {
      uid: z.string().min(1).describe("The UID of the alert rule to update"),
      rule: z
        .record(z.unknown())
        .describe("The complete updated alert rule definition object"),
    },
    async (args) => {
      const { uid, rule } = args as { uid: string; rule: Record<string, unknown> };
      try {
        const result = await client.put<unknown>(
          `/api/v1/provisioning/alert-rules/${uid}`,
          rule
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: delete_alert_rule
  tool(
    "delete_alert_rule",
    "Delete a Grafana alerting rule by its UID. This action is irreversible.",
    {
      uid: z.string().min(1).describe("The UID of the alert rule to delete"),
    },
    async (args) => {
      const { uid } = args as { uid: string };
      try {
        const result = await client.delete<unknown>(
          `/api/v1/provisioning/alert-rules/${uid}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: list_contact_points
  tool(
    "list_contact_points",
    "List all Grafana alerting contact points (notification receivers). Returns name, type, and configuration for each contact point.",
    {
      name: z
        .string()
        .optional()
        .describe("Filter contact points by name"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations."),
    },
    async (args) => {
      const { name, break_token_rule } = args as {
        name?: string;
        break_token_rule: boolean;
      };
      try {
        const params: Record<string, string | undefined> = {};
        if (name) params.name = name;
        const result = await client.get<unknown>(
          "/api/v1/provisioning/contact-points",
          params
        );
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

  // Tool: list_notification_policies
  tool(
    "list_notification_policies",
    "Get the Grafana alerting notification policy tree. Shows how alerts are routed to contact points based on labels.",
    {},
    async (_args) => {
      try {
        const result = await client.get<unknown>(
          "/api/v1/provisioning/policies"
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // Tool: list_alert_instances
  tool(
    "list_alert_instances",
    "List active Grafana alert instances (firing or pending alerts). Shows current state of all alert evaluations with their labels and values.",
    {
      state: z
        .enum(["normal", "alerting", "pending", "nodata", "error"])
        .optional()
        .describe("Filter alert instances by state"),
      limit: z
        .number()
        .optional()
        .default(100)
        .describe("Maximum number of instances to return (default: 100)"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations."),
    },
    async (args) => {
      const { state, limit, break_token_rule } = args as {
        state?: string;
        limit: number;
        break_token_rule: boolean;
      };
      try {
        const params: Record<string, string | number | undefined> = { limit };
        if (state) params.state = state;

        const result = await client.get<unknown>(
          "/api/v1/provisioning/alert-rules/instances",
          params
        );
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

  // Tool: list_mute_timings
  tool(
    "list_mute_timings",
    "List all Grafana alerting mute timings. Mute timings define time intervals during which alert notifications are suppressed.",
    {},
    async (_args) => {
      try {
        const result = await client.get<unknown>(
          "/api/v1/provisioning/mute-timings"
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
