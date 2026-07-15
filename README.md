# MemoFinance

Persistent memory-backed finance intelligence ASP for OKX.AI. Agents store past analyses, preferences, and decisions — recalled on future calls for context-aware risk scoring and personalized yield advice.

Unlike stateless data feeds, MemoFinance remembers your agent's history across sessions.

## Tools

| Tool | Description |
|------|-------------|
| `store_finance_context` | Persist analysis, preference, decision, or outcome to agent memory |
| `recall_finance_context` | Retrieve stored context by type, tags, or keyword |
| `get_onchain_data` | Real-time price, candles, and orderbook from OKX markets |
| `risk_alpha_score` | Volatility + trend score with memory context injection |
| `yield_advisor` | Ranked yield opportunities filtered by stored risk preference |

## Quick Start

```bash
# Install dependencies and build
pnpm install
pnpm build

# Run MCP server
node packages/mcp/dist/index.js
```

## Claude Code / MCP Setup

Copy `.mcp.json.example` to `.mcp.json` and update the paths:

```bash
cp .mcp.json.example .mcp.json
```

Edit `.mcp.json`:
```json
{
  "mcpServers": {
    "memofinance": {
      "command": "node",
      "args": ["/absolute/path/to/memofinance/packages/mcp/dist/index.js"],
      "env": {
        "MEMOFINANCE_DB": "/absolute/path/to/memofinance/data/memories.db",
        "OKX_BASE_URL": "https://www.okx.com"
      }
    }
  }
}
```

Restart Claude Code — all 5 tools are available immediately.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMOFINANCE_DB` | `./data/memories.db` | SQLite database path |
| `OKX_BASE_URL` | `https://www.okx.com` | OKX API base URL (override if geoblocked) |

## Example Usage

**Store a preference:**
> Use store_finance_context to store that agent "my-agent" prefers low risk tolerance with 500 USDT capital.

**Get personalized yield advice:**
> Use yield_advisor for agent "my-agent" — let it read risk preference from memory.

**Risk score with memory context:**
> Use risk_alpha_score for agent "my-agent" on BTC-USDT with include_memory true.

## Requirements

- Node.js 18+
- pnpm 8+
- Python 3 (for `better-sqlite3` native build)

## Architecture

```
packages/
  core/   — OKX REST client, SQLite memory store, all 5 tool specs
  mcp/    — MCP stdio server wiring (StdioServerTransport)
```

## License

MIT
