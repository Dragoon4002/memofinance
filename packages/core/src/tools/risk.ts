import type { ToolSpec, ToolContext } from "./types.js";
import { normalizeTickerResponse, normalizeCandles } from "./market.js";

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function volatilityScore(candles: { close: string }[]): { score: number; label: "low" | "medium" | "high" } {
  const closes = candles.map(c => parseFloat(c.close));
  if (closes.length < 2) return { score: 50, label: "medium" };
  const pctChanges = closes.slice(1).map((c, i) => Math.abs((c - closes[i]!) / closes[i]!) * 100);
  const vol = stddev(pctChanges);
  if (vol < 1) return { score: Math.round(vol * 30), label: "low" };
  if (vol < 3) return { score: Math.round(30 + vol * 10), label: "medium" };
  return { score: Math.min(100, Math.round(60 + vol * 5)), label: "high" };
}

function trendSignal(ticker: { price: string; open_24h: string }): "bullish" | "bearish" | "neutral" {
  const price = parseFloat(ticker.price);
  const open = parseFloat(ticker.open_24h);
  const change = ((price - open) / open) * 100;
  if (change > 2) return "bullish";
  if (change < -2) return "bearish";
  return "neutral";
}

const YIELD_OPPORTUNITIES = [
  { protocol: "OKX Earn - USDT Simple", apy: "8.5%", risk: "low", network: "OKX CEX", min_usdt: 1 },
  { protocol: "OKX Earn - ETH Staking", apy: "4.2%", risk: "low", network: "Ethereum", min_usdt: 100 },
  { protocol: "OKX Earn - BTC Savings", apy: "3.1%", risk: "low", network: "Bitcoin", min_usdt: 100 },
  { protocol: "PancakeSwap USDT-USDC LP", apy: "12.4%", risk: "medium", network: "X Layer", min_usdt: 50 },
  { protocol: "Aave USDC Supply", apy: "6.8%", risk: "medium", network: "Ethereum", min_usdt: 10 },
  { protocol: "Uniswap V3 ETH-USDC", apy: "18.2%", risk: "high", network: "Ethereum", min_usdt: 500 },
];

