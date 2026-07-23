import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SQLiteMemoryStore } from "@memofinance/core";
import { createServer } from "./server.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const dbPath = process.env.MEMOFINANCE_DB ?? "./data/memories.db";

const memoryStore = new SQLiteMemoryStore(dbPath);

process.on("SIGINT", () => { memoryStore.close(); process.exit(0); });
process.on("SIGTERM", () => { memoryStore.close(); process.exit(0); });

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

const mcpServer = createServer(memoryStore);
await mcpServer.connect(transport);

const httpServer = createHttpServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ name: "MemoFinance MCP", version: "1.0.0", transport: "StreamableHTTP", endpoint: "/mcp" }));
    return;
  }
  // Hono reads rawHeaders to build Web Request — patch both
  if (!req.headers["accept"]?.includes("text/event-stream")) {
    req.headers["accept"] = "application/json, text/event-stream";
    const raw = req.rawHeaders;
    const idx = raw.findIndex((v, i) => i % 2 === 0 && v.toLowerCase() === "accept");
    if (idx >= 0) { raw[idx + 1] = "application/json, text/event-stream"; }
    else { raw.push("Accept", "application/json, text/event-stream"); }
  }
  transport.handleRequest(req, res);
});

httpServer.listen(PORT, () => {
  process.stderr.write(`MemoFinance MCP HTTP server running on port ${PORT}\n`);
});
