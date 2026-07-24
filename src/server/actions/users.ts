import type { Env } from '../env';

export interface LoginUserRow {
  id: string;
  password_hash: string | null;
  totp_secret: string | null;
  totp_enabled: number;
}

export async function findLoginUser(env: Env, email: string): Promise<LoginUserRow | null> {
  return env.DB.prepare(
    `SELECT id, password_hash, totp_secret, totp_enabled FROM user WHERE email = ?`,
  )
    .bind(email.toLowerCase())
    .first<LoginUserRow>();
}

export async function getUserBasics(env: Env, userId: string) {
  return env.DB.prepare(`SELECT id, email, name FROM user WHERE id = ?`)
    .bind(userId)
    .first<{ id: string; email: string; name: string | null }>();
}

export async function updatePasswordHash(env: Env, userId: string, hash: string): Promise<void> {
  await env.DB.prepare(`UPDATE user SET password_hash = ? WHERE id = ?`).bind(hash, userId).run();
}

export async function touchLastLogin(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`UPDATE user SET last_login_at = ? WHERE id = ?`)
    .bind(Date.now(), userId)
    .run();
}

export async function loadUserTotp(env: Env, userId: string) {
  return env.DB.prepare(`SELECT email, totp_secret, totp_enabled FROM user WHERE id = ?`)
    .bind(userId)
    .first<{ email: string; totp_secret: string | null; totp_enabled: number }>();
}

/** Store a provisioned secret without enforcing it (enrollment step 1). */
export async function saveTotpSecret(env: Env, userId: string, secret: string): Promise<void> {
  await env.DB.prepare(`UPDATE user SET totp_secret = ?, totp_enabled = 0 WHERE id = ?`)
    .bind(secret, userId)
    .run();
}

export async function enableTotp(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`UPDATE user SET totp_enabled = 1 WHERE id = ?`).bind(userId).run();
}

export async function clearTotp(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`UPDATE user SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?`)
    .bind(userId)
    .run();
}
