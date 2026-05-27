import type { Env } from '../env';
import { ids } from '../lib/ids';
import type { ChannelIdentity, ChannelKind } from '../../types/channels';

// Identity stitching. Adapters know who the customer is on *their* surface
// (slack user id, phone number, telegram chat id, email). We map that
// external id to a stable `customer_id` so an operator sees one history per
// person, not one history per channel.
//
// Stitching rules — applied in order; the first match wins:
//   1. (workspace, channel_kind, external_id) already known → reuse customer.
//   2. The inbound payload carries an email that matches another identity's
//      email or another customer's primary_email → reuse that customer.
//   3. Same as #2 but for phone.
//   4. No match → create a fresh customer row.
//
// Stitching is conservative on purpose — false merges across people are
// worse than false splits. Operators can manually merge in the UI later.

export interface IdentityLookup {
  workspaceId: string;
  channelKind: ChannelKind;
  externalId: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export async function resolveCustomerIdentity(
  env: Env,
  input: IdentityLookup,
): Promise<{ customerId: string; identityId: string; isNew: boolean }> {
  const now = Date.now();

  const direct = await env.DB.prepare(
    `SELECT id, customer_id FROM channel_identity
       WHERE workspace_id = ? AND channel_kind = ? AND external_id = ?`,
  )
    .bind(input.workspaceId, input.channelKind, input.externalId)
    .first<{ id: string; customer_id: string }>();
  if (direct) {
    await touchIdentity(env, direct.id, input, now);
    return { customerId: direct.customer_id, identityId: direct.id, isNew: false };
  }

  let customerId = await findCustomerByContact(env, input);
  if (!customerId) {
    customerId = ids.customer();
    await env.DB.prepare(
      `INSERT INTO customer (id, workspace_id, display_name, primary_email, primary_phone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        customerId,
        input.workspaceId,
        input.displayName ?? null,
        input.email ?? null,
        input.phone ?? null,
        now,
        now,
      )
      .run();
  } else {
    await upgradeCustomerContact(env, customerId, input, now);
  }

  const identityId = ids.channelIdentity();
  await env.DB.prepare(
    `INSERT INTO channel_identity (id, workspace_id, customer_id, channel_kind, external_id,
                                   display_name, email, phone, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      identityId,
      input.workspaceId,
      customerId,
      input.channelKind,
      input.externalId,
      input.displayName ?? null,
      input.email ?? null,
      input.phone ?? null,
      now,
      now,
    )
    .run();

  return { customerId, identityId, isNew: true };
}

export async function listIdentitiesForCustomer(
  env: Env,
  workspaceId: string,
  customerId: string,
): Promise<ChannelIdentity[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM channel_identity WHERE workspace_id = ? AND customer_id = ?
       ORDER BY last_seen_at DESC`,
  )
    .bind(workspaceId, customerId)
    .all<ChannelIdentity>();
  return rows.results ?? [];
}

async function findCustomerByContact(env: Env, input: IdentityLookup): Promise<string | null> {
  if (input.email) {
    const byEmail = await env.DB.prepare(
      `SELECT customer_id FROM channel_identity WHERE workspace_id = ? AND email = ? LIMIT 1`,
    )
      .bind(input.workspaceId, input.email)
      .first<{ customer_id: string }>();
    if (byEmail) return byEmail.customer_id;
    const customerByEmail = await env.DB.prepare(
      `SELECT id FROM customer WHERE workspace_id = ? AND primary_email = ? LIMIT 1`,
    )
      .bind(input.workspaceId, input.email)
      .first<{ id: string }>();
    if (customerByEmail) return customerByEmail.id;
  }
  if (input.phone) {
    const byPhone = await env.DB.prepare(
      `SELECT customer_id FROM channel_identity WHERE workspace_id = ? AND phone = ? LIMIT 1`,
    )
      .bind(input.workspaceId, input.phone)
      .first<{ customer_id: string }>();
    if (byPhone) return byPhone.customer_id;
    const customerByPhone = await env.DB.prepare(
      `SELECT id FROM customer WHERE workspace_id = ? AND primary_phone = ? LIMIT 1`,
    )
      .bind(input.workspaceId, input.phone)
      .first<{ id: string }>();
    if (customerByPhone) return customerByPhone.id;
  }
  return null;
}

async function touchIdentity(
  env: Env,
  identityId: string,
  input: IdentityLookup,
  now: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE channel_identity
        SET display_name = COALESCE(?, display_name),
            email = COALESCE(?, email),
            phone = COALESCE(?, phone),
            last_seen_at = ?
      WHERE id = ?`,
  )
    .bind(input.displayName ?? null, input.email ?? null, input.phone ?? null, now, identityId)
    .run();
}

async function upgradeCustomerContact(
  env: Env,
  customerId: string,
  input: IdentityLookup,
  now: number,
): Promise<void> {
  // Only fill blank fields — never overwrite an operator-confirmed value
  // because of an inbound from another channel.
  await env.DB.prepare(
    `UPDATE customer
        SET display_name = COALESCE(display_name, ?),
            primary_email = COALESCE(primary_email, ?),
            primary_phone = COALESCE(primary_phone, ?),
            updated_at = ?
      WHERE id = ?`,
  )
    .bind(input.displayName ?? null, input.email ?? null, input.phone ?? null, now, customerId)
    .run();
}
