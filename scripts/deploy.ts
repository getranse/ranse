#!/usr/bin/env bun
/**
 * Ranse deploy orchestrator. Runs under `bun scripts/deploy.ts`.
 *
 * Cloudflare's Deploy-to-Cloudflare button invokes the npm "deploy" script with
 * CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID injected. This script:
 *   1. Validates required env.
 *   2. Writes .prod.vars from env (for wrangler secret bulk).
 *   3. Runs `wrangler deploy`.
 *   4. Applies D1 migrations to the remote database.
 *   5. Bulk-uploads secrets that aren't safe to ship as `vars`.
 */
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { parse as parseJsonc } from 'jsonc-parser';

const SECRET_KEYS = [
  'COOKIE_SIGNING_KEY',
  'ADMIN_BOOTSTRAP_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_AI_STUDIO_API_KEY',
  'GROK_API_KEY',
  'OPENROUTER_API_KEY',
  'CEREBRAS_API_KEY',
  'CLOUDFLARE_AI_GATEWAY_TOKEN',
];

function run(cmd: string, opts: { allowFail?: boolean } = {}) {
  console.log(`\n$ ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (err) {
    if (!opts.allowFail) throw err;
    console.warn(`(non-fatal) ${(err as Error).message}`);
  }
}

/** Values we refuse to accept as real secrets — anyone hitting the Deploy
 * button should never end up with these in production. */
const PLACEHOLDER_PATTERNS = [
  /^change-me/i,
  /^your-/i,
  /^replace-/i,
  /placeholder/i,
  /example\.com/i,
  /^todo/i,
];

function looksLikePlaceholder(value: string): boolean {
  if (!value) return true;
  if (value.length < 16) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(value));
}

function generateIfMissing(key: string): void {
  const existing = process.env[key];
  if (existing && !looksLikePlaceholder(existing)) return;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  process.env[key] = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  console.log(
    existing
      ? `  · regenerated ${key} (prefilled value looked like a placeholder)`
      : `  · generated ${key} (random 32-byte hex)`,
  );
}

async function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.error('CLOUDFLARE_API_TOKEN is required.');
    process.exit(1);
  }

  console.log('· Preparing deploy-time secrets');
  generateIfMissing('COOKIE_SIGNING_KEY');
  generateIfMissing('ADMIN_BOOTSTRAP_TOKEN');

  // Scrub placeholder vars that may have leaked in from .dev.vars.example.
  // APP_URL defaults to Secure cookies when unset; localhost would disable them in prod.
  if (process.env.APP_URL && /localhost|127\.0\.0\.1/i.test(process.env.APP_URL)) {
    console.log('  · cleared APP_URL (was localhost — set it in the dashboard post-deploy)');
    process.env.APP_URL = '';
  }
  for (const k of ['ADMIN_EMAIL', 'SUPPORT_DOMAIN'] as const) {
    const v = process.env[k];
    if (v && looksLikePlaceholder(v)) {
      console.log(`  · cleared ${k} (was placeholder "${v}")`);
      process.env[k] = '';
    }
  }

  const secretsPresent = SECRET_KEYS.filter((k) => process.env[k]);
  const prodVarsPath = '.prod.vars';
  writeFileSync(
    prodVarsPath,
    `${secretsPresent.map((k) => `${k}=${process.env[k]}`).join('\n')}\n`,
    { mode: 0o600 },
  );
  console.log(`· Wrote ${prodVarsPath} with ${secretsPresent.length} keys`);

  if (existsSync('package.json') && existsSync('index.html')) {
    run('bun run build');
  }

  run('wrangler deploy');

  // D1 migrations — idempotent; wrangler handles already-applied migrations.
  const wrangler = parseJsonc(readFileSync('wrangler.jsonc', 'utf8'));
  const dbName = wrangler?.d1_databases?.[0]?.database_name ?? 'ranse-db';
  run(`wrangler d1 migrations apply ${dbName} --remote`, { allowFail: false });

  // Push secrets (skip if none)
  if (secretsPresent.length > 0) {
    run(`wrangler secret bulk ${prodVarsPath}`);
  }

  console.log('\n✓ Deploy complete.');
  console.log('  Next: open your Worker URL and finish the /setup wizard.');
  console.log(`  Your bootstrap token is ADMIN_BOOTSTRAP_TOKEN — check .prod.vars.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
