#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import { runProcedureSpecEvals } from '../src/evals/replay';
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

  if (command === 'eval') {
    if (args[0] === 'capture-resolved') {
      const appUrl = flagValue(args, '--app-url') ?? process.env.RANSE_APP_URL;
      const cookie = flagValue(args, '--cookie') ?? process.env.RANSE_COOKIE;
      if (!appUrl || !cookie) throw new Error('eval_capture_requires_app_url_and_cookie');
      const res = await fetch(new URL('/api/evals/cases/capture-resolved', appUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ limit: numberFlag(args, '--limit') }),
      });
      const payload = await jsonOrText(res);
      console.log(JSON.stringify(payload, null, 2));
      process.exit(res.ok && (payload as any).ok !== false ? 0 : 1);
    }

    const procedureFile = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
    if (procedureFile) {
      const spec = await loadProcedureFile(procedureFile);
      const report = runProcedureSpecEvals(spec);
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.status === 'passed' ? 0 : 1);
    }

    const appUrl = flagValue(args, '--app-url') ?? process.env.RANSE_APP_URL;
    const cookie = flagValue(args, '--cookie') ?? process.env.RANSE_COOKIE;
    if (!appUrl || !cookie) throw new Error('eval_requires_procedure_file_or_app_url_and_cookie');
    const res = await fetch(new URL('/api/evals/runs', appUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        limit: numberFlag(args, '--limit'),
        threshold: numberFlag(args, '--threshold'),
        score_drop_threshold: numberFlag(args, '--score-drop'),
        source: args.includes('--ci') ? 'ci' : 'cli',
      }),
    });
    const payload = await jsonOrText(res);
    console.log(JSON.stringify(payload, null, 2));
    const status = (payload as any)?.run?.status;
    process.exit(res.ok && status !== 'failed' ? 0 : 1);
  }

  console.log(`usage:
  ranse simulate <procedure-file> [--input input.json]
  ranse publish <procedure-file> --app-url <url> --cookie <session-cookie>
  ranse eval <procedure-file>
  ranse eval --app-url <url> --cookie <session-cookie> [--limit n] [--threshold n] [--score-drop n] [--ci]
  ranse eval capture-resolved --app-url <url> --cookie <session-cookie> [--limit n]`);
}

function requiredArg(value: string | undefined, message: string): string {
  if (!value || value.startsWith('--')) throw new Error(message);
  return value;
}

function flagValue(args_: string[], flag: string): string | undefined {
  const index = args_.indexOf(flag);
  return index >= 0 ? args_[index + 1] : undefined;
}

function numberFlag(args_: string[], flag: string): number | undefined {
  const value = flagValue(args_, flag);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid_number:${flag}`);
  return parsed;
}

async function jsonOrText(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: res.status, body: text };
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
