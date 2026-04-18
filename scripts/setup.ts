#!/usr/bin/env bun
/**
 * Local development setup — writes .dev.vars with localhost defaults and
 * freshly generated random secrets. Runs only for local dev; the
 * Deploy-to-Cloudflare flow uses scripts/deploy.ts instead.
 */
import { existsSync, writeFileSync } from 'node:fs';

function randomHex(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

const path = '.dev.vars';
if (existsSync(path)) {
  console.log('.dev.vars already exists — leaving as-is.');
  process.exit(0);
}

const contents = `APP_URL=http://localhost:8787
ADMIN_EMAIL=you@example.com
SUPPORT_DOMAIN=support.example.com

COOKIE_SIGNING_KEY=${randomHex(32)}
ADMIN_BOOTSTRAP_TOKEN=${randomHex(16)}

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_AI_STUDIO_API_KEY=
GROK_API_KEY=
OPENROUTER_API_KEY=

CLOUDFLARE_AI_GATEWAY=ranse
CLOUDFLARE_AI_GATEWAY_TOKEN=
CLOUDFLARE_AI_GATEWAY_URL=none
`;

writeFileSync(path, contents, { mode: 0o600 });
console.log(`✓ wrote ${path} with localhost defaults + generated secrets`);
console.log('  (add provider API keys manually if you want non-Workers-AI LLMs)');
console.log('  Next: bun run db:migrate:local && bun run dev');
