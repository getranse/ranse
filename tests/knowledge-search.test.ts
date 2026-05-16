import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { searchKnowledge } from '../src/knowledge';

function createD1LikeDb() {
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
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
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
    )
  `);

  return {
    insertSource(row: { id: string; status: string; title: string }) {
      db.prepare(
        `INSERT INTO knowledge_source (id, workspace_id, kind, title, status, updated_at)
         VALUES (?, 'ws_1', 'manual', ?, ?, 1)`,
      ).run(row.id, row.title, row.status);
    },
    insertChunk(row: { id: string; sourceId: string; body: string; vectorId: string }) {
      db.prepare(
        `INSERT INTO knowledge_chunk (
           id, workspace_id, source_id, title, body, snippet, vector_id, used_in_answers_count, updated_at
         )
         VALUES (?, 'ws_1', ?, 'Refund policy', ?, ?, ?, 0, 1)`,
      ).run(row.id, row.sourceId, row.body, row.body, row.vectorId);
    },
    envDb: {
      prepare(sql: string) {
        return {
          bind(...params: any[]) {
            return {
              all: async () => ({ results: db.prepare(sql).all(...params) }),
              first: async () => db.prepare(sql).get(...params),
              run: async () => {
                db.prepare(sql).run(...params);
                return { success: true };
              },
            };
          },
        };
      },
    },
  };
}

describe('searchKnowledge', () => {
  it('keyword fallback returns ready sources and excludes non-ready sources by behavior', async () => {
    const db = createD1LikeDb();
    db.insertSource({ id: 'ready_source', status: 'ready', title: 'Ready refunds' });
    db.insertSource({ id: 'failed_source', status: 'failed', title: 'Failed refunds' });
    db.insertChunk({
      id: 'ready_chunk',
      sourceId: 'ready_source',
      body: 'Refund policy is available for ready sources.',
      vectorId: 'ws_1:ready_chunk',
    });
    db.insertChunk({
      id: 'failed_chunk',
      sourceId: 'failed_source',
      body: 'Refund policy should not appear from failed sources.',
      vectorId: 'ws_1:failed_chunk',
    });

    const hits = await searchKnowledge({ DB: db.envDb } as any, 'ws_1', 'refund policy', 10);

    expect(hits.map((hit) => hit.id)).toEqual(['ready_chunk']);
  });

  it('vector search hydration excludes non-ready matched chunks by behavior', async () => {
    const db = createD1LikeDb();
    db.insertSource({ id: 'ready_source', status: 'ready', title: 'Ready refunds' });
    db.insertSource({ id: 'indexing_source', status: 'indexing', title: 'Indexing refunds' });
    db.insertChunk({
      id: 'ready_chunk',
      sourceId: 'ready_source',
      body: 'Refund policy from a ready source.',
      vectorId: 'ws_1:ready_chunk',
    });
    db.insertChunk({
      id: 'indexing_chunk',
      sourceId: 'indexing_source',
      body: 'Refund policy from an indexing source.',
      vectorId: 'ws_1:indexing_chunk',
    });

    const hits = await searchKnowledge({
      AI: { run: async () => ({ data: [[0.1, 0.2]] }) },
      KNOWLEDGE_INDEX: {
        query: async () => ({
          matches: [
            { id: 'ws_1:indexing_chunk', score: 0.99 },
            { id: 'ws_1:ready_chunk', score: 0.5 },
          ],
        }),
      },
      DB: db.envDb,
    } as any, 'ws_1', 'refund policy', 10);

    expect(hits.map((hit) => hit.id)).toEqual(['ready_chunk']);
  });

  it('keeps ready keyword matches even when they do not have vector matches', async () => {
    const db = createD1LikeDb();
    db.insertSource({ id: 'vector_source', status: 'ready', title: 'Vector refunds' });
    db.insertSource({ id: 'keyword_source', status: 'ready', title: 'Keyword warranty' });
    db.insertChunk({
      id: 'vector_chunk',
      sourceId: 'vector_source',
      body: 'Refund policy from the vector index.',
      vectorId: 'ws_1:vector_chunk',
    });
    db.insertChunk({
      id: 'keyword_chunk',
      sourceId: 'keyword_source',
      body: 'Warranty replacement policy from an older unvectorized source.',
      vectorId: 'ws_1:keyword_chunk',
    });

    const hits = await searchKnowledge({
      AI: { run: async () => ({ data: [[0.1, 0.2]] }) },
      KNOWLEDGE_INDEX: {
        query: async () => ({
          matches: [
            { id: 'ws_1:vector_chunk', score: 0.9 },
          ],
        }),
      },
      DB: db.envDb,
    } as any, 'ws_1', 'refund warranty policy', 10);

    expect(hits.map((hit) => hit.id)).toEqual(['vector_chunk', 'keyword_chunk']);
  });
});
