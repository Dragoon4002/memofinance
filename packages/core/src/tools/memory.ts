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
        const id = ctx.memoryStore.store(agentId, contextType, content, tags);
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
        const memories = ctx.memoryStore.recall(args.agent_id as string, {
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
  ];
}