export function registerRiskTools(): ToolSpec[] {
  return [
    {
      name: "risk_alpha_score",
      description: "Compute a combined risk + momentum score for a token pair. Optionally incorporates past agent memory for personalized context.",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent identifier for memory lookup" },
          symbol: { type: "string", description: "Trading pair e.g. BTC-USDT" },
          include_memory: { type: "boolean", description: "Include past analyses from agent memory (default: true)" },
        },
        required: ["agent_id", "symbol"],
      },
      handler: async (args, ctx: ToolContext) => {
        const symbol = args.symbol as string;
        const agentId = args.agent_id as string;
        const includeMemory = (args.include_memory as boolean | undefined) ?? true;

        const [tickerRaw, candlesRaw] = await Promise.all([
          ctx.client.publicGet("/api/v5/market/ticker", { instId: symbol }),
          ctx.client.publicGet("/api/v5/market/candles", { instId: symbol, bar: "1H", limit: "24" }),
        ]);

        const ticker = normalizeTickerResponse(tickerRaw, symbol);
        const { candles } = normalizeCandles(candlesRaw, symbol);
        const { score: volScore, label: volLabel } = volatilityScore(candles);
        const trend = trendSignal(ticker);

        const riskScore = trend === "bullish"
          ? Math.max(10, volScore - 10)
          : trend === "bearish"
          ? Math.min(100, volScore + 15)
          : volScore;

        let memoryContext: string | null = null;
        if (includeMemory) {
          const memories = ctx.memoryStore.recall(agentId, { keyword: symbol.split("-")[0], limit: 3 });
          if (memories.length > 0) {
            memoryContext = memories
              .map(m => `[${m.context_type}] ${JSON.stringify(JSON.parse(m.content) as unknown)}`)
              .join(" | ");
          }
        }

        const recommendation =
          riskScore < 30 ? "Strong buy signal — low volatility, positive momentum"
          : riskScore < 50 ? "Cautious buy — moderate risk, watch for reversal"
          : riskScore < 70 ? "Hold — elevated volatility, wait for confirmation"
          : "Avoid / reduce — high risk environment";

        const riskEmoji = riskScore < 30 ? "🟢" : riskScore < 50 ? "🟡" : riskScore < 70 ? "🟠" : "🔴";
        const trendEmoji = trend === "bullish" ? "📈" : trend === "bearish" ? "📉" : "➡️";
        return {
          symbol,
          risk_score: riskScore,
          trend,
          volatility: volLabel,
          current_price: ticker.price,
          change_24h: ticker.change_24h,
          memory_context: memoryContext,
          recommendation,
          confidence: volLabel === "low" ? "high" : volLabel === "medium" ? "medium" : "low",
          card: `${riskEmoji} ${symbol} Risk Score: ${riskScore}/100 | ${trendEmoji} ${trend.toUpperCase()} | Volatility: ${volLabel} | ${recommendation}${memoryContext ? ` | 🧠 Memory: ${memoryContext.slice(0, 80)}...` : ""}`,
        };
      },
    },
    {
      name: "yield_advisor",
      description: "Get personalized stablecoin and DeFi yield recommendations based on stored agent preferences and risk tolerance.",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent identifier for preference lookup" },
          risk_tolerance: { type: "string", enum: ["low", "medium", "high"], description: "Override risk tolerance (uses stored preference if omitted)" },
          capital_usdt: { type: "number", description: "Available capital in USDT for filtering min investment" },
        },
        required: ["agent_id"],
      },
      handler: async (args, ctx: ToolContext) => {
        const agentId = args.agent_id as string;
        const capitalUsdt = (args.capital_usdt as number | undefined) ?? 0;

        let riskTolerance = args.risk_tolerance as string | undefined;
        let memoryContext: string | null = null;

        if (!riskTolerance) {
          const prefs = ctx.memoryStore.recall(agentId, { contextType: "preference", limit: 5 });
          const riskPref = prefs.find(p => {
            const c = JSON.parse(p.content) as Record<string, unknown>;
            return c.risk_tolerance;
          });
          if (riskPref) {
            const c = JSON.parse(riskPref.content) as Record<string, unknown>;
            riskTolerance = c.risk_tolerance as string;
            memoryContext = `Using stored preference: risk_tolerance=${riskTolerance}`;
          } else {
            riskTolerance = "medium";
            memoryContext = "No stored preference found, defaulting to medium risk";
          }
        }

        const riskOrder: Record<string, number> = { low: 0, medium: 1, high: 2 };
        const maxRisk = riskOrder[riskTolerance] ?? 1;

        const filtered = YIELD_OPPORTUNITIES
          .filter(o => (riskOrder[o.risk] ?? 0) <= maxRisk)
          .filter(o => capitalUsdt === 0 || o.min_usdt <= capitalUsdt)
          .sort((a, b) => parseFloat(b.apy) - parseFloat(a.apy))
          .slice(0, 3)
          .map((o, i) => ({ rank: i + 1, ...o, match_reason: `Fits ${riskTolerance} risk tolerance` }));

        const cardLines = filtered.map((o, i) => `${i + 1}. ${o.protocol} — ${o.apy} APY (${o.risk} risk, ${o.network})`).join(" | ");
        return {
          agent_id: agentId,
          risk_tolerance: riskTolerance,
          memory_context: memoryContext,
          capital_usdt: capitalUsdt || "unspecified",
          top_opportunities: filtered,
          card: `💰 Yield Advisor [${riskTolerance} risk]${capitalUsdt ? ` $${capitalUsdt} USDT` : ""}: ${cardLines}`,
        };
      },
    },
  ];
}
