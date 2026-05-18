#!/usr/bin/env bun
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { runProcedureSpecEvals } from '../src/evals/replay';
import { loadProcedureFile } from '../src/procedures/files';
import {
  getProcedureLibraryItem,
  getProcedureLibraryManifest,
  listProcedureLibrary,
  validateProcedureLibrary,
} from '../src/procedures/library';
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

  if (command === 'procedure') {
    const subcommand = args[0];
    if (subcommand === 'list') {
      console.log(JSON.stringify({ procedures: await listProcedureLibrary() }, null, 2));
      return;
    }

    if (subcommand === 'manifest') {
      console.log(JSON.stringify(await getProcedureLibraryManifest(), null, 2));
      return;
    }

    if (subcommand === 'validate-library') {
      console.log(
        JSON.stringify({ ok: true, procedures: await validateProcedureLibrary() }, null, 2),
      );
      return;
    }

    if (subcommand === 'add') {
      assertKnownFlags(args.slice(2), ['--dir', '--format'], ['--force']);
      const slug = requiredArg(args[1], procedureUsage());
      const item = await getProcedureLibraryItem(slug);
      if (!item) throw new Error(`procedure_library_item_not_found:${slug}`);
      const report = runProcedureSpecEvals(item.spec);
      if (report.status !== 'passed') throw new Error(`procedure_library_eval_failed:${slug}`);

      const dir = flagValue(args, '--dir') ?? 'procedures';
      const format = flagValue(args, '--format') ?? 'yaml';
      if (!['yaml', 'json'].includes(format)) throw new Error('unsupported_procedure_format');
      await mkdir(dir, { recursive: true });
      const procedurePath = join(dir, `${item.slug}.${format === 'json' ? 'json' : 'yaml'}`);
      const mcpPath = join(dir, `${item.slug}.mcp.json`);
      const provenancePath = join(dir, `${item.slug}.provenance.json`);
      await writeIfAllowed(
        procedurePath,
        format === 'json' ? `${JSON.stringify(item.spec, null, 2)}\n` : stringifyYaml(item.spec),
        args.includes('--force'),
      );
      await writeIfAllowed(
        mcpPath,
        `${JSON.stringify(
          {
            protocol: {
              name: 'model-context-protocol',
              schema_version: item.provenance.standards.mcp_schema,
            },
            tools: item.reference_mcp_tools.map((tool) => ({
              server: tool.server,
              name: tool.tool,
              title: tool.title,
              description: tool.description,
              inputSchema: tool.input_schema,
              annotations: tool.annotations,
            })),
          },
          null,
          2,
        )}\n`,
        args.includes('--force'),
      );
      await writeIfAllowed(
        provenancePath,
        `${JSON.stringify(item.provenance, null, 2)}\n`,
        args.includes('--force'),
      );
      console.log(
        JSON.stringify(
          {
            ok: true,
            procedure: procedurePath,
            reference_mcp_tools: mcpPath,
            provenance: provenancePath,
            evals: report,
          },
          null,
          2,
        ),
      );
      return;
    }

    throw new Error(procedureUsage());
  }

  console.log(`usage:
  ranse simulate <procedure-file> [--input input.json]
  ranse publish <procedure-file> --app-url <url> --cookie <session-cookie>
  ranse eval <procedure-file>
  ranse eval --app-url <url> --cookie <session-cookie> [--limit n] [--threshold n] [--score-drop n] [--ci]
  ranse eval capture-resolved --app-url <url> --cookie <session-cookie> [--limit n]
  ranse procedure list
  ranse procedure manifest
  ranse procedure validate-library
  ranse procedure add <library-slug> [--dir procedures] [--format yaml|json] [--force]`);
}

function requiredArg(value: string | undefined, message: string): string {
  if (!value || value.startsWith('--')) throw new Error(message);
  return value;
}

function flagValue(args_: string[], flag: string): string | undefined {
  const index = args_.indexOf(flag);
  if (index < 0) return undefined;
  const value = args_[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing_flag_value:${flag}`);
  return value;
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

async function writeIfAllowed(path: string, body: string, force: boolean) {
  if (!force && (await exists(path))) throw new Error(`file_exists:${path}`);
  await writeFile(path, body, 'utf8');
}

function assertKnownFlags(args_: string[], flagsWithValues: string[], booleanFlags: string[]) {
  for (let index = 0; index < args_.length; index += 1) {
    const arg = args_[index];
    if (!arg.startsWith('--')) continue;
    if (booleanFlags.includes(arg)) continue;
    if (flagsWithValues.includes(arg)) {
      const value = args_[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`missing_flag_value:${arg}`);
      index += 1;
      continue;
    }
    throw new Error(`unknown_flag:${arg}`);
  }
}

function procedureUsage(): string {
  return `usage:
  ranse procedure list
  ranse procedure manifest
  ranse procedure validate-library
  ranse procedure add <library-slug> [--dir procedures] [--format yaml|json] [--force]`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
