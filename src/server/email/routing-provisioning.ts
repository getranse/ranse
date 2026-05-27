import { cfFetch } from './cloudflare-api';

export async function detectEmailRouting(
  token: string,
  zoneId: string,
): Promise<{ enabled: boolean }> {
  const records = await cfFetch<Array<{ type: string; content: string }>>(
    `/zones/${zoneId}/dns_records?type=MX&per_page=20`,
    { method: 'GET', token },
  );
  return { enabled: records.some((r) => /\.mx\.cloudflare\.net\.?$/i.test(r.content)) };
}

export async function createRoutingRule(
  token: string,
  zoneId: string,
  mailboxAddress: string,
  workerName: string,
) {
  const existing = await cfFetch<Array<any>>(`/zones/${zoneId}/email/routing/rules`, {
    method: 'GET',
    token,
  }).catch(() => [] as any[]);
  const dup = (existing ?? []).find((r: any) =>
    r.matchers?.some((m: any) => m.type === 'literal' && m.field === 'to' && m.value === mailboxAddress),
  );

  let rule = dup ?? await cfFetch<any>(`/zones/${zoneId}/email/routing/rules`, {
    method: 'POST',
    token,
    body: {
      name: `Ranse: ${mailboxAddress}`,
      enabled: true,
      matchers: [{ type: 'literal', field: 'to', value: mailboxAddress }],
      actions: [{ type: 'worker', value: [workerName] }],
    },
  });

  const ruleId = rule.tag ?? rule.id;
  if (!rule.enabled) {
    rule = await cfFetch<any>(`/zones/${zoneId}/email/routing/rules/${ruleId}`, {
      method: 'PUT',
      token,
      body: {
        name: rule.name ?? `Ranse: ${mailboxAddress}`,
        enabled: true,
        matchers: rule.matchers ?? [{ type: 'literal', field: 'to', value: mailboxAddress }],
        actions: rule.actions ?? [{ type: 'worker', value: [workerName] }],
      },
    });
  }

  return { created: !dup, id: ruleId, enabled: rule.enabled === true };
}

export async function configureCatchAllToWorker(
  token: string,
  zoneId: string,
  workerName: string,
) {
  return cfFetch<any>(`/zones/${zoneId}/email/routing/rules/catch_all`, {
    method: 'PUT',
    token,
    body: {
      name: 'Ranse catch-all',
      enabled: true,
      matchers: [{ type: 'all' }],
      actions: [{ type: 'worker', value: [workerName] }],
    },
  });
}
