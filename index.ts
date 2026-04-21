#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "crypto";
import { createGrafanaMcpServer, type GrafanaConfig } from "./src/server.js";

const config: GrafanaConfig = {
  url: process.env.GRAFANA_URL || "http://localhost:3000",
  token: process.env.GRAFANA_TOKEN || undefined,
  username: process.env.GRAFANA_USERNAME || undefined,
  password: process.env.GRAFANA_PASSWORD || undefined,
  orgId: parseInt(process.env.GRAFANA_ORG_ID || "1", 10),
};

async function main() {
  try {
    const useHttp = process.env.MCP_TRANSPORT === "http";
    const httpPort = parseInt(process.env.MCP_HTTP_PORT || "3100", 10);
    const httpHost = process.env.MCP_HTTP_HOST || "localhost";

    if (useHttp) {
      process.stderr.write(
        `Starting Grafana MCP Server in HTTP Streamable mode on ${httpHost}:${httpPort}\n`
      );

      const app = express();
      app.use(express.json());

      const transports = new Map<string, StreamableHTTPServerTransport>();

      app.get("/health", (_req, res) => {
        res.json({
          status: "ok",
          transport: "streamable-http",
          grafana_url: config.url,
        });
      });

      app.post("/mcp", async (req, res) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        try {
          let transport: StreamableHTTPServerTransport;

          if (sessionId && transports.has(sessionId)) {
            transport = transports.get(sessionId)!;
          } else {
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: async (newSessionId: string) => {
                transports.set(newSessionId, transport);
                process.stderr.write(
                  `New MCP session initialized: ${newSessionId}\n`
                );
              },
              onsessionclosed: async (closedSessionId: string) => {
                transports.delete(closedSessionId);
                process.stderr.write(`MCP session closed: ${closedSessionId}\n`);
              },
            });

            const server = await createGrafanaMcpServer(config);
            await server.connect(transport);
          }

          await transport.handleRequest(req, res, req.body);
        } catch (error) {
          process.stderr.write(`Error handling MCP request: ${error}\n`);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null,
            });
          }
        }
      });

      app.get("/mcp", async (req, res) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (!sessionId || !transports.has(sessionId)) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Invalid or missing session ID" },
            id: null,
          });
          return;
        }

        try {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
        } catch (error) {
          process.stderr.write(`Error handling SSE stream: ${error}\n`);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Failed to establish SSE stream" },
              id: null,
            });
          }
        }
      });

      app.listen(httpPort, httpHost, () => {
        console.error(`\n✓ Grafana MCP Server (HTTP Streamable Mode) is running`);
        console.error(`  Endpoint: http://${httpHost}:${httpPort}/mcp`);
        console.error(`  Health:   http://${httpHost}:${httpPort}/health`);
        console.error(`  Transport: Streamable HTTP`);
        console.error(`  Grafana URL: ${config.url}\n`);
      });

      process.on("SIGINT", async () => {
        console.error("\nShutting down server...");
        for (const [, transport] of transports.entries()) {
          await transport.close();
        }
        process.exit(0);
      });
    } else {
      process.stderr.write(`Starting Grafana MCP Server in Stdio mode\n`);

      const transport = new StdioServerTransport();
      const server = await createGrafanaMcpServer(config);
      await server.connect(transport);

      process.on("SIGINT", async () => {
        await server.close();
        process.exit(0);
      });
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    "Server error:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
