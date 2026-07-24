import { describe, expect, it } from 'vitest';
import { generateTotpSecret, totpUri, verifyTotp } from '../src/lib/totp';
import { authApp } from '../src/server/http/auth';
import { addMember, createWorkspaceTestDb, seedUser, seedWorkspace } from './helpers/workspace-db';

// RFC 6238 test secret "12345678901234567890" in base32.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp library', () => {
  it('matches the RFC 6238 SHA-1 test vector (T=59s → 287082)', async () => {
    expect(await verifyTotp(RFC_SECRET, '287082', 59_000)).toBe(true);
    expect(await verifyTotp(RFC_SECRET, '287082', 59_000 + 120_000)).toBe(false);
    expect(await verifyTotp(RFC_SECRET, 'abcdef', 59_000)).toBe(false);
  });

  it('tolerates one step of clock drift and generates valid secrets', async () => {
    // T=59s is step 1; step 2 begins at 60s — one step of drift.
    expect(await verifyTotp(RFC_SECRET, '287082', 61_000)).toBe(true);
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(totpUri(secret, 'me@acme.com')).toContain('otpauth://totp/Ranse%3Ame%40acme.com');
  });
});

describe('login with 2FA', () => {
  async function setup() {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    await seedUser(db, 'usr_1', 'owner@example.com');
    addMember(db, 'ws_a', 'usr_1', 'owner');
    return { db, env };
  }

  function loginReq(body: Record<string, string>) {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@example.com',
        password: 'long-enough-password',
        ...body,
      }),
    };
  }

  it('requires a code once enabled, and rejects bad codes without a session', async () => {
    const { db, env } = await setup();
    db.prepare(`UPDATE user SET totp_secret = ?, totp_enabled = 1 WHERE id = 'usr_1'`).run(
      RFC_SECRET,
    );

    const missing = await authApp.request('/login', loginReq({}), env);
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({ error: 'totp_required' });

    const bad = await authApp.request('/login', loginReq({ totpCode: '000000' }), env);
    expect(bad.status).toBe(401);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM session`).get() as any).n).toBe(0);
  });

  it('ignores 2FA for users who never enrolled', async () => {
    const { db, env } = await setup();
    const res = await authApp.request('/login', loginReq({}), env);
    expect(res.status).toBe(200);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM session`).get() as any).n).toBe(1);
  });
});
