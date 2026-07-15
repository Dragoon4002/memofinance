import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Memory {
  id: string;
  agent_id: string;
  context_type: string;
  content: string;
  tags: string;
  created_at: number;
  relevance_score: number;
}

export class SQLiteMemoryStore {
  private db: Database.Database;

  constructor(dbPath = "./data/memories.db") {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        context_type TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        relevance_score REAL DEFAULT 1.0
      );
      CREATE INDEX IF NOT EXISTS idx_agent ON memories(agent_id);
      CREATE INDEX IF NOT EXISTS idx_type ON memories(agent_id, context_type);
    `);
  }

  store(agentId: string, contextType: string, content: unknown, tags: string[] = []): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO memories (id, agent_id, context_type, content, tags, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, agentId, contextType, JSON.stringify(content), tags.join(","), Date.now());
    return id;
  }

  recall(agentId: string, opts: { contextType?: string; tags?: string[]; keyword?: string; limit?: number }): Memory[] {
    const { contextType, tags, keyword, limit = 10 } = opts;
    let sql = "SELECT * FROM memories WHERE agent_id = ?";
    const params: unknown[] = [agentId];

    if (contextType) { sql += " AND context_type = ?"; params.push(contextType); }
    if (keyword) { sql += " AND content LIKE ?"; params.push(`%${keyword}%`); }
    if (tags?.length) {
      for (const tag of tags) { sql += " AND tags LIKE ?"; params.push(`%${tag}%`); }
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    return this.db.prepare(sql).all(...params) as Memory[];
  }

  close() { this.db.close(); }
}
