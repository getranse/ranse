import { sha256Hex } from '../../../lib/crypto';
import { ids } from '../../../lib/ids';
import type { KnowledgeSourceKind } from '../../../types/shared/knowledge';
import type { Env } from '../../env';
import { chunkText } from './chunking';
import { embedTexts, vectorIndex } from './vector';

export async function buildChunkRows(workspaceId: string, title: string, body: string) {
  const chunks = chunkText(`${title}\n\n${body}`);
  if (chunks.length === 0) throw new Error('empty_source_chunks');
  return Promise.all(
    chunks.map(async (chunk, ordinal) => {
      const chunkId = ids.knowledgeChunk();
      return {
        id: chunkId,
        ordinal,
        body: chunk,
        snippet: chunk.slice(0, 500),
        vectorId: `${workspaceId}:${chunkId}`,
        hash: await sha256Hex(chunk),
      };
    }),
  );
}

export async function upsertVectors(
  env: Env,
  workspaceId: string,
  sourceId: string,
  kind: KnowledgeSourceKind,
  title: string,
  url: string | undefined,
  chunks: Awaited<ReturnType<typeof buildChunkRows>>,
): Promise<boolean> {
  const index = vectorIndex(env);
  if (!index) return false;
  const embeddings = await embedTexts(
    env,
    chunks.map((c) => `${title}\n\n${c.body}`),
  );
  await index.upsert(
    chunks.map((c, i) => ({
      id: c.vectorId,
      values: embeddings[i],
      namespace: workspaceId,
      metadata: {
        workspace_id: workspaceId,
        source_id: sourceId,
        chunk_id: c.id,
        source_kind: kind,
        title,
        url: url ?? '',
        ordinal: c.ordinal,
      },
    })),
  );
  return true;
}
