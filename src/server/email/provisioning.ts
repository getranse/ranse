/**
 * Cloudflare Email provisioning — single-zone architecture:
 *
 * Apex zone handles Email Routing for inbound mail; Email Sending is onboarded
 * on mail.<apex> so outbound DKIM/SPF records do not collide with apex routing.
 * Routing still has to be enabled once in the dashboard because Cloudflare's
 * routing-enable endpoint is not accessible to normal API tokens.
 */

import type { ProvisionInput, ProvisionStep, SendingDnsRecord } from '../../types/provisioning';
import { findZone, verifyToken } from './cloudflare-api';
import { configureCatchAllToWorker, createRoutingRule, detectEmailRouting } from './routing-provisioning';
import { addDnsRecord, getSendingDnsRecords, onboardSendingDomain } from './sending-provisioning';

export type { ProvisionInput, ProvisionStep, SendingDnsRecord, SendingSubdomain } from '../../types/provisioning';
export { findZone, verifyToken } from './cloudflare-api';
export { configureCatchAllToWorker, createRoutingRule, detectEmailRouting } from './routing-provisioning';
export { addDnsRecord, getSendingDnsRecords, onboardSendingDomain } from './sending-provisioning';

export async function applyProvisioning(input: ProvisionInput): Promise<ProvisionStep[]> {
  const steps: ProvisionStep[] = [];
  if (!(await pushTokenStep(steps, input.apiToken))) return steps;

  const zone = await findZone(input.apiToken, input.domain).catch(() => null);
  if (!zone) {
    steps.push({
      id: 'zone',
      label: `Zone for "${input.domain}" not found on this Cloudflare account`,
      status: 'fail',
      message:
        'Email Routing requires the domain to be a zone on this account. Add the domain at dash.cloudflare.com → Add a site, then retry.',
    });
    return steps;
  }
  steps.push({ id: 'zone', label: `Zone "${zone.zoneName}" found on Cloudflare`, status: 'ok' });

  if (!(await pushRoutingStateStep(steps, input, zone.zoneId))) return steps;

  const sendingDnsRecords = await pushSendingOnboardSteps(steps, input, zone.zoneId);
  if (!sendingDnsRecords) return steps;
  if (!(await pushSendingDnsStep(steps, input, zone.zoneId, sendingDnsRecords))) return steps;
  if (!(await pushRoutingRuleStep(steps, input, zone.zoneId))) return steps;

  await pushCatchAllStep(steps, input, zone.zoneId);
  return steps;
}

async function pushTokenStep(steps: ProvisionStep[], token: string): Promise<boolean> {
  try {
    const t = await verifyToken(token);
    if (t.status !== 'active') throw new Error(`Token status is "${t.status}"`);
    steps.push({ id: 'token', label: 'API token valid', status: 'ok' });
    return true;
  } catch (err: any) {
    steps.push({ id: 'token', label: 'API token', status: 'fail', message: err.message });
    return false;
  }
}

async function pushRoutingStateStep(
  steps: ProvisionStep[],
  input: ProvisionInput,
  zoneId: string,
): Promise<boolean> {
  let routingEnabled = false;
  try {
    routingEnabled = (await detectEmailRouting(input.apiToken, zoneId)).enabled;
  } catch (err: any) {
    steps.push({ id: 'routing', label: 'Detect Email Routing state', status: 'fail', message: err.message });
    return false;
  }
  if (routingEnabled) {
    steps.push({ id: 'routing', label: 'Email Routing is enabled', status: 'ok' });
    return true;
  }
  steps.push({
    id: 'routing',
    label: 'Email Routing is not enabled on this zone',
    status: 'fail',
    message:
      `Email Routing has to be enabled in the Cloudflare dashboard.\n\n` +
      `Click "Onboard Domain" for ${input.domain}, accept Cloudflare's MX records, then return here and click Retry.`,
    actions: [{ url: `https://dash.cloudflare.com/${input.accountId}/email-service/routing`, label: 'Open Email Routing dashboard →' }],
  });
  return false;
}

