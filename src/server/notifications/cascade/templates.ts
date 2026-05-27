import type { Env } from '../../env';
import { ids } from '../../lib/ids';
import type { CascadeStepInput, NotificationTemplate } from '../../../types/notifications';

// Operator-defined notification templates. The bodies are stored per
// channel_kind in `bodies_json` so the same template can render short for
// SMS and long-form for email. Mustache-style `{{ payload.foo }}`
// substitution happens at materialize-time (lightweight: no full template
// engine, just safe key lookup).

export async function getTemplateBySlug(
  env: Env,
  workspaceId: string,
  slug: string,
): Promise<NotificationTemplate | null> {
  return env.DB.prepare(
    `SELECT * FROM notification_template
       WHERE workspace_id = ? AND slug = ? AND archived_at IS NULL`,
  )
    .bind(workspaceId, slug)
    .first<NotificationTemplate>();
}

export async function listTemplates(
  env: Env,
  workspaceId: string,
): Promise<NotificationTemplate[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM notification_template
       WHERE workspace_id = ? AND archived_at IS NULL
       ORDER BY updated_at DESC`,
  )
    .bind(workspaceId)
    .all<NotificationTemplate>();
  return rows.results ?? [];
}

export async function upsertTemplate(
  env: Env,
  args: {
    workspaceId: string;
    slug: string;
    name: string;
    description?: string | null;
    defaultChannels: CascadeStepInput[];
    bodies: Record<string, { text?: string; html?: string }>;
    metadata?: Record<string, unknown>;
  },
): Promise<NotificationTemplate> {
  const now = Date.now();
  const existing = await getTemplateBySlug(env, args.workspaceId, args.slug);
  if (existing) {
    await env.DB.prepare(
      `UPDATE notification_template
          SET name = ?, description = ?, default_channels_json = ?,
              bodies_json = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(
        args.name.slice(0, 160),
        args.description?.slice(0, 1000) ?? null,
        JSON.stringify(args.defaultChannels),
        JSON.stringify(args.bodies),
        JSON.stringify(args.metadata ?? {}),
        now,
        existing.id,
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO notification_template (
         id, workspace_id, slug, name, description, default_channels_json,
         bodies_json, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        ids.notificationTemplate(),
        args.workspaceId,
        args.slug,
        args.name.slice(0, 160),
        args.description?.slice(0, 1000) ?? null,
        JSON.stringify(args.defaultChannels),
        JSON.stringify(args.bodies),
        JSON.stringify(args.metadata ?? {}),
        now,
        now,
      )
      .run();
  }
  const reread = await getTemplateBySlug(env, args.workspaceId, args.slug);
  if (!reread) throw new Error('notification_template_persist_failed');
  return reread;
}

// Lightweight {{ payload.foo }} substitution. Whitespace tolerant.
// Falls back to the original token if the path is not resolvable.
export function renderTemplate(body: string, payload: Record<string, unknown>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, path) => {
    const value = resolvePath(payload, path);
    return value === undefined || value === null ? match : String(value);
  });
}

function resolvePath(root: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let cursor: unknown = { payload: root };
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

export function parseTemplateBodies(
  template: NotificationTemplate,
): Record<string, { text?: string; html?: string }> {
  try {
    return JSON.parse(template.bodies_json || '{}');
  } catch {
    return {};
  }
}

export function parseTemplateChannels(template: NotificationTemplate): CascadeStepInput[] {
  try {
    const parsed = JSON.parse(template.default_channels_json || '[]');
    return Array.isArray(parsed) ? (parsed as CascadeStepInput[]) : [];
  } catch {
    return [];
  }
}
