#!/usr/bin/env bun
/**
 * Local development setup — generates .dev.vars if missing.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

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

const example = readFileSync('.dev.vars.example', 'utf8');
const filled = example
  .replace(/^COOKIE_SIGNING_KEY=.*$/m, `COOKIE_SIGNING_KEY=${randomHex(32)}`)
  .replace(/^ADMIN_BOOTSTRAP_TOKEN=.*$/m, `ADMIN_BOOTSTRAP_TOKEN=${randomHex(16)}`);

writeFileSync(path, filled);
console.log(`✓ wrote ${path} with generated cookie signing key + bootstrap token`);
console.log('  (add provider API keys manually if you want non-Workers-AI LLMs)');
console.log('  Next: bun run db:migrate:local && bun run dev');
