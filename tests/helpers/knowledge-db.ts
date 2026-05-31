import { DatabaseSync } from 'node:sqlite';
import type { KnowledgeSourceKind } from '../../src/types/shared/knowledge';

type SourceRow = {
  id: string;
  title: string;
  status?: string;
  kind?: KnowledgeSourceKind;
  workspaceId?: string;
};

type ChunkRow = {
  id: string;
  sourceId: string;
  body: string;
  title?: string;
  snippet?: string;
  vectorId?: string;
  workspaceId?: string;
};

export function createKnowledgeTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE knowledge_source (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      r2_key TEXT,
      status TEXT NOT NULL,
      staleness_score REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE knowledge_chunk (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      snippet TEXT NOT NULL,
      url TEXT,
      vector_id TEXT NOT NULL,
      used_in_answers_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE workspace_llm_config (
      workspace_id TEXT NOT NULL,
      action_key TEXT NOT NULL,
      model_name TEXT NOT NULL,
      fallback_model TEXT,
      reasoning_effort TEXT,
      temperature REAL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, action_key)
    );
  `);

  const envDb = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            all: async () => ({ results: db.prepare(sql).all(...(params as any[])) }),
            first: async () => db.prepare(sql).get(...(params as any[])),
            run: async () => {
              db.prepare(sql).run(...(params as any[]));
              return { success: true };
            },
          };
        },
      };
    },
  };

  return {
    db,
    envDb,
    env: { DB: envDb },
    insertSource(row: SourceRow) {
      db.prepare(
        `INSERT INTO knowledge_source (id, workspace_id, kind, title, status, updated_at)
         VALUES (?, ?, ?, ?, ?, 1)`,
      ).run(
        row.id,
        row.workspaceId ?? 'ws_1',
        row.kind ?? 'manual',
        row.title,
        row.status ?? 'ready',
      );
    },
    insertChunk(row: ChunkRow) {
      const workspaceId = row.workspaceId ?? 'ws_1';
      db.prepare(
        `INSERT INTO knowledge_chunk (
           id, workspace_id, source_id, title, body, snippet, vector_id, used_in_answers_count, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`,
      ).run(
        row.id,
        workspaceId,
        row.sourceId,
        row.title ?? 'Refund policy',
        row.body,
        row.snippet ?? row.body,
        row.vectorId ?? `${workspaceId}:${row.id}`,
      );
    },
  };
}
