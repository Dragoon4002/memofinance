import type { ToolSpec, ToolContext } from "./types.js";

export function registerMemoryTools(): ToolSpec[] {
  return [
    {
      name: "store_finance_context",
      description: "Persist a finance analysis, decision, preference, or outcome to agent memory for future recall.",
      isWrite: true,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Unique agent identifier" },
          context_type: {
            type: "string",
            enum: ["analysis", "preference", "decision", "outcome"],
            description: "Category of context being stored",
          },
          content: { type: "object", description: "Arbitrary JSON content to store" },
          tags: { type: "array", items: { type: "string" }, description: "Optional tags for filtering (e.g. ['BTC', 'risk'])" },
        },
        required: ["agent_id", "context_type", "content"],
      },
      handler: async (args, ctx: ToolContext) => {
        const agentId = args.agent_id as string;
        const contextType = args.context_type as string;
        const content = args.content as unknown;
        const tags = (args.tags as string[] | undefined) ?? [];
        const id = await ctx.memoryStore.store(agentId, contextType, content, tags);
        return {
          id, stored: true, agent_id: agentId, context_type: contextType,
          card: `✅ Stored ${contextType} for ${agentId}${tags.length ? ` [${tags.join(", ")}]` : ""} — ID: ${id.slice(0, 8)}`,
        };
      },
    },
    {
      name: "recall_finance_context",
      description: "Retrieve stored finance context for an agent, optionally filtered by type, tags, or keyword.",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Unique agent identifier" },
          context_type: { type: "string", enum: ["analysis", "preference", "decision", "outcome"], description: "Filter by type" },
          tags: { type: "array", items: { type: "string" }, description: "Filter by tags" },
          keyword: { type: "string", description: "Keyword to search in content" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["agent_id"],
      },
      handler: async (args, ctx: ToolContext) => {
        const memories = await ctx.memoryStore.recall(args.agent_id as string, {
          contextType: args.context_type as string | undefined,
          tags: args.tags as string[] | undefined,
          keyword: args.keyword as string | undefined,
          limit: args.limit as number | undefined,
        });
        const parsed = memories.map(m => ({
          id: m.id,
          context_type: m.context_type,
          content: JSON.parse(m.content) as unknown,
          tags: m.tags ? m.tags.split(",").filter(Boolean) : [],
          created_at: new Date(m.created_at).toISOString(),
        }));
        return {
          count: memories.length,
          memories: parsed,
          card: memories.length === 0
            ? `🔍 No memories found for ${args.agent_id as string}`
            : `🧠 ${memories.length} memor${memories.length === 1 ? "y" : "ies"} recalled for ${args.agent_id as string}${args.context_type ? ` (${args.context_type as string})` : ""}`,
        };
      },
    },
    {
      name: "set_risk_preference",
      description: "Shortcut to store an agent's risk tolerance and capital in one call. Automatically used by yield_advisor and risk_alpha_score.",
      isWrite: true,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent identifier" },
          risk_tolerance: { type: "string", enum: ["low", "medium", "high"], description: "Risk tolerance level" },
          capital_usdt: { type: "number", description: "Available capital in USDT" },
          notes: { type: "string", description: "Optional investment goals or notes" },
        },
        required: ["agent_id", "risk_tolerance"],
      },
      handler: async (args, ctx: ToolContext) => {
        const agentId = args.agent_id as string;
        const riskTolerance = args.risk_tolerance as string;
        const capitalUsdt = args.capital_usdt as number | undefined;
        const notes = args.notes as string | undefined;

        const id = await ctx.memoryStore.store(agentId, "preference", {
          risk_tolerance: riskTolerance,
          ...(capitalUsdt !== undefined && { capital_usdt: capitalUsdt }),
          ...(notes && { notes }),
        }, ["preference", "risk"]);

        return {
          id, stored: true, risk_tolerance: riskTolerance, capital_usdt: capitalUsdt,
          card: `⚙️ Risk preference saved for ${agentId}: risk=${riskTolerance}${capitalUsdt ? `, capital=$${capitalUsdt} USDT` : ""}`,
        };
      },
    },
    {
      name: "delete_finance_context",
      description: "Delete a specific memory entry by ID for an agent.",
      isWrite: true,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent identifier" },
          memory_id: { type: "string", description: "Memory ID to delete (from store or recall results)" },
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
            ? `🗑️ Memory ${memoryId.slice(0, 8)} deleted for ${agentId}`
            : `⚠️ Memory ${memoryId.slice(0, 8)} not found for ${agentId}`,
        };
      },
    },
    {
      name: "summarize_agent_memory",
      description: "Compress stored memories for an agent into a rolling summary and store it back. Reduces token usage on future recalls.",
      isWrite: true,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent identifier" },
          context_type: { type: "string", enum: ["analysis", "preference", "decision", "outcome"], description: "Type to summarize (omit for all)" },
        },
        required: ["agent_id"],
      },
      handler: async (args, ctx: ToolContext) => {
        const agentId = args.agent_id as string;
        const contextType = args.context_type as string | undefined;
        const memories = await ctx.memoryStore.recall(agentId, { contextType, limit: 100 });
        if (memories.length === 0) return { count: 0, card: `🧠 No memories to summarize for ${agentId}` };

        const grouped: Record<string, unknown[]> = {};
        for (const m of memories) {
          if (!grouped[m.context_type]) grouped[m.context_type] = [];
          grouped[m.context_type]!.push(JSON.parse(m.content) as unknown);
        }

        const summary = Object.entries(grouped).map(([type, items]) =>
          `${type}(${items.length}): ${JSON.stringify(items.slice(-3))}`
        ).join(" | ");

        const id = await ctx.memoryStore.store(agentId, "analysis", {
          type: "summary", summarized_count: memories.length, summary,
          generated_at: new Date().toISOString(),
        }, ["summary", ...(contextType ? [contextType] : [])]);

        return {
          id, summarized_count: memories.length, summary,
          card: `🗜️ Summarized ${memories.length} memories for ${agentId} → stored ID: ${id.slice(0, 8)}`,
        };
      },
    },
    {
      name: "export_agent_memory",
      description: "Export all stored memories for an agent as structured JSON — useful for backup or cross-agent sharing.",
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
        const memories = await ctx.memoryStore.recall(agentId, { limit: 1000 });
        const exported = memories.map(m => ({
          id: m.id, context_type: m.context_type,
          content: JSON.parse(m.content) as unknown,
          tags: m.tags ? m.tags.split(",").filter(Boolean) : [],
          created_at: new Date(m.created_at).toISOString(),
        }));
        return {
          agent_id: agentId, count: exported.length, memories: exported,
          card: `📤 Exported ${exported.length} memories for ${agentId}`,
        };
      },
    },
    {
      name: "get_memory_stats",
      description: "Get a summary of stored memories for an agent — count by type, oldest and newest entry, total storage.",
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
        const all = await ctx.memoryStore.recall(agentId, { limit: 1000 });
        if (all.length === 0) return { total: 0, card: `📭 No memories found for ${agentId}` };

        const byType: Record<string, number> = {};
        for (const m of all) byType[m.context_type] = (byType[m.context_type] ?? 0) + 1;

        const sorted = [...all].sort((a, b) => a.created_at - b.created_at);
        const oldest = new Date(sorted[0]!.created_at).toISOString();
        const newest = new Date(sorted[sorted.length - 1]!.created_at).toISOString();

        const typeBreakdown = Object.entries(byType).map(([t, c]) => `${t}:${c}`).join(" | ");
        return {
          agent_id: agentId, total: all.length, by_type: byType, oldest, newest,
          card: `📊 Memory stats [${agentId}] — ${all.length} total | ${typeBreakdown} | Oldest: ${oldest.slice(0, 10)} | Newest: ${newest.slice(0, 10)}`,
        };
      },
    },
    {
      name: "search_finance_context",
      description: "Full-text search across all memory types for an agent. More powerful than recall — searches content, tags, and type simultaneously.",
      isWrite: false,
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent identifier" },
          query: { type: "string", description: "Search query — matched against content and tags" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["agent_id", "query"],
      },
      handler: async (args, ctx: ToolContext) => {
        const agentId = args.agent_id as string;
        const query = args.query as string;
        const limit = (args.limit as number | undefined) ?? 10;

        const memories = await ctx.memoryStore.recall(agentId, { keyword: query, limit });
        const parsed = memories.map(m => ({
          id: m.id, context_type: m.context_type,
          content: JSON.parse(m.content) as unknown,
          tags: m.tags ? m.tags.split(",").filter(Boolean) : [],
          created_at: new Date(m.created_at).toISOString(),
        }));

        return {
          query, count: parsed.length, results: parsed,
          card: parsed.length === 0
            ? `🔍 No results for "${query}" in ${agentId}'s memory`
            : `🔍 ${parsed.length} result(s) for "${query}" in ${agentId}'s memory`,
        };
      },
    },
  ];
}
