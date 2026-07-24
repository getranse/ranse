import { describe, expect, it } from 'vitest';
import { authApp } from '../src/server/http/auth';
import { addMember, createWorkspaceTestDb, seedUser, seedWorkspace } from './helpers/workspace-db';

function withAuthLimiter(env: any, deniedKeys: string[]) {
  const seen: string[] = [];
  env.RATE_LIMIT_AUTH = {
    limit: async ({ key }: { key: string }) => {
      seen.push(key);
      return { success: !deniedKeys.some((d) => key.startsWith(d)) };
    },
  };
  return seen;
}

async function postLogin(env: any, email: string, password: string, ip?: string) {
  return authApp.request(
    '/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(ip ? { 'cf-connecting-ip': ip } : {}) },
      body: JSON.stringify({ email, password }),
    },
    env,
  );
}

describe('login rate limiting', () => {
  it('returns 429 without touching credentials when the IP bucket is exhausted', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    await seedUser(db, 'usr_1', 'owner@example.com');
    addMember(db, 'ws_a', 'usr_1', 'owner');
    withAuthLimiter(env, ['login:ip:']);

    const res = await postLogin(env, 'owner@example.com', 'correct-password', '203.0.113.9');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'rate_limited' });
    // No session was created and no login/failure event was audited.
    expect((db.prepare(`SELECT COUNT(*) AS n FROM session`).get() as any).n).toBe(0);
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS n FROM audit_event WHERE action LIKE 'auth.login%'`)
          .get() as any
      ).n,
    ).toBe(0);
  });

  it('throttles per target account even when attempts come from many IPs', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    await seedUser(db, 'usr_1', 'owner@example.com');
    addMember(db, 'ws_a', 'usr_1', 'owner');
    const seen = withAuthLimiter(env, ['login:email:owner@example.com']);

    const res = await postLogin(env, 'Owner@Example.com', 'guess', '198.51.100.7');
    expect(res.status).toBe(429);
    // The account key is checked case-insensitively alongside the IP key.
    expect(seen).toContain('login:email:owner@example.com');
    expect(seen).toContain('login:ip:198.51.100.7');
  });

  it('lets a healthy login through and fails open if the limiter binding errors', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    await seedUser(db, 'usr_1', 'owner@example.com');
    addMember(db, 'ws_a', 'usr_1', 'owner');
    env.RATE_LIMIT_AUTH = {
      limit: async () => {
        throw new Error('limiter unavailable');
      },
    };

    const res = await postLogin(env, 'owner@example.com', 'long-enough-password', '203.0.113.9');
    expect(res.status).toBe(200);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM session`).get() as any).n).toBe(1);
  });
});
