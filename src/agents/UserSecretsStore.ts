import { Agent, unstable_callable } from 'agents';
import type { Env } from '../env';

interface SecretRecord {
  provider: string;
  ciphertext: string;
  iv: string;
  updated_at: number;
}

interface SecretsState {
  workspaceId: string;
  providers: string[];
}

/**
 * Per-workspace BYOK vault. Keys are AES-GCM-encrypted with a workspace master key
 * derived from COOKIE_SIGNING_KEY + workspaceId. This is a v1 implementation —
 * for production-grade BYOK, switch to client-side encryption so plaintext never
 * touches the server (mirror vibesdk/worker/services/secrets/UserSecretsStore.ts).
 */
export class UserSecretsStore extends Agent<Env, SecretsState> {
  initialState: SecretsState = { workspaceId: '', providers: [] };

  private async deriveKey(): Promise<CryptoKey> {
    const workspaceId = this.name ?? this.state.workspaceId;
    const material = `${this.env.COOKIE_SIGNING_KEY ?? ''}:${workspaceId}`;
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
    return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  private async encryptValue(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
    const key = await this.deriveKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    return {
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(ct))),
      iv: btoa(String.fromCharCode(...iv)),
    };
  }

  private async decryptValue(ciphertext: string, iv: string): Promise<string> {
    const key = await this.deriveKey();
    const ctBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
    const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, ctBytes);
    return new TextDecoder().decode(pt);
  }

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS secret (
      provider TEXT PRIMARY KEY,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`;
  }

  @unstable_callable()
  async setKey(args: { provider: string; apiKey: string }) {
    const { ciphertext, iv } = await this.encryptValue(args.apiKey);
    this.sql`INSERT OR REPLACE INTO secret (provider, ciphertext, iv, updated_at)
      VALUES (${args.provider}, ${ciphertext}, ${iv}, ${Date.now()})`;
    const rows = this.sql<{ provider: string }>`SELECT provider FROM secret`;
    await this.setState({ ...this.state, providers: rows.map((r) => r.provider) });
  }

  @unstable_callable()
  async listProviders(): Promise<string[]> {
    const rows = this.sql<{ provider: string }>`SELECT provider FROM secret`;
    return rows.map((r) => r.provider);
  }

  @unstable_callable()
  async deleteKey(provider: string) {
    this.sql`DELETE FROM secret WHERE provider = ${provider}`;
    const rows = this.sql<{ provider: string }>`SELECT provider FROM secret`;
    await this.setState({ ...this.state, providers: rows.map((r) => r.provider) });
  }

  /** Internal — called from other DOs/Workers to get decrypted key for a provider. */
  async getKey(provider: string): Promise<string | null> {
    const rows = this.sql<SecretRecord>`SELECT * FROM secret WHERE provider = ${provider} LIMIT 1`;
    const rec = rows[0];
    if (!rec) return null;
    return this.decryptValue(rec.ciphertext, rec.iv);
  }
}
