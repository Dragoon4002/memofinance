import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  OkxRestClient, SQLiteMemoryStore,
  registerMemoryTools, registerMarketTools, registerRiskTools,
  toMcpTool, successResult, errorResult,
} from "@memofinance/core";
import type { ToolSpec, ToolContext } from "@memofinance/core";

export function createServer(memoryStore: SQLiteMemoryStore): Server {
  const client = new OkxRestClient();
  const ctx: ToolContext = { memoryStore, client };

  const tools: ToolSpec[] = [
    ...registerMemoryTools(),
    ...registerMarketTools(),
    ...registerRiskTools(),
  ];
  const toolMap = new Map(tools.map(t => [t.name, t]));

  const server = new Server(
    { name: "memofinance", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: "MemoFinance: persistent memory-backed finance intelligence. Use store_finance_context to save analyses, recall_finance_context to retrieve them, get_onchain_data for live market data, risk_alpha_score for risk assessment, and yield_advisor for personalized yield recommendations.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(toMcpTool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolMap.get(request.params.name);
    if (!tool) return errorResult(request.params.name, new Error(`Tool not found: ${request.params.name}`));
    try {
      const data = await tool.handler((request.params.arguments ?? {}) as Record<string, unknown>, ctx);
      return successResult(request.params.name, data);
    } catch (err) {
      return errorResult(request.params.name, err);
    }
  });

  return server;
}
