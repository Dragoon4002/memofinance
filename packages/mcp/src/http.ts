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
  transport.handleRequest(req, res);
});

httpServer.listen(PORT, () => {
  process.stderr.write(`MemoFinance MCP HTTP server running on port ${PORT}\n`);
});