async function pushSendingOnboardSteps(
  steps: ProvisionStep[],
  input: ProvisionInput,
  zoneId: string,
): Promise<SendingDnsRecord[] | null> {
  const sendingDomain = `mail.${input.domain}`;
  try {
    const result = await onboardSendingDomain(input.apiToken, zoneId, sendingDomain);
    steps.push({
      id: 'sending-onboard',
      label: result.created
        ? `Email Sending onboarded on "${sendingDomain}"`
        : `Email Sending already onboarded on "${sendingDomain}"`,
      status: 'ok',
    });
    const records = await getSendingDnsRecords(input.apiToken, zoneId, result.subdomain.tag);
    steps.push({
      id: 'sending-dns-fetch',
      label: `Fetched ${records.length} DKIM/SPF/DMARC records`,
      status: 'ok',
      dns_records: records,
    });
    return records;
  } catch (err: any) {
    steps.push({ id: 'sending-onboard', label: 'Onboard Email Sending', status: 'fail', message: err.message });
    return null;
  }
}

async function pushSendingDnsStep(
  steps: ProvisionStep[],
  input: ProvisionInput,
  zoneId: string,
  records: SendingDnsRecord[],
): Promise<boolean> {
  const result = { added: 0, alreadyPresent: 0, routingManaged: 0, routingManagedRecords: [] as string[], failures: [] as string[] };
  for (const r of records) {
    try {
      await addDnsRecord(input.apiToken, zoneId, r);
      result.added++;
    } catch (err: any) {
      classifyDnsFailure(result, r, String(err.message ?? err));
    }
  }

  const parts = [`${result.added} added`];
  if (result.alreadyPresent) parts.push(`${result.alreadyPresent} already present`);
  if (result.routingManaged) parts.push(`${result.routingManaged} skipped (managed by Email Routing)`);
  if (result.failures.length) parts.push(`${result.failures.length} failed`);
  steps.push({
    id: 'sending-dns-add',
    label: `Sending DNS records: ${parts.join(', ')}`,
    status: result.failures.length ? 'fail' : 'ok',
    message: sendingDnsMessage(result),
    dns_records: records,
  });
  return result.failures.length === 0;
}

function classifyDnsFailure(
  result: { alreadyPresent: number; routingManaged: number; routingManagedRecords: string[]; failures: string[] },
  record: SendingDnsRecord,
  message: string,
) {
  if (/already exists|duplicate/i.test(message)) {
    result.alreadyPresent++;
  } else if (/managed by Email Routing/i.test(message)) {
    result.routingManaged++;
    result.routingManagedRecords.push(`${record.type} ${record.name} → ${record.content}`);
  } else {
    result.failures.push(`${record.type} ${record.name}: ${message}`);
  }
}

function sendingDnsMessage(result: { routingManaged: number; routingManagedRecords: string[]; failures: string[] }): string | undefined {
  const parts = [
    result.failures.length ? `Failed:\n${result.failures.join('\n')}` : '',
    result.routingManaged
      ? `Email Routing manages this zone's MX records, so bounce-handling MX entries could not be added. Sending still works; bounces just will not be auto-routed back to the Worker.\n\n${result.routingManagedRecords.join('\n')}`
      : '',
  ].filter(Boolean);
  return parts.length ? parts.join('\n\n') : undefined;
}

async function pushRoutingRuleStep(steps: ProvisionStep[], input: ProvisionInput, zoneId: string): Promise<boolean> {
  try {
    const rule = await createRoutingRule(input.apiToken, zoneId, input.mailboxAddress, input.workerName);
    const enabledNote = rule.enabled ? '' : ' (note: rule is disabled — toggle on in dashboard)';
    steps.push({
      id: 'rule',
      label: rule.created
        ? `Routing rule created: ${input.mailboxAddress} → ${input.workerName}${enabledNote}`
        : `Routing rule already present: ${input.mailboxAddress}${enabledNote}`,
      status: 'ok',
    });
    return true;
  } catch (err: any) {
    steps.push({ id: 'rule', label: 'Create routing rule', status: 'fail', message: err.message });
    return false;
  }
}

async function pushCatchAllStep(steps: ProvisionStep[], input: ProvisionInput, zoneId: string): Promise<void> {
  try {
    await configureCatchAllToWorker(input.apiToken, zoneId, input.workerName);
    steps.push({
      id: 'catch-all',
      label: `Catch-all → ${input.workerName} (any address @ ${input.domain})`,
      status: 'ok',
    });
  } catch (err: any) {
    steps.push({ id: 'catch-all', label: 'Configure catch-all to Worker', status: 'fail', message: err.message });
  }
}
