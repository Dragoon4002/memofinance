import type { ToolSpec, ToolContext } from "./types.js";

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length);
}

interface OkxResponse {
  code: string;
  data: Record<string, string>[];
  msg: string;
}

export function normalizeTickerResponse(raw: unknown, symbol: string) {
  const resp = raw as OkxResponse;
  if (resp.code !== "0" || !resp.data?.[0]) throw new Error(`OKX error: ${resp.msg}`);
  const d = resp.data[0];
  const last = parseFloat(d.last ?? "0");
  const open24h = parseFloat(d.open24h ?? "0");
  const change = open24h > 0 ? (((last - open24h) / open24h) * 100).toFixed(2) : "0.00";
  const vol24h = parseFloat(d.volCcy24h ?? d.vol24h ?? "0");
  const volStr = vol24h > 1_000_000_000 ? `${(vol24h / 1_000_000_000).toFixed(2)}B`
    : vol24h > 1_000_000 ? `${(vol24h / 1_000_000).toFixed(2)}M` : vol24h.toFixed(2);
  return {
    symbol,
    price: d.last,
    change_24h: `${parseFloat(change) >= 0 ? "+" : ""}${change}%`,
    volume_24h: volStr,
    high_24h: d.high24h,
    low_24h: d.low24h,
    open_24h: d.open24h,
    bid: d.bidPx,
    ask: d.askPx,
  };
}

export function normalizeCandles(raw: unknown, symbol: string) {
  const resp = raw as OkxResponse;
  if (resp.code !== "0") throw new Error(`OKX error: ${resp.msg}`);
  const candles = resp.data.map(c => ({
    time: new Date(parseInt(c[0]!)).toISOString(),
    open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
  }));
  return { symbol, bar: "1H", candles };
}

