import type { ProcedureCondition } from '../types/procedure';

const TEMPLATE_EXPR = /\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g;
const TEMPLATE_VALUE_EXPR = /^\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}$/;

export function getPath(context: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let current: unknown = context;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setPath(context: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return;
  let current: Record<string, unknown> = context;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

export function deletePath(context: Record<string, unknown>, path: string): void {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return;
  const parent = getPath(context, parts.slice(0, -1).join('.'));
  if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
    delete (parent as Record<string, unknown>)[parts.at(-1)!];
  }
}

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(TEMPLATE_EXPR, (_, path: string) => {
    const value = getPath(context, path);
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
  });
}

export function renderValue<T>(value: T, context: Record<string, unknown>): T {
  if (typeof value === 'string') {
    const wholeValue = value.match(TEMPLATE_VALUE_EXPR);
    if (wholeValue) {
      const resolved = getPath(context, wholeValue[1]);
      return (resolved === null || resolved === undefined ? '' : resolved) as T;
    }
    return renderTemplate(value, context) as T;
  }
  if (Array.isArray(value)) return value.map((item) => renderValue(item, context)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        renderValue(entry, context),
      ]),
    ) as T;
  }
  return value;
}

export function evaluateCondition(
  condition: ProcedureCondition,
  context: Record<string, unknown>,
): boolean {
  const value = getPath(context, condition.var);
  if (condition.exists !== undefined) {
    const exists = value !== undefined && value !== null;
    if (exists !== condition.exists) return false;
  }
  if (condition.equals !== undefined && !deepEqual(value, condition.equals)) return false;
  if (condition.not_equals !== undefined && deepEqual(value, condition.not_equals)) return false;
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (!a || !b || typeof a !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const aEntries = Object.entries(a as Record<string, unknown>);
  const bEntries = Object.entries(b as Record<string, unknown>);
  if (aEntries.length !== bEntries.length) return false;
  return aEntries.every(([key, value]) => deepEqual(value, (b as Record<string, unknown>)[key]));
}
