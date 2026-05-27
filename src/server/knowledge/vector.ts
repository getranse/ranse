import type { Env } from '../env';
import { EMBEDDING_MODEL } from './constants';

export function vectorIndex(env: Env) {
  return (env as any).KNOWLEDGE_INDEX as Env['KNOWLEDGE_INDEX'];
}

function coerceEmbeddingData(response: any, expected: number): number[][] {
  const data = response?.data ?? response?.response?.data ?? response?.result?.data;
  if (!Array.isArray(data) || data.some((v) => !Array.isArray(v))) {
    throw new Error('embedding_response_missing_data');
  }
  if (data.length !== expected) {
    throw new Error(`embedding_response_count_mismatch:${data.length}:${expected}`);
  }
  return data as number[][];
}

export async function embedTexts(env: Env, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await (env.AI as any).run(EMBEDDING_MODEL, { text: texts });
  return coerceEmbeddingData(response, texts.length);
}

export async function deleteVectors(env: Env, vectorIds: string[]): Promise<void> {
  const index = vectorIndex(env);
  if (!index || vectorIds.length === 0) return;
  for (let i = 0; i < vectorIds.length; i += 100) {
    await index.deleteByIds(vectorIds.slice(i, i + 100)).catch(() => undefined);
  }
}
