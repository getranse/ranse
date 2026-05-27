import type { Env } from '../env';
import { sha256Hex } from '../lib/crypto';
import { ids } from '../lib/ids';
import type { CustomerMemory, CustomerMemoryKind, ExtractedFact } from '../../types/memory';

// DB helpers for the customer_memory table. Reads always filter out
// redacted rows; writes dedupe on (workspace, customer, evidence_hash) so
// the extractor can re-run on the same conversation without doubling up.

export interface UpsertMemoryInput {
  workspaceId: string;
  customerId: string;
  kind: CustomerMemoryKind;
  factText: string;
  confidence: number;
  sourceTicketId?: string | null;
  sourceMessageId?: string | null;
  createdBy?: 'extractor' | 'operator' | 'system';
}

export async function listMemory(
  env: Env,
  workspaceId: string,
  customerId: string,
): Promise<CustomerMemory[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM customer_memory
       WHERE workspace_id = ? AND customer_id = ? AND redacted_at IS NULL
       ORDER BY confidence DESC, updated_at DESC`,
  )
    .bind(workspaceId, customerId)
    .all<CustomerMemory>();
  return rows.results ?? [];
}

export async function upsertMemory(env: Env, input: UpsertMemoryInput): Promise<CustomerMemory> {
  const evidenceHash = await sha256Hex(
    `${input.kind}\n${input.factText.toLowerCase().replace(/\s+/g, ' ').trim()}`,
  );
  const existing = await env.DB.prepare(
    `SELECT id FROM customer_memory
       WHERE workspace_id = ? AND customer_id = ? AND evidence_hash = ?`,
  )
    .bind(input.workspaceId, input.customerId, evidenceHash)
    .first<{ id: string }>();
  const now = Date.now();
  if (existing) {
    await env.DB.prepare(
      `UPDATE customer_memory
          SET fact_text = ?, confidence = MAX(confidence, ?), updated_at = ?,
              redacted_at = NULL, redacted_reason = NULL
        WHERE id = ?`,
    )
      .bind(input.factText.slice(0, 600), input.confidence, now, existing.id)
      .run();
    return loadById(env, existing.id);
  }
  const id = ids.customerMemory();
  await env.DB.prepare(
    `INSERT INTO customer_memory (
       id, workspace_id, customer_id, kind, fact_text, confidence,
       source_ticket_id, source_message_id, evidence_hash, created_by,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.workspaceId,
      input.customerId,
      input.kind,
      input.factText.slice(0, 600),
      input.confidence,
      input.sourceTicketId ?? null,
      input.sourceMessageId ?? null,
      evidenceHash,
      input.createdBy ?? 'extractor',
      now,
      now,
    )
    .run();
  return loadById(env, id);
}

export async function ingestExtractedFacts(
  env: Env,
  args: {
    workspaceId: string;
    customerId: string;
    sourceTicketId: string;
    sourceMessageId?: string | null;
    facts: ExtractedFact[];
  },
): Promise<CustomerMemory[]> {
  const out: CustomerMemory[] = [];
  for (const fact of args.facts) {
    if (!fact.text.trim()) continue;
    if (fact.confidence < 0.4) continue;
    out.push(
      await upsertMemory(env, {
        workspaceId: args.workspaceId,
        customerId: args.customerId,
        kind: fact.kind,
        factText: fact.text,
        confidence: fact.confidence,
        sourceTicketId: args.sourceTicketId,
        sourceMessageId: args.sourceMessageId ?? null,
      }),
    );
  }
  return out;
}

export async function redactMemory(
  env: Env,
  workspaceId: string,
  memoryId: string,
  reason: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE customer_memory
        SET redacted_at = ?, redacted_reason = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?`,
  )
    .bind(Date.now(), reason.slice(0, 240), Date.now(), workspaceId, memoryId)
    .run();
}

async function loadById(env: Env, id: string): Promise<CustomerMemory> {
  const row = await env.DB.prepare(`SELECT * FROM customer_memory WHERE id = ?`)
    .bind(id)
    .first<CustomerMemory>();
  if (!row) throw new Error('customer_memory_load_failed');
  return row;
}
