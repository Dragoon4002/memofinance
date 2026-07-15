import { Pool } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

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
  private pool: Pool;
  private ready: Promise<void>;

  constructor(_dbPath?: string) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL env var required");
    this.pool = new Pool({ connectionString: url, max: 5 });
    this.ready = this.init();
  }

  private async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        context_type TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT DEFAULT '',
        created_at BIGINT NOT NULL,
        relevance_score REAL DEFAULT 1.0
      )
    `);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_agent ON memories(agent_id)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_type ON memories(agent_id, context_type)`);
  }

  async store(agentId: string, contextType: string, content: unknown, tags: string[] = []): Promise<string> {
    await this.ready;
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO memories (id, agent_id, context_type, content, tags, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, agentId, contextType, JSON.stringify(content), tags.join(","), Date.now()],
    );
    return id;
  }

  async recall(agentId: string, opts: { contextType?: string; tags?: string[]; keyword?: string; limit?: number }): Promise<Memory[]> {
    await this.ready;
    const { contextType, tags, keyword, limit = 10 } = opts;

    const params: unknown[] = [agentId];
    let sql = "SELECT * FROM memories WHERE agent_id = $1";
    let i = 2;

    if (contextType) { sql += ` AND context_type = $${i++}`; params.push(contextType); }
    if (keyword) { sql += ` AND content ILIKE $${i++}`; params.push(`%${keyword}%`); }
    if (tags?.length) {
      for (const tag of tags) { sql += ` AND tags ILIKE $${i++}`; params.push(`%${tag}%`); }
    }

    sql += ` ORDER BY created_at DESC LIMIT $${i}`;
    params.push(limit);

    const { rows } = await this.pool.query<Memory>(sql, params);
    return rows;
  }

  close() { void this.pool.end(); }
}
