import type { Env } from '../env';

// Workspace-scoped at-rest encryption for channel adapter secrets.
//
// Threat model: an attacker with read-only access to the D1 database — or a
// snapshot/backup of it — must not be able to recover bot tokens, API keys,
// or auth tokens. The encryption key (KEK) is provisioned outside the
// database as a Worker secret (`env.SECRET_ENCRYPTION_KEY`). For each
// workspace we derive a unique 256-bit data key from the KEK via HKDF-SHA256
// using the workspace id as the salt, so a leaked per-workspace key never
// compromises other workspaces and rotating the KEK re-keys everyone.
//
// Wire format: every encrypted blob is a JSON string
//   { v: 1, iv: <12-byte base64>, ct: <ciphertext+tag base64> }
// AES-GCM-256 is used with a random 12-byte IV per write. The auth tag is
// appended to the ciphertext by SubtleCrypto, so we never store it
// separately.

const enc = new TextEncoder();
const dec = new TextDecoder();
const VERSION = 1;
const IV_BYTES = 12;
const HKDF_INFO = 'ranse:secret-encryption:v1';

interface SealedBlob {
  v: number;
  iv: string;
  ct: string;
}

export class SecretEncryptionError extends Error {}

export function isSealedString(value: string): boolean {
  if (!value || value.length === 0) return false;
  try {
    const parsed = JSON.parse(value);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.iv === 'string' &&
      typeof parsed.ct === 'string'
    );
  } catch {
    return false;
  }
}

export async function sealJson(
  env: Env,
  workspaceId: string,
  value: Record<string, unknown>,
): Promise<string | null> {
  if (Object.keys(value).length === 0) return null;
  const plaintext = enc.encode(JSON.stringify(value));
  return sealBytes(env, workspaceId, plaintext);
}

export async function openJson<T extends Record<string, unknown>>(
  env: Env,
  workspaceId: string,
  ciphertext: string | null | undefined,
): Promise<T> {
  if (!ciphertext) return {} as T;
  if (!isSealedString(ciphertext)) {
    // Legacy plaintext JSON written before the encryption migration. Tolerate
    // it on read so existing channels keep working; re-saves will be sealed.
    try {
      return JSON.parse(ciphertext) as T;
    } catch {
      return {} as T;
    }
  }
  const bytes = await openBytes(env, workspaceId, ciphertext);
  if (!bytes) return {} as T;
  try {
    return JSON.parse(dec.decode(bytes)) as T;
  } catch {
    return {} as T;
  }
}

async function sealBytes(env: Env, workspaceId: string, plaintext: Uint8Array): Promise<string> {
  const key = await deriveWorkspaceKey(env, workspaceId);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, toAb(plaintext)),
  );
  const blob: SealedBlob = {
    v: VERSION,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(ct),
  };
  return JSON.stringify(blob);
}

async function openBytes(
  env: Env,
  workspaceId: string,
  ciphertext: string,
): Promise<Uint8Array | null> {
  let parsed: SealedBlob;
  try {
    parsed = JSON.parse(ciphertext);
  } catch {
    return null;
  }
  if (parsed.v !== VERSION) {
    throw new SecretEncryptionError(`unsupported_secret_version:${parsed.v}`);
  }
  const iv = base64ToBytes(parsed.iv);
  const ct = base64ToBytes(parsed.ct);
  const key = await deriveWorkspaceKey(env, workspaceId);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toAb(iv) }, key, toAb(ct));
    return new Uint8Array(pt);
  } catch {
    throw new SecretEncryptionError('secret_decrypt_failed');
  }
}

function toAb(view: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

async function deriveWorkspaceKey(env: Env, workspaceId: string): Promise<CryptoKey> {
  const masterMaterial = env.SECRET_ENCRYPTION_KEY ?? env.COOKIE_SIGNING_KEY ?? '';
  if (!masterMaterial) {
    throw new SecretEncryptionError('secret_encryption_key_missing');
  }
  const ikm = await crypto.subtle.importKey('raw', enc.encode(masterMaterial), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode(`ws:${workspaceId}`),
      info: enc.encode(HKDF_INFO),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// Partition an adapter config into the public keys (kept in plaintext
// config_json so dashboards can show them) and the secret keys (kept under
// secrets_ciphertext). Adapters declare `secretFields` to opt in; falling
// back to no secrets means everything stays plaintext, which is the same
// behavior as before the migration.
export function partitionSecrets(
  config: Record<string, unknown>,
  secretFields: readonly string[],
): { publicConfig: Record<string, unknown>; secrets: Record<string, unknown> } {
  const publicConfig: Record<string, unknown> = {};
  const secrets: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (secretFields.includes(key)) {
      if (value !== undefined && value !== null && value !== '') secrets[key] = value;
      continue;
    }
    publicConfig[key] = value;
  }
  return { publicConfig, secrets };
}
