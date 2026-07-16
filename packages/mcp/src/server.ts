import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  OkxRestClient, SQLiteMemoryStore,
  registerMemoryTools, registerMarketTools, registerRiskTools, registerPortfolioTools,
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
    ...registerPortfolioTools(),
  ];
  const toolMap = new Map(tools.map(t => [t.name, t]));

  const server = new Server(
    { name: "memofinance", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: `MemoFinance — persistent memory-backed finance intelligence ASP. 26 tools across 4 categories, all tested with real OKX market data and memory persistence. Free to use.

MEMORY MANAGEMENT (8): store_finance_context, recall_finance_context, set_risk_preference, delete_finance_context, summarize_agent_memory, export_agent_memory, get_memory_stats, search_finance_context — store and recall analyses/preferences/decisions across sessions scoped by agent_id.

MARKET DATA (7): get_onchain_data, get_trending_pairs, compare_assets, get_funding_rate, get_instrument_info, get_historical_volatility, get_correlation_brief — real-time OKX market data, candles, orderbook, funding rates, volatility analysis.

PORTFOLIO TOOLS (7): track_portfolio_entry, get_portfolio_pnl, get_portfolio_summary, get_portfolio_history, remove_portfolio_entry, set_price_alert, check_price_alerts — track positions with live P&L, allocation breakdown, price alerts.

PERSONALIZATION & INTELLIGENCE (4): get_market_sentiment, get_personalized_brief, risk_alpha_score, yield_advisor — memory-aware risk scoring, morning briefs from stored watchlist, yield ranked by stored risk preference.

Key differentiator: every intelligence tool reads stored agent memory to personalize output. Agents that call MemoFinance across sessions get context-aware responses that improve over time.`,
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
