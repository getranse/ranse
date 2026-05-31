import type { SendingDnsRecord, SendingSubdomain } from '../../../types/shared/provisioning';
import { cfFetch } from './cloudflare-api';

export async function onboardSendingDomain(
  token: string,
  zoneId: string,
  name: string,
): Promise<{ created: boolean; subdomain: SendingSubdomain }> {
  const list = await cfFetch<SendingSubdomain[]>(
    `/zones/${zoneId}/email/sending/subdomains`,
    { method: 'GET', token },
  ).catch(() => [] as SendingSubdomain[]);
  const found = list.find((s) => s.name === name);
  if (found) return { created: false, subdomain: found };

  const created = await cfFetch<SendingSubdomain>(
    `/zones/${zoneId}/email/sending/subdomains`,
    { method: 'POST', token, body: { name } },
  );
  return { created: true, subdomain: created };
}

export async function getSendingDnsRecords(
  token: string,
  zoneId: string,
  tag: string,
): Promise<SendingDnsRecord[]> {
  const res = await cfFetch<any>(
    `/zones/${zoneId}/email/sending/subdomains/${tag}/dns`,
    { method: 'GET', token },
  );
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
