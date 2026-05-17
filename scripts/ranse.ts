#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import { loadProcedureFile } from '../src/procedures/files';
import { simulateProcedure } from '../src/procedures/simulate';

const [, , command, ...args] = process.argv;

async function main() {
  if (command === 'simulate') {
    const file = requiredArg(
      args[0],
      'usage: ranse simulate <procedure-file> [--input input.json]',
    );
    const inputPath = flagValue(args, '--input');
    const spec = await loadProcedureFile(file);
    const context = inputPath ? JSON.parse(await readFile(inputPath, 'utf8')) : {};
    const result = simulateProcedure(spec, context);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === 'failed' ? 1 : 0);
  }

  if (command === 'publish') {
    const file = requiredArg(
      args[0],
      'usage: ranse publish <procedure-file> --app-url <url> --cookie <session-cookie>',
    );
    const appUrl = flagValue(args, '--app-url') ?? process.env.RANSE_APP_URL;
    const cookie = flagValue(args, '--cookie') ?? process.env.RANSE_COOKIE;
    if (!appUrl || !cookie) throw new Error('publish_requires_app_url_and_cookie');
    const spec = await loadProcedureFile(file);
    const res = await fetch(new URL('/api/procedures', appUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ spec, source_kind: 'git', source_ref: file }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`publish_failed:${res.status}:${body}`);
    }
    console.log(JSON.stringify(await res.json(), null, 2));
    return;
  }

  console.log(`usage:
  ranse simulate <procedure-file> [--input input.json]
  ranse publish <procedure-file> --app-url <url> --cookie <session-cookie>`);
}

function requiredArg(value: string | undefined, message: string): string {
  if (!value || value.startsWith('--')) throw new Error(message);
  return value;
}

function flagValue(args_: string[], flag: string): string | undefined {
  const index = args_.indexOf(flag);
  return index >= 0 ? args_[index + 1] : undefined;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
