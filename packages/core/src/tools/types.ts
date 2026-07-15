import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface ToolContext {
  memoryStore: import("../memory.js").SQLiteMemoryStore;
  client: import("../client.js").OkxRestClient;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isWrite: boolean;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export function toMcpTool(tool: ToolSpec): Tool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Tool["inputSchema"],
    annotations: {
      readOnlyHint: !tool.isWrite,
      destructiveHint: false,
      idempotentHint: !tool.isWrite,
      openWorldHint: true,
    },
  };
}

export function successResult(toolName: string, data: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ tool: toolName, ok: true, data, timestamp: new Date().toISOString() }, null, 2),
    }],
  };
}

export function errorResult(toolName: string, error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ tool: toolName, ok: false, error: msg, timestamp: new Date().toISOString() }, null, 2),
    }],
    isError: true,
  };
}
