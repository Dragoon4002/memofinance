import type { ToolSpec, ToolContext } from "./types.js";
import { normalizeTickerResponse } from "./market.js";

export function registerPortfolioTools(): ToolSpec[] {
  return [
    {
      name: "track_portfolio_entry",
      description: "Store a portfolio position to agent memory — symbol, buy price, amount, and optional notes.",
      isWrite: true,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent identifier" },
          symbol: { type: "string", description: "Trading pair e.g. BTC-USDT" },
          buy_price: { type: "number", description: "Purchase price in USDT" },
          amount: { type: "number", description: "Amount of base asset purchased" },
          notes: { type: "string", description: "Optional notes about this position" },
        },
        required: ["agent_id", "symbol", "buy_price", "amount"],
      },
      handler: async (args, ctx: ToolContext) => {
        const agentId = args.agent_id as string;
        const symbol = args.symbol as string;
        const buyPrice = args.buy_price as number;
        const amount = args.amount as number;
        const notes = args.notes as string | undefined;
        const cost = buyPrice * amount;

        const id = await ctx.memoryStore.store(agentId, "portfolio", {
          symbol, buy_price: buyPrice, amount, cost_usdt: cost, notes,
          entry_date: new Date().toISOString(),
        }, ["portfolio", symbol.split("-")[0]!]);

        return {
          id, stored: true, symbol, buy_price: buyPrice, amount, cost_usdt: cost,
          card: `📥 Position stored: ${amount} ${symbol.split("-")[0]} @ $${buyPrice} | Cost: $${cost.toFixed(2)} USDT | ID: ${id.slice(0, 8)}`,
        };
      },
    },
    {
      name: "get_portfolio_pnl",
      description: "Fetch all stored portfolio positions for an agent and compute live P&L using current OKX prices.",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent identifier" },
        },
        required: ["agent_id"],
      },
      handler: async (args, ctx: ToolContext) => {
        const agentId = args.agent_id as string;
        const entries = await ctx.memoryStore.recall(agentId, { contextType: "portfolio", limit: 50 });
        if (entries.length === 0) {
          return { count: 0, positions: [], card: `📊 No portfolio entries found for ${agentId}` };
        }

        const positions = await Promise.all(entries.map(async (e) => {
          const pos = JSON.parse(e.content) as {
            symbol: string; buy_price: number; amount: number; cost_usdt: number; notes?: string;
          };
          try {
            const raw = await ctx.client.publicGet("/api/v5/market/ticker", { instId: pos.symbol });
            const ticker = normalizeTickerResponse(raw, pos.symbol);
            const currentPrice = parseFloat(ticker.price);
            const currentValue = currentPrice * pos.amount;
            const pnl = currentValue - pos.cost_usdt;
            const pnlPct = ((pnl / pos.cost_usdt) * 100).toFixed(2);
            const emoji = pnl >= 0 ? "📈" : "📉";
            return {
              symbol: pos.symbol, amount: pos.amount, buy_price: pos.buy_price,
              current_price: currentPrice, cost_usdt: pos.cost_usdt,
              current_value: parseFloat(currentValue.toFixed(2)),
              pnl: parseFloat(pnl.toFixed(2)), pnl_pct: `${parseFloat(pnlPct) >= 0 ? "+" : ""}${pnlPct}%`,
              card_line: `${emoji} ${pos.symbol}: ${pos.amount} @ $${pos.buy_price} → $${currentPrice} | PnL: $${pnl.toFixed(2)} (${pnlPct}%)`,
            };
          } catch {
            return {
              symbol: pos.symbol, amount: pos.amount, buy_price: pos.buy_price,
              current_price: null, cost_usdt: pos.cost_usdt, current_value: null,
              pnl: null, pnl_pct: null,
              card_line: `⚠️ ${pos.symbol}: price unavailable`,
            };
          }
        }));

        const totalCost = positions.reduce((s, p) => s + p.cost_usdt, 0);
        const totalValue = positions.reduce((s, p) => s + (p.current_value ?? p.cost_usdt), 0);
        const totalPnl = totalValue - totalCost;
        const totalPnlPct = ((totalPnl / totalCost) * 100).toFixed(2);

        return {
          count: positions.length, positions,
          total_cost_usdt: parseFloat(totalCost.toFixed(2)),
          total_value_usdt: parseFloat(totalValue.toFixed(2)),
          total_pnl: parseFloat(totalPnl.toFixed(2)),
          total_pnl_pct: `${parseFloat(totalPnlPct) >= 0 ? "+" : ""}${totalPnlPct}%`,
          card: `💼 Portfolio [${agentId}] — ${positions.length} positions | Cost: $${totalCost.toFixed(2)} | Value: $${totalValue.toFixed(2)} | PnL: $${totalPnl.toFixed(2)} (${totalPnlPct}%)\n${positions.map(p => `  ${p.card_line}`).join("\n")}`,
        };
      },
    },
    {
      name: "get_portfolio_summary",
      description: "Get a high-level portfolio summary — allocation %, best/worst performer, total value.",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent identifier" },
        },
        required: ["agent_id"],
      },
      handler: async (args, ctx: ToolContext) => {
        const agentId = args.agent_id as string;
        const entries = await ctx.memoryStore.recall(agentId, { contextType: "portfolio", limit: 50 });
        if (entries.length === 0) {
          return { card: `📊 No portfolio entries for ${agentId}` };
        }

        const prices = await Promise.all(entries.map(async (e) => {
          const pos = JSON.parse(e.content) as { symbol: string; buy_price: number; amount: number; cost_usdt: number };
          try {
            const raw = await ctx.client.publicGet("/api/v5/market/ticker", { instId: pos.symbol });
            const ticker = normalizeTickerResponse(raw, pos.symbol);
            const currentValue = parseFloat(ticker.price) * pos.amount;
            const pnlPct = ((currentValue - pos.cost_usdt) / pos.cost_usdt) * 100;
            return { symbol: pos.symbol, cost: pos.cost_usdt, value: currentValue, pnlPct };
          } catch {
            return { symbol: pos.symbol, cost: pos.cost_usdt, value: pos.cost_usdt, pnlPct: 0 };
          }
        }));

        const totalValue = prices.reduce((s, p) => s + p.value, 0);
        const withAlloc = prices.map(p => ({ ...p, allocation_pct: ((p.value / totalValue) * 100).toFixed(1) }));
        const best = withAlloc.reduce((a, b) => a.pnlPct > b.pnlPct ? a : b);
        const worst = withAlloc.reduce((a, b) => a.pnlPct < b.pnlPct ? a : b);

        return {
          agent_id: agentId, positions: withAlloc.length,
          total_value_usdt: parseFloat(totalValue.toFixed(2)),
          best_performer: { symbol: best.symbol, pnl_pct: `+${best.pnlPct.toFixed(2)}%` },
          worst_performer: { symbol: worst.symbol, pnl_pct: `${worst.pnlPct.toFixed(2)}%` },
          allocation: withAlloc.map(p => ({ symbol: p.symbol, pct: `${p.allocation_pct}%` })),
          card: `📊 Portfolio Summary [${agentId}] | $${totalValue.toFixed(2)} total | 🏆 Best: ${best.symbol} (+${best.pnlPct.toFixed(2)}%) | 💀 Worst: ${worst.symbol} (${worst.pnlPct.toFixed(2)}%) | Allocation: ${withAlloc.map(p => `${p.symbol} ${p.allocation_pct}%`).join(", ")}`,
        };
      },
    },
    {
      name: "set_price_alert",
      description: "Store a price alert target for a symbol. Use check_price_alerts to evaluate all stored alerts.",
      isWrite: true,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent identifier" },
          symbol: { type: "string", description: "Trading pair e.g. BTC-USDT" },
          target_price: { type: "number", description: "Alert trigger price in USDT" },
          direction: { type: "string", enum: ["above", "below"], description: "Trigger when price goes above or below target" },
        },
        required: ["agent_id", "symbol", "target_price", "direction"],
      },
      handler: async (args, ctx: ToolContext) => {
        const agentId = args.agent_id as string;
        const symbol = args.symbol as string;
        const targetPrice = args.target_price as number;
        const direction = args.direction as string;

        const id = await ctx.memoryStore.store(agentId, "alert", {
          symbol, target_price: targetPrice, direction, triggered: false,
          created_at: new Date().toISOString(),
        }, ["alert", symbol.split("-")[0]!]);

        return {
          id, symbol, target_price: targetPrice, direction,
          card: `🔔 Alert set: ${symbol} ${direction} $${targetPrice} | ID: ${id.slice(0, 8)}`,
        };
      },
    },
    {
      name: "check_price_alerts",
      description: "Check all stored price alerts for an agent against current market prices. Returns triggered alerts.",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent identifier" },
        },
        required: ["agent_id"],
      },
      handler: async (args, ctx: ToolContext) => {
        const agentId = args.agent_id as string;
        const alerts = await ctx.memoryStore.recall(agentId, { contextType: "alert", limit: 50 });
        if (alerts.length === 0) {
          return { triggered: [], pending: 0, card: `🔔 No alerts set for ${agentId}` };
        }

        const results = await Promise.all(alerts.map(async (a) => {
          const alert = JSON.parse(a.content) as { symbol: string; target_price: number; direction: string; triggered: boolean };
          try {
            const raw = await ctx.client.publicGet("/api/v5/market/ticker", { instId: alert.symbol });
            const ticker = normalizeTickerResponse(raw, alert.symbol);
            const currentPrice = parseFloat(ticker.price);
            const isTriggered = alert.direction === "above"
              ? currentPrice >= alert.target_price
              : currentPrice <= alert.target_price;
            return { ...alert, current_price: currentPrice, is_triggered: isTriggered, id: a.id };
          } catch {
            return { ...alert, current_price: null, is_triggered: false, id: a.id };
          }
        }));

        const triggered = results.filter(r => r.is_triggered);
        const pending = results.filter(r => !r.is_triggered);

        const cardLines = triggered.map(r =>
          `🚨 ${r.symbol}: $${r.current_price} is ${r.direction} target $${r.target_price}`
        ).join("\n");

        return {
          triggered, pending_count: pending.length,
          card: triggered.length === 0
            ? `🔔 ${alerts.length} alert(s) pending — none triggered yet`
            : `🚨 ${triggered.length} ALERT(S) TRIGGERED for ${agentId}:\n${cardLines}`,
        };
      },
    },
    {
      name: "remove_portfolio_entry",
      description: "Remove a portfolio position by memory ID. Get the ID from get_portfolio_pnl results.",
      isWrite: true,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent identifier" },
          memory_id: { type: "string", description: "Memory ID of the portfolio entry to remove" },
        },
        required: ["agent_id", "memory_id"],
      },
      handler: async (args, ctx: ToolContext) => {
        const agentId = args.agent_id as string;
        const memoryId = args.memory_id as string;
        const deleted = await ctx.memoryStore.delete(agentId, memoryId);
        return {
          deleted, memory_id: memoryId,
          card: deleted
            ? `🗑️ Portfolio entry ${memoryId.slice(0, 8)} removed for ${agentId}`
            : `⚠️ Entry ${memoryId.slice(0, 8)} not found for ${agentId}`,
        };
      },
    },
    {
      name: "get_portfolio_history",
      description: "List all portfolio entries for an agent in chronological order with entry dates and costs.",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent identifier" },
        },
        required: ["agent_id"],
      },
      handler: async (args, ctx: ToolContext) => {
        const agentId = args.agent_id as string;
        const entries = await ctx.memoryStore.recall(agentId, { contextType: "portfolio", limit: 100 });
        if (entries.length === 0) return { count: 0, card: `📭 No portfolio history for ${agentId}` };

        const positions = entries.map(e => {
          const pos = JSON.parse(e.content) as { symbol: string; buy_price: number; amount: number; cost_usdt: number; entry_date?: string; notes?: string };
          return {
            id: e.id.slice(0, 8),
            symbol: pos.symbol,
            amount: pos.amount,
            buy_price: pos.buy_price,
            cost_usdt: pos.cost_usdt,
            entry_date: pos.entry_date ?? new Date(e.created_at).toISOString(),
            notes: pos.notes,
          };
        }).sort((a, b) => a.entry_date.localeCompare(b.entry_date));

        const totalCost = positions.reduce((s, p) => s + p.cost_usdt, 0);
        return {
          agent_id: agentId, count: positions.length, total_invested_usdt: totalCost.toFixed(2),
          positions,
          card: `📜 Portfolio history [${agentId}] — ${positions.length} entries | Total invested: $${totalCost.toFixed(2)} USDT`,
        };
      },
    },
  ];
}
