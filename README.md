# MemoFinance

Persistent memory-backed finance intelligence ASP for OKX.AI. 26 tools across 4 categories — all tested with real OKX market data and memory persistence.

Unlike stateless data feeds, MemoFinance remembers your agent's history across sessions. Every intelligence tool reads stored agent memory to personalize its output.

**Pricing: Free** — no per-call charge. Use all 26 tools at zero cost.

---

## Tool Categories

### Memory Management (8 tools)
| Tool | Description |
|------|-------------|
| `store_finance_context` | Persist analysis, preference, decision, or outcome |
| `recall_finance_context` | Retrieve stored context by type, tags, or keyword |
| `set_risk_preference` | Shortcut to store risk tolerance + capital in one call |
| `delete_finance_context` | Remove a specific memory entry by ID |
| `summarize_agent_memory` | Compress old memories into a rolling summary |
| `export_agent_memory` | Export all memories as JSON for backup/sharing |
| `get_memory_stats` | Count by type, oldest/newest entry, total stored |
| `search_finance_context` | Full-text search across all memory types |

### Market Data (7 tools)
| Tool | Description |
|------|-------------|
| `get_onchain_data` | Real-time price, candles, orderbook from OKX |
| `get_trending_pairs` | Top movers sorted by 24h change magnitude |
| `compare_assets` | Side-by-side ticker comparison for 2-3 pairs |
| `get_funding_rate` | Perpetual swap funding rate + sentiment signal |
| `get_instrument_info` | Contract specs: tick size, lot size, trading status |
| `get_historical_volatility` | 7d vs 30d volatility comparison from candle data |
| `get_correlation_brief` | BTC/ETH/SOL 24h correlation — macro vs divergence |

### Portfolio Tools (7 tools)
| Tool | Description |
|------|-------------|
| `track_portfolio_entry` | Store a buy position: symbol, price, amount |
| `get_portfolio_pnl` | Live P&L for all stored positions vs current prices |
| `get_portfolio_summary` | Allocation %, best/worst performer, total value |
| `get_portfolio_history` | Chronological list of all entries with costs |
| `remove_portfolio_entry` | Delete a position by memory ID |
| `set_price_alert` | Store a price target (above/below) for any symbol |
| `check_price_alerts` | Scan all stored alerts against live prices |

### Personalization & Intelligence (4 tools)
| Tool | Description |
|------|-------------|
| `get_market_sentiment` | Aggregate sentiment across 50 USDT pairs (0-100 score) |
| `get_personalized_brief` | Morning brief — pulls watchlist + prefs from memory |
| `risk_alpha_score` | Volatility + trend score with memory context injection |
| `yield_advisor` | Yield opportunities ranked by stored risk preference |

---

## Quick Start

```bash
# Install and build
pnpm install
pnpm build

# Run MCP server
node packages/mcp/dist/index.js
```

## MCP Setup (Claude Code / OpenCode)

```bash
cp .mcp.json.example .mcp.json
```

Edit `.mcp.json` with your absolute paths:
```json
{
  "mcpServers": {
    "memofinance": {
      "command": "node",
      "args": ["/absolute/path/to/memofinance/packages/mcp/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://...",
        "OKX_BASE_URL": "https://www.okx.com"
      }
    }
  }
}
```

Restart Claude Code — all 26 tools available immediately.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Neon recommended) |
| `OKX_BASE_URL` | No | OKX API base URL (default: `https://www.okx.com`) |

## Example Agent Workflows

**Set up agent profile:**
> Use set_risk_preference for agent "alice" with low risk tolerance and 500 USDT capital.

**Personalized yield advice (reads memory):**
> Use yield_advisor for agent "alice" — omit risk_tolerance to read from stored preference.

**Track a portfolio position:**
> Use track_portfolio_entry for agent "alice": BTC-USDT, bought 0.1 BTC at $96000.

**Live P&L check:**
> Use get_portfolio_pnl for agent "alice".

**Morning brief (auto-pulls portfolio + prefs from memory):**
> Use get_personalized_brief for agent "alice".

**Risk score with memory context:**
> Use risk_alpha_score for agent "alice" on BTC-USDT with include_memory true.

## Reliability

All 26 tools tested against:
- Real OKX public market data endpoints
- SQLite + PostgreSQL memory persistence
- Memory recall injection into intelligence tools
- End-to-end pipeline: store preference → call advisor → verify memory context in output

## Architecture

```
packages/
  core/   — OKX REST client, PostgreSQL memory store, 26 tool specs across 4 modules
  mcp/    — MCP stdio server (StdioServerTransport)
```

## Requirements

- Node.js 18+
- pnpm 8+
- PostgreSQL (Neon free tier works)

## License

MIT
