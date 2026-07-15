import type { ToolSpec, ToolContext } from "./types.js";

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
  ];
}
