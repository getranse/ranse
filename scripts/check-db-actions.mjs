#!/usr/bin/env node
// Enforces the actions-layer rule (docs/06): D1 queries live only in
// src/server/actions/. Legacy offenders are recorded in a shrink-only
// baseline — new files must comply, listed files may only lose queries.
//
//   node scripts/check-db-actions.mjs            verify (CI mode)
//   node scripts/check-db-actions.mjs --update   rewrite the baseline, shrink-only
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED_PREFIX = 'src/server/actions/';
const BASELINE_PATH = 'scripts/db-actions-baseline.json';
const QUERY_PATTERN = /\bDB\.(prepare|batch|exec)\(/g;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) acc.push(path);
  }
  return acc;
}

const counts = new Map();
for (const file of walk('src')) {
  if (file.startsWith(ALLOWED_PREFIX)) continue;
  const matches = readFileSync(file, 'utf8').match(QUERY_PATTERN);
  if (matches) counts.set(file, matches.length);
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};

if (process.argv.includes('--update')) {
  const next = {};
  for (const [file, allowed] of Object.entries(baseline)) {
    const current = counts.get(file);
    if (!current) continue;
    next[file] = Math.min(allowed, current);
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`✓ db-actions baseline updated: ${Object.keys(next).length} legacy files remain`);
  process.exit(0);
}

const errors = [];
for (const [file, queries] of counts) {
  const allowed = baseline[file];
  if (allowed === undefined) {
    errors.push(
      `${file}: ${queries} D1 quer${queries === 1 ? 'y' : 'ies'} — move to src/server/actions/`,
    );
  } else if (queries > allowed) {
    errors.push(
      `${file}: ${queries} queries (baseline ${allowed}) — new queries belong in src/server/actions/`,
    );
  }
}

if (errors.length > 0) {
  console.error(`DB-actions check failed:\n${errors.join('\n')}`);
  console.error('\nDB queries live in src/server/actions/ (docs/06). The baseline only shrinks.');
  process.exit(1);
}
const legacy = Object.keys(baseline).filter((f) => counts.has(f)).length;
console.log(`✓ db-actions OK (${legacy} legacy files still query outside actions/, shrink-only)`);
