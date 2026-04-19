/**
 * Cloudflare Email provisioning — onboards a domain for Email Sending,
 * adds DKIM/SPF/DMARC records, enables Email Routing, and routes a
 * single address at a named Worker. All requests go through direct
 * `fetch` against api.cloudflare.com with a user-supplied scoped token.
 */

const CF_API = 'https://api.cloudflare.com/client/v4';

interface CfEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
}

async function cfFetch<T = any>(
  path: string,
  opts: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; token: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    method: opts.method,
    headers: {
      authorization: `Bearer ${opts.token}`,
      'content-type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: CfEnvelope<T>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`CF ${opts.method} ${path}: non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !body.success) {
    const errs = body.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? res.statusText;
    const err = new Error(`CF ${opts.method} ${path}: ${errs}`);
    (err as any).status = res.status;
    (err as any).cfErrors = body.errors ?? [];
    throw err;
  }
  return body.result;
}

export async function verifyToken(token: string) {
  return cfFetch<{ id: string; status: string; expires_on?: string }>('/user/tokens/verify', {
    method: 'GET',
    token,
  });
}

export async function findZone(token: string, domain: string) {
  // Walk from most specific to apex: email.ijamu.com → ijamu.com → com
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const zones = await cfFetch<Array<{ id: string; name: string }>>(
      `/zones?name=${encodeURIComponent(candidate)}`,
      { method: 'GET', token },
    );
    if (zones.length > 0) return { zoneId: zones[0].id, zoneName: zones[0].name };
  }
  return null;
}

export async function onboardSendingDomain(token: string, accountId: string, domain: string) {
  try {
    const existing = await cfFetch<any>(
      `/accounts/${accountId}/email/sending/domains/${encodeURIComponent(domain)}`,
      { method: 'GET', token },
    );
    return { created: false, domain: existing };
  } catch (err: any) {
    if (err?.status !== 404) throw err;
  }
  const created = await cfFetch<any>(`/accounts/${accountId}/email/sending/domains`, {
    method: 'POST',
    token,
    body: { name: domain },
  });
  return { created: true, domain: created };
}

export interface SendingDnsRecord {
  type: string;
  name: string;
  content: string;
  priority?: number;
  reason?: string;
}

export async function getSendingDnsRecords(
  token: string,
  accountId: string,
  domain: string,
): Promise<SendingDnsRecord[]> {
  const res = await cfFetch<any>(
    `/accounts/${accountId}/email/sending/domains/${encodeURIComponent(domain)}/dns`,
    { method: 'GET', token },
  );
  // Endpoint shape varies in beta — accept both {records: [...]} and [...] directly.
  const list = Array.isArray(res) ? res : (res.records ?? res.dns_records ?? []);
  return list as SendingDnsRecord[];
}

export async function addDnsRecord(token: string, zoneId: string, record: SendingDnsRecord) {
  return cfFetch<any>(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    token,
    body: { ...record, ttl: 1, proxied: false },
  });
}

export async function enableEmailRouting(token: string, zoneId: string) {
  const status = await cfFetch<{ enabled: boolean; status?: string }>(
    `/zones/${zoneId}/email/routing`,
    { method: 'GET', token },
  ).catch(() => ({ enabled: false }) as any);
  if (status.enabled) return { alreadyEnabled: true };
  await cfFetch<any>(`/zones/${zoneId}/email/routing/enable`, { method: 'POST', token });
  return { alreadyEnabled: false };
}

export async function createRoutingRule(
  token: string,
  zoneId: string,
  mailboxAddress: string,
  workerName: string,
) {
  // Idempotent: skip if a rule matching this exact destination already exists.
  const existing = await cfFetch<Array<any>>(`/zones/${zoneId}/email/routing/rules`, {
    method: 'GET',
    token,
  }).catch(() => [] as any[]);
  const dup = (existing ?? []).find((r: any) =>
    r.matchers?.some((m: any) => m.type === 'literal' && m.field === 'to' && m.value === mailboxAddress),
  );
  if (dup) return { created: false, id: dup.id };
  const rule = await cfFetch<any>(`/zones/${zoneId}/email/routing/rules`, {
    method: 'POST',
    token,
    body: {
      name: `Ranse: ${mailboxAddress}`,
      enabled: true,
      matchers: [{ type: 'literal', field: 'to', value: mailboxAddress }],
      actions: [{ type: 'worker', value: [workerName] }],
    },
  });
  return { created: true, id: rule.id };
}

