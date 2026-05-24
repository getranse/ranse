import type { Hono } from 'hono';
import { z } from 'zod';
import { apiError } from '../lib/errors';
import {
  getProcedureLibraryItem,
  getProcedureLibraryManifest,
  getProcedureLibraryReadiness,
  installProcedureFromLibrary,
  listProcedureLibraryWithReadiness,
} from '../procedures/library';
import {
  checkForUpdates,
  exportMarketplaceManifest,
  installFromManifestEntry,
  listMarketplaceInstalls,
} from '../procedures/marketplace';
import { resumeProcedureRunner, startProcedureRunner } from '../procedures/orchestration';
import {
  createProcedureRun,
  getActiveProcedure,
  getProcedureRunDetail,
  listProcedures,
  upsertProcedureVersion,
  updateRun,
} from '../procedures/storage';
import { CAN_WORK_TICKETS, type Ctx, OWNER_OR_ADMIN, requireWorkspaceRole } from './context';

const runBodySchema = z.object({
  ticket_id: z.string().min(1),
  context: z.record(z.unknown()).optional(),
});

const resumeBodySchema = z.object({
  event: z.enum(['customer_reply', 'approval_decided', 'manual_resume']),
  payload: z.record(z.unknown()).optional(),
});

export function registerProcedureRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/procedures', async (c) => {
    const s = c.get('session');
    const procedures = await listProcedures(c.env, s.workspaceId);
    return c.json({ procedures });
  });

  apiApp.post('/procedures', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z
      .object({
        spec: z.unknown(),
        source_kind: z.enum(['api', 'git', 'seed']).optional(),
        source_ref: z.string().max(500).nullable().optional(),
      })
      .parse(await c.req.json());
    try {
      const result = await upsertProcedureVersion(c.env, {
        workspaceId: s.workspaceId,
        actorUserId: s.userId,
        spec: body.spec,
        sourceKind: body.source_kind ?? 'api',
        sourceRef: body.source_ref ?? null,
      });
      return c.json(result);
    } catch (err) {
      if (err instanceof Error && err.message === 'procedure_version_conflict') {
        return apiError(
          c,
          'conflict',
          'A different spec already exists for that procedure version.',
          409,
        );
      }
      throw err;
    }
  });

  apiApp.get('/procedures/library', async (c) => {
    const s = c.get('session');
    return c.json({ procedures: await listProcedureLibraryWithReadiness(c.env, s.workspaceId) });
  });

  apiApp.get('/procedures/marketplace/manifest', async (c) => {
    return c.json(await exportMarketplaceManifest());
  });

  apiApp.get('/procedures/marketplace/installs', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    return c.json({ installs: await listMarketplaceInstalls(c.env, s.workspaceId) });
  });

  apiApp.post('/procedures/marketplace/install', requireWorkspaceRole(OWNER_OR_ADMIN), async (c) => {
    const s = c.get('session');
    const body = z
      .object({
        entry: z.unknown(),
        source_manifest_url: z.string().url().optional(),
        source_author: z.string().max(200).optional(),
        source_repo: z.string().max(200).optional(),
      })
      .parse(await c.req.json());
    try {
      const install = await installFromManifestEntry(c.env, {
        workspaceId: s.workspaceId,
        actorUserId: s.userId,
        entry: body.entry as any,
        sourceManifestUrl: body.source_manifest_url,
        sourceAuthor: body.source_author,
        sourceRepo: body.source_repo,
      });
      return c.json({ install });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'marketplace_entry_missing_spec') {
          return apiError(c, 'bad_request', 'Manifest entry must include spec_inline.', 400);
        }
        if (err.message === 'marketplace_entry_checksum_mismatch') {
          return apiError(c, 'bad_request', 'Spec checksum does not match the entry.', 400);
        }
        if (err.message === 'marketplace_entry_evals_failed') {
          return apiError(c, 'bad_request', 'Procedure evals failed; refusing to install.', 400);
        }
        if (err.message === 'procedure_version_conflict') {
          return apiError(c, 'conflict', 'Conflicting procedure version already installed.', 409);
        }
      }
      throw err;
    }
  });

  apiApp.post(
    '/procedures/marketplace/check-updates',
    requireWorkspaceRole(OWNER_OR_ADMIN),
    async (c) => {
      const s = c.get('session');
      return c.json({ results: await checkForUpdates(c.env, s.workspaceId) });
    },
  );

  apiApp.get('/procedures/library/manifest', async (c) => {
    return c.json(await getProcedureLibraryManifest());
  });

  apiApp.get('/procedures/library/:slug', async (c) => {
    const item = await getProcedureLibraryItem(c.req.param('slug'));
    if (!item) return apiError(c, 'not_found', 'That library procedure does not exist.');
    const s = c.get('session');
    return c.json({
      procedure: {
        ...item,
        readiness: await getProcedureLibraryReadiness(c.env, s.workspaceId, item.slug),
      },
    });
  });

  apiApp.post(
    '/procedures/library/:slug/install',
    requireWorkspaceRole(OWNER_OR_ADMIN),
    async (c) => {
      const s = c.get('session');
      try {
        const result = await installProcedureFromLibrary(c.env, {
          workspaceId: s.workspaceId,
          actorUserId: s.userId,
          slug: c.req.param('slug'),
        });
        return c.json(result);
      } catch (err) {
        if (err instanceof Error && err.message === 'procedure_library_item_not_found') {
          return apiError(c, 'not_found', 'That library procedure does not exist.');
        }
        if (err instanceof Error && err.message === 'procedure_version_conflict') {
          return apiError(
            c,
            'conflict',
            'A different spec already exists for that procedure version.',
            409,
          );
        }
        throw err;
      }
    },
  );

  apiApp.get('/procedures/:id', async (c) => {
    const s = c.get('session');
    const bundle = await getActiveProcedure(c.env, s.workspaceId, c.req.param('id'));
    if (!bundle) return apiError(c, 'not_found', 'That procedure does not exist.');
    return c.json(bundle);
  });

  apiApp.post('/procedures/:id/runs', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = runBodySchema.parse(await c.req.json());
    try {
      const { run, created } = await createProcedureRun(c.env, {
        workspaceId: s.workspaceId,
        procedureIdOrSlug: c.req.param('id'),
        ticketId: body.ticket_id,
        actorUserId: s.userId,
        context: body.context,
      });
      if (created) await startProcedureRunner(c.env, s.workspaceId, run.id);
      return c.json({
        run: (await getProcedureRunDetail(c.env, s.workspaceId, run.id))?.run ?? run,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'procedure_not_found' || message === 'ticket_not_found') {
        return apiError(c, 'not_found', 'Procedure or ticket not found.');
      }
      throw err;
    }
  });

  apiApp.get('/procedure-runs/:id', async (c) => {
    const s = c.get('session');
    const detail = await getProcedureRunDetail(c.env, s.workspaceId, c.req.param('id'));
    if (!detail) return apiError(c, 'not_found', 'That procedure run does not exist.');
    return c.json(detail);
  });

  apiApp.post('/procedure-runs/:id/resume', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const body = resumeBodySchema.parse(await c.req.json());
    const detail = await getProcedureRunDetail(c.env, s.workspaceId, c.req.param('id'));
    if (!detail) return apiError(c, 'not_found', 'That procedure run does not exist.');
    await resumeProcedureRunner(c.env, s.workspaceId, detail.run.id, body.event, body.payload);
    return c.json(await getProcedureRunDetail(c.env, s.workspaceId, detail.run.id));
  });

  apiApp.post('/procedure-runs/:id/cancel', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const detail = await getProcedureRunDetail(c.env, s.workspaceId, c.req.param('id'));
    if (!detail) return apiError(c, 'not_found', 'That procedure run does not exist.');
    await updateRun(c.env, s.workspaceId, detail.run.id, {
      status: 'cancelled',
      currentStep: detail.run.current_step,
      context: JSON.parse(detail.run.context_json || '{}'),
      completedAt: Date.now(),
    });
    return c.json({ ok: true });
  });
}
