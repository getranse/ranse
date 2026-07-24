#!/usr/bin/env node
// Enforces the ≤100-lines-per-file rule (docs/coding-standards.md) with a
// ratcheting baseline: new files must comply; files in the baseline may only
// shrink, and leave it permanently once they reach the limit.
//
//   node scripts/check-file-size.mjs            verify (CI mode)
//   node scripts/check-file-size.mjs --update   rewrite the baseline, shrink-only
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 100;
const ROOTS = ['src', 'scripts', 'tests'];
const EXTS = ['.ts', '.tsx', '.mjs', '.js', '.css'];
const BASELINE_PATH = 'scripts/file-size-baseline.json';

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (EXTS.some((e) => path.endsWith(e))) acc.push(path);
  }
  return acc;
}

function countLines(file) {
  return readFileSync(file, 'utf8').split('\n').length;
}

const counts = new Map();
for (const root of ROOTS) {
  if (!existsSync(root)) continue;
  for (const file of walk(root)) counts.set(file, countLines(file));
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};

if (process.argv.includes('--update')) {
  const next = {};
  for (const [file, allowed] of Object.entries(baseline)) {
    const lines = counts.get(file);
    if (lines === undefined || lines <= LIMIT) continue;
    next[file] = Math.min(allowed, lines);
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`✓ baseline updated: ${Object.keys(next).length} legacy files remain`);
  process.exit(0);
}

const errors = [];
for (const [file, lines] of counts) {
  if (lines <= LIMIT) continue;
  const allowed = baseline[file];
  if (allowed === undefined) {
    errors.push(`${file}: ${lines} lines (limit ${LIMIT}; new files must comply)`);
  } else if (lines > allowed) {
    errors.push(`${file}: ${lines} lines (grew past its baseline of ${allowed} — shrink it)`);
  }
}

if (errors.length > 0) {
  console.error(`File-size check failed (≤${LIMIT} lines per file):\n${errors.join('\n')}`);
  console.error(
    '\nSplit by responsibility. The baseline only ratchets down; see docs/coding-standards.md.',
  );
  process.exit(1);
}
const legacy = Object.keys(baseline).filter((f) => (counts.get(f) ?? 0) > LIMIT).length;
console.log(`✓ file sizes OK (${legacy} legacy files still above ${LIMIT}, shrink-only)`);