export function registerMarketTools(): ToolSpec[] {
  return [
    {
      name: "get_onchain_data",
      description: "Fetch real-time market data for a token pair from OKX. Supports price, candles, orderbook, and full ticker data.",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading pair e.g. BTC-USDT, ETH-USDT, SOL-USDT" },
          data_type: {
            type: "string",
            enum: ["ticker", "price", "candles", "orderbook"],
            description: "Type of data to fetch (default: ticker)",
          },
        },
        required: ["symbol"],
      },
      handler: async (args, ctx: ToolContext) => {
        const symbol = args.symbol as string;
        const dataType = (args.data_type as string | undefined) ?? "ticker";

        if (dataType === "ticker" || dataType === "price") {
          const raw = await ctx.client.publicGet("/api/v5/market/ticker", { instId: symbol });
          const normalized = normalizeTickerResponse(raw, symbol);
          if (dataType === "price") {
            return { symbol, price: normalized.price, change_24h: normalized.change_24h, card: `💰 ${symbol}: $${normalized.price} (${normalized.change_24h} 24h)` };
          }
          return { ...normalized, card: `📊 ${symbol} — $${normalized.price} | 24h: ${normalized.change_24h} | Vol: ${normalized.volume_24h} | H: ${normalized.high_24h} L: ${normalized.low_24h}` };
        }

        if (dataType === "candles") {
          const raw = await ctx.client.publicGet("/api/v5/market/candles", { instId: symbol, bar: "1H", limit: "24" });
          const result = normalizeCandles(raw, symbol);
          return { ...result, card: `🕯️ ${symbol} — ${result.candles.length} hourly candles (last 24h)` };
        }

        if (dataType === "orderbook") {
          const raw = await ctx.client.publicGet("/api/v5/market/books", { instId: symbol, sz: "10" }) as OkxResponse;
          if (raw.code !== "0" || !raw.data?.[0]) throw new Error(`OKX error: ${raw.msg}`);
          const book = raw.data[0] as unknown as { bids: string[][]; asks: string[][] };
          const bids = book.bids.slice(0, 10).map(b => ({ price: b[0], size: b[1] }));
          const asks = book.asks.slice(0, 10).map(a => ({ price: a[0], size: a[1] }));
          return {
            symbol, bids, asks,
            card: `📖 ${symbol} orderbook — Best bid: $${bids[0]?.price} | Best ask: $${asks[0]?.price}`,
          };
        }

        throw new Error(`Unknown data_type: ${dataType}`);
      },
    },
    {
      name: "get_trending_pairs",
      description: "Fetch top trending trading pairs on OKX sorted by 24h price change magnitude. Returns most active markets right now.",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of pairs to return (default 10, max 20)" },
          inst_type: { type: "string", enum: ["SPOT", "SWAP"], description: "Instrument type (default SPOT)" },
        },
        required: [],
      },
      handler: async (args, ctx: ToolContext) => {
        const limit = Math.min((args.limit as number | undefined) ?? 10, 20);
        const instType = (args.inst_type as string | undefined) ?? "SPOT";
        const raw = await ctx.client.publicGet("/api/v5/market/tickers", { instType }) as OkxResponse;
        if (raw.code !== "0") throw new Error(`OKX error: ${raw.msg}`);

        const sorted = raw.data
          .filter(d => d.instId?.endsWith("-USDT"))
          .map(d => {
            const last = parseFloat(d.last ?? "0");
            const open24h = parseFloat(d.open24h ?? "0");
            const volCcy = parseFloat(d.volCcy24h ?? d.vol24h ?? "0");
            const change = open24h > 0 ? (((last - open24h) / open24h) * 100) : 0;
            return { symbol: d.instId, price: d.last, change_24h: `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`, volume_24h_usdt: volCcy, change_raw: change };
          })
          .sort((a, b) => Math.abs(b.change_raw) - Math.abs(a.change_raw))
          .slice(0, limit);

        const cardLines = sorted.map((p, i) => `${i + 1}. ${p.symbol} $${p.price} (${p.change_24h})`).join(" | ");
        return {
          count: sorted.length, inst_type: instType,
          pairs: sorted.map(({ change_raw: _r, ...rest }) => rest),
          card: `🔥 Top ${sorted.length} trending ${instType} pairs: ${cardLines}`,
        };
      },
    },
    {
      name: "compare_assets",
      description: "Compare live ticker data for 2-3 trading pairs side by side — price, 24h change, volume.",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          symbols: {
            type: "array", items: { type: "string" },
            description: "2-3 trading pairs e.g. ['BTC-USDT', 'ETH-USDT', 'SOL-USDT']",
            minItems: 2, maxItems: 3,
          },
        },
        required: ["symbols"],
      },
      handler: async (args, ctx: ToolContext) => {
        const symbols = args.symbols as string[];
        const results = await Promise.all(symbols.map(async (symbol) => {
          const raw = await ctx.client.publicGet("/api/v5/market/ticker", { instId: symbol });
          return normalizeTickerResponse(raw, symbol);
        }));

        const best = results.reduce((a, b) =>
          parseFloat(a.change_24h.replace("%", "")) > parseFloat(b.change_24h.replace("%", "")) ? a : b
        );
        const cardLines = results.map(r => `${r.symbol}: $${r.price} (${r.change_24h})`).join(" vs ");
        return {
          count: results.length, assets: results, best_performer: best.symbol,
          card: `⚖️ Compare: ${cardLines} | 🏆 Best: ${best.symbol}`,
        };
      },
    },
    {
      name: "get_funding_rate",
      description: "Get the current funding rate for a perpetual swap contract. Positive = longs pay shorts (bearish), negative = shorts pay longs (bullish).",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Perp swap pair e.g. BTC-USDT-SWAP or BTC-USDT (auto-appended)" },
        },
        required: ["symbol"],
      },
      handler: async (args, ctx: ToolContext) => {
        const symbol = args.symbol as string;
        const instId = symbol.endsWith("-SWAP") ? symbol : `${symbol}-SWAP`;
        const raw = await ctx.client.publicGet("/api/v5/public/funding-rate", { instId }) as OkxResponse;
        if (raw.code !== "0" || !raw.data?.[0]) throw new Error(`OKX error: ${raw.msg}`);
        const d = raw.data[0]!;
        const rate = parseFloat(d.fundingRate ?? "0");
        const ratePct = (rate * 100).toFixed(4);
        const nextRate = parseFloat(d.nextFundingRate ?? "0");
        const nextPct = (nextRate * 100).toFixed(4);
        const sentiment = rate > 0.01 ? "🐂 Longs heavy — bearish signal" : rate < -0.01 ? "🐻 Shorts heavy — bullish signal" : "➡️ Neutral";
        return {
          symbol: instId, funding_rate: d.fundingRate, funding_rate_pct: `${ratePct}%`,
          next_funding_rate_pct: `${nextPct}%`, funding_time: d.fundingTime, sentiment,
          card: `💸 ${instId} Funding: ${ratePct}% | Next: ${nextPct}% | ${sentiment}`,
        };
      },
    },
    {
      name: "get_instrument_info",
      description: "Get contract specifications for a trading pair — tick size, lot size, min order size, and trading status.",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading pair e.g. BTC-USDT" },
          inst_type: { type: "string", enum: ["SPOT", "SWAP", "FUTURES", "OPTION"], description: "Instrument type (default SPOT)" },
        },
        required: ["symbol"],
      },
      handler: async (args, ctx: ToolContext) => {
        const symbol = args.symbol as string;
        const instType = (args.inst_type as string | undefined) ?? "SPOT";
        const raw = await ctx.client.publicGet("/api/v5/public/instruments", { instType, instId: symbol }) as OkxResponse;
        if (raw.code !== "0" || !raw.data?.[0]) throw new Error(`OKX error: ${raw.msg}`);
        const d = raw.data[0]!;
        return {
          symbol: d.instId, inst_type: d.instType, state: d.state,
          tick_size: d.tickSz, lot_size: d.lotSz, min_size: d.minSz,
          base_currency: d.baseCcy, quote_currency: d.quoteCcy,
          card: `📋 ${d.instId} [${d.instType}] | Status: ${d.state} | Tick: ${d.tickSz} | Lot: ${d.lotSz} | Min: ${d.minSz}`,
        };
      },
    },
    {
      name: "get_historical_volatility",
      description: "Compare 7-day vs 30-day volatility for a symbol using hourly candle data. Shows if recent vol is expanding or contracting.",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading pair e.g. BTC-USDT" },
        },
        required: ["symbol"],
      },
      handler: async (args, ctx: ToolContext) => {
        const symbol = args.symbol as string;
        const raw30 = await ctx.client.publicGet("/api/v5/market/candles", { instId: symbol, bar: "1H", limit: "720" });
        const { candles } = normalizeCandles(raw30, symbol);

        const closes = candles.map(c => parseFloat(c.close ?? "0")).filter(v => v > 0);
        const pctChanges = closes.slice(1).map((c, i) => Math.abs((c - closes[i]!) / closes[i]!) * 100);

        const vol7d = stddev(pctChanges.slice(0, 168));
        const vol30d = stddev(pctChanges);
        const trend = vol7d > vol30d * 1.2 ? "📈 Expanding" : vol7d < vol30d * 0.8 ? "📉 Contracting" : "➡️ Stable";

        return {
          symbol, vol_7d: vol7d.toFixed(4), vol_30d: vol30d.toFixed(4),
          vol_trend: trend, candles_analyzed: closes.length,
          card: `📊 ${symbol} Vol — 7d: ${vol7d.toFixed(3)}% | 30d: ${vol30d.toFixed(3)}% | Trend: ${trend}`,
        };
      },
    },
    {
      name: "get_correlation_brief",
      description: "Compute 24h price correlation between BTC, ETH, and SOL. High correlation = market moving together (macro-driven). Low = divergence.",
      isWrite: false,
      inputSchema: { type: "object", properties: {}, required: [] },
      handler: async (_args, ctx: ToolContext) => {
        const symbols = ["BTC-USDT", "ETH-USDT", "SOL-USDT"];
        const candles = await Promise.all(symbols.map(async (s) => {
          const raw = await ctx.client.publicGet("/api/v5/market/candles", { instId: s, bar: "1H", limit: "24" });
          const { candles: c } = normalizeCandles(raw, s);
          return c.map(x => parseFloat(x.close ?? "0"));
        }));

        function pearson(a: number[], b: number[]): number {
          const n = Math.min(a.length, b.length);
          const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
          const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
          const num = a.slice(0, n).reduce((s, v, i) => s + (v - meanA) * (b[i]! - meanB), 0);
          const den = Math.sqrt(
            a.slice(0, n).reduce((s, v) => s + Math.pow(v - meanA, 2), 0) *
            b.slice(0, n).reduce((s, v) => s + Math.pow(v - meanB, 2), 0)
          );
          return den === 0 ? 0 : num / den;
        }

        const [btc, eth, sol] = candles as [number[], number[], number[]];
        const btcEth = pearson(btc, eth);
        const btcSol = pearson(btc, sol);
        const ethSol = pearson(eth, sol);
        const avgCorr = (btcEth + btcSol + ethSol) / 3;
        const signal = avgCorr > 0.8 ? "🔗 High correlation — macro-driven market" : avgCorr < 0.4 ? "🔀 Low correlation — divergence, altcoins moving independently" : "〰️ Moderate correlation";

        return {
          btc_eth: btcEth.toFixed(3), btc_sol: btcSol.toFixed(3), eth_sol: ethSol.toFixed(3),
          avg_correlation: avgCorr.toFixed(3), signal,
          card: `🔗 Correlation (24h) — BTC/ETH: ${btcEth.toFixed(2)} | BTC/SOL: ${btcSol.toFixed(2)} | ETH/SOL: ${ethSol.toFixed(2)} | ${signal}`,
        };
      },
    },
  ];
}
