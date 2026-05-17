import { pathToFileURL } from 'node:url';
import { extname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import type { ProcedureSpec } from '../types/procedure';
import { normalizeProcedureSpec } from './schema';

export async function loadProcedureFile(path: string): Promise<ProcedureSpec> {
  const absolute = resolve(path);
  const ext = extname(absolute).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    return normalizeProcedureSpec(parseYaml(await readFile(absolute, 'utf8')));
  }
  if (ext === '.json') {
    return normalizeProcedureSpec(JSON.parse(await readFile(absolute, 'utf8')));
  }
  if (ext === '.ts' || ext === '.js' || ext === '.mjs') {
    const mod = await import(`${pathToFileURL(absolute).href}?t=${Date.now()}`);
    return normalizeProcedureSpec(mod.default ?? mod.procedure);
  }
  throw new Error(`unsupported_procedure_file:${ext || 'unknown'}`);
}
