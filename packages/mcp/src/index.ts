#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SQLiteMemoryStore } from "@memofinance/core";
import { createServer } from "./server.js";

async function main() {
  const dbPath = process.env.MEMOFINANCE_DB ?? "./data/memories.db";
  const memoryStore = new SQLiteMemoryStore(dbPath);

  process.on("SIGINT", () => { memoryStore.close(); process.exit(0); });
  process.on("SIGTERM", () => { memoryStore.close(); process.exit(0); });

  const server = createServer(memoryStore);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
