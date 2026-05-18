import type { EvalAnonymizationConfig } from '../types/evals';

interface AnonymizerState {
  emailMap: Map<string, string>;
  phoneMap: Map<string, string>;
  nameCount: number;
}

export interface AnonymizationMetadata {
  rules: {
    redactEmails: boolean;
    redactPhones: boolean;
    redactRequesterName: boolean;
  };
  counts: {
    emails: number;
    phones: number;
    requesterNames: number;
  };
}

export interface ResidualPiiFinding {
  kind: 'email' | 'phone' | 'requester_name';
  value: string;
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?<!\d)(?:\+?\d[\d().\-\s]{7,}\d)(?!\d)/g;

export function normalizeAnonymizationConfig(
  config: EvalAnonymizationConfig = {},
): Required<
  Pick<EvalAnonymizationConfig, 'redactEmails' | 'redactPhones' | 'redactRequesterName'>
> &
  Pick<EvalAnonymizationConfig, 'requesterEmail' | 'requesterName'> {
  return {
    redactEmails: config.redactEmails ?? true,
    redactPhones: config.redactPhones ?? true,
    redactRequesterName: config.redactRequesterName ?? true,
    requesterEmail: config.requesterEmail ?? null,
    requesterName: config.requesterName ?? null,
  };
}

export function anonymizeValue<T>(
  value: T,
  config: EvalAnonymizationConfig = {},
): { value: T; metadata: AnonymizationMetadata } {
  const normalized = normalizeAnonymizationConfig(config);
  const state: AnonymizerState = {
    emailMap: new Map(),
    phoneMap: new Map(),
    nameCount: 0,
  };
  const anonymized = anonymizeAny(value, normalized, state) as T;
  return {
    value: anonymized,
    metadata: {
      rules: {
        redactEmails: normalized.redactEmails,
        redactPhones: normalized.redactPhones,
        redactRequesterName: normalized.redactRequesterName,
      },
      counts: {
        emails: state.emailMap.size,
        phones: state.phoneMap.size,
        requesterNames: state.nameCount,
      },
    },
  };
}

export function detectResidualPii(value: unknown): ResidualPiiFinding[] {
  const findings = new Map<string, ResidualPiiFinding>();
  for (const text of collectStrings(value)) {
    for (const email of text.match(EMAIL_RE) ?? []) {
      if (email.toLowerCase().endsWith('@example.test')) continue;
      findings.set(`email:${email.toLowerCase()}`, { kind: 'email', value: email });
    }
    for (const phone of text.match(PHONE_RE) ?? []) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 8) continue;
      findings.set(`phone:${digits}`, { kind: 'phone', value: phone });
    }
  }
  return [...findings.values()];
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(collectStrings);
}

function anonymizeAny(
  value: unknown,
  config: ReturnType<typeof normalizeAnonymizationConfig>,
  state: AnonymizerState,
): unknown {
  if (typeof value === 'string') return anonymizeText(value, config, state);
  if (Array.isArray(value)) return value.map((item) => anonymizeAny(item, config, state));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = anonymizeAny(nested, config, state);
  }
  return out;
}

function anonymizeText(
  input: string,
  config: ReturnType<typeof normalizeAnonymizationConfig>,
  state: AnonymizerState,
): string {
  let text = input;
  if (config.redactRequesterName && config.requesterName?.trim()) {
    const name = config.requesterName.trim();
    if (name.length >= 3) {
      const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi');
      text = text.replace(re, () => {
        state.nameCount += 1;
        return '[customer_name]';
      });
    }
  }
  if (config.redactEmails) {
    text = text.replace(EMAIL_RE, (match) => {
      const key = match.toLowerCase();
      let replacement = state.emailMap.get(key);
      if (!replacement) {
        replacement = `customer_${state.emailMap.size + 1}@example.test`;
        state.emailMap.set(key, replacement);
      }
      return replacement;
    });
  }
  if (config.redactPhones) {
    text = text.replace(PHONE_RE, (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 8) return match;
      let replacement = state.phoneMap.get(digits);
      if (!replacement) {
        replacement = `[phone_${state.phoneMap.size + 1}]`;
        state.phoneMap.set(digits, replacement);
      }
      return replacement;
    });
  }
  return text;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