export interface ProvisionStep {
  id: string;
  label: string;
  status: 'ok' | 'fail' | 'skipped';
  message?: string;
  dns_records?: SendingDnsRecord[];
}

export interface ProvisionInput {
  apiToken: string;
  accountId: string;
  domain: string;
  mailboxAddress: string;
  workerName: string;
}

export async function applyProvisioning(input: ProvisionInput): Promise<ProvisionStep[]> {
  const steps: ProvisionStep[] = [];

  try {
    const t = await verifyToken(input.apiToken);
    if (t.status !== 'active') throw new Error(`Token status is "${t.status}"`);
    steps.push({ id: 'token', label: 'API token valid', status: 'ok' });
  } catch (err: any) {
    steps.push({ id: 'token', label: 'API token', status: 'fail', message: err.message });
    return steps;
  }

  const zone = await findZone(input.apiToken, input.domain).catch(() => null);
  if (zone) {
    steps.push({ id: 'zone', label: `Zone "${zone.zoneName}" found on Cloudflare`, status: 'ok' });
  } else {
    steps.push({
      id: 'zone',
      label: `Zone not on Cloudflare — DNS records will be returned for manual setup`,
      status: 'skipped',
    });
  }

  let dnsRecords: SendingDnsRecord[] = [];
  try {
    const result = await onboardSendingDomain(input.apiToken, input.accountId, input.domain);
    steps.push({
      id: 'sending',
      label: result.created ? `Sending domain "${input.domain}" onboarded` : `Sending domain "${input.domain}" already onboarded`,
      status: 'ok',
    });
    dnsRecords = await getSendingDnsRecords(input.apiToken, input.accountId, input.domain);
    steps.push({
      id: 'dns-fetch',
      label: `Fetched ${dnsRecords.length} DNS records (DKIM / SPF / DMARC)`,
      status: 'ok',
      dns_records: dnsRecords,
    });
  } catch (err: any) {
    steps.push({ id: 'sending', label: 'Onboard sending domain', status: 'fail', message: err.message });
    return steps;
  }

  if (zone) {
    let added = 0;
    let skipped = 0;
    const failures: string[] = [];
    for (const r of dnsRecords) {
      try {
        await addDnsRecord(input.apiToken, zone.zoneId, r);
        added++;
      } catch (err: any) {
        const msg = String(err.message ?? err);
        if (/already exists|duplicate/i.test(msg)) skipped++;
        else failures.push(`${r.type} ${r.name}: ${msg}`);
      }
    }
    steps.push({
      id: 'dns-add',
      label: `DNS records: ${added} added, ${skipped} already present${failures.length ? `, ${failures.length} failed` : ''}`,
      status: failures.length ? 'fail' : 'ok',
      message: failures.join('\n') || undefined,
      dns_records: dnsRecords,
    });
  } else {
    steps.push({
      id: 'dns-add',
      label: 'Add these DNS records at your registrar',
      status: 'skipped',
      dns_records: dnsRecords,
    });
  }

  if (zone) {
    try {
      const er = await enableEmailRouting(input.apiToken, zone.zoneId);
      steps.push({
        id: 'routing',
        label: er.alreadyEnabled ? 'Email Routing already enabled' : 'Email Routing enabled',
        status: 'ok',
      });
    } catch (err: any) {
      steps.push({ id: 'routing', label: 'Enable Email Routing', status: 'fail', message: err.message });
      return steps;
    }

    try {
      const rule = await createRoutingRule(
        input.apiToken,
        zone.zoneId,
        input.mailboxAddress,
        input.workerName,
      );
      steps.push({
        id: 'rule',
        label: rule.created
          ? `Routing rule created: ${input.mailboxAddress} → ${input.workerName}`
          : `Routing rule already present: ${input.mailboxAddress}`,
        status: 'ok',
      });
    } catch (err: any) {
      steps.push({ id: 'rule', label: 'Create routing rule', status: 'fail', message: err.message });
    }
  } else {
    steps.push({
      id: 'routing',
      label: 'Email Routing — set up manually at the registrar zone',
      status: 'skipped',
    });
  }

  return steps;
}
