import type { Hono } from 'hono';
import { dismissOnboarding, getOnboardingState } from '../../platform/onboarding/state';
import { CAN_WORK_TICKETS, type Ctx, requireWorkspaceRole } from './context';

// Two endpoints: read state, dismiss banner. Dismissal is workspace-wide
// (it's the operator's "I've seen the checklist" — not per-user) and lives
// in workspace.settings_json so it survives the next deploy.

export function registerOnboardingRoutes(apiApp: Hono<Ctx>) {
  apiApp.get('/onboarding', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    const state = await getOnboardingState(c.env, s.workspaceId);
    return c.json(state);
  });

  apiApp.post('/onboarding/dismiss', requireWorkspaceRole(CAN_WORK_TICKETS), async (c) => {
    const s = c.get('session');
    await dismissOnboarding(c.env, s.workspaceId);
    return c.json({ ok: true });
  });
}
