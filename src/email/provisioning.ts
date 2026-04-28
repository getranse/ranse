/**
 * Cloudflare Email provisioning — single-zone architecture:
 *
 *   Apex zone (e.g. getranse.com)
 *     ├── Email Routing on apex     → MX → mx.cloudflare.net (inbound)
 *     └── Email Sending subdomain   → DKIM/SPF/DMARC on mail.<apex>
 *                                      MX → cf-bounce.mail.<apex>
 *
 * Cloudflare's "no other email services on the same zone" rule applies
 * to apex-level email (you can't onboard <apex> for Sending while it
 * has Routing). But the Sending API takes a subdomain *name* within a
 * zone — not a separate zone — so Sending on mail.<apex> coexists with
 * Routing on <apex> because their DNS records don't overlap (different
 * MX hostnames, different DKIM record names). DMARC alignment is
 * relaxed (organizational domain match), so outbound from
 * mail.<apex> still passes DMARC for <apex>.
 *
 * No separate zone needed — works on Cloudflare Free.
 *
 * Why we don't enable Email Routing programmatically: both GET
 * /zones/:id/email/routing and POST /zones/:id/email/routing/enable
 * return 10000 ("Authentication error") for ANY API token, regardless
 * of scopes. The dashboard uses session OAuth with broader internal
 * scopes that aren't available to tokens. We detect Routing state via
 * the *.mx.cloudflare.net MX records the onboard flow installs, and
 * point the user at the dashboard for the one-time Routing onboard.
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

export interface SendingSubdomain {
  tag: string;
  name: string;
  enabled?: boolean;
  dkim_selector?: string;
}

/**
 * Idempotently ensure a sending subdomain exists. The Cloudflare API exposes
 * `GET /subdomains/:tag` (not by name), so we list-and-match-by-name to find
 * an existing one before creating.
 */
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

export interface SendingDnsRecord {
  type: string;
  name: string;
  content: string;
  priority?: number;
  reason?: string;
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

/**
 * Detect whether Email Routing is enabled on a zone by checking for
 * Cloudflare's routing MX records (`*.mx.cloudflare.net`). When Routing is
 * enabled, Cloudflare adds three of these records automatically.
 *
 * Why not GET /zones/:id/email/routing? Empirically, that endpoint (and
 * POST /enable) is gated by an undocumented permission that no API token
 * UI exposes — neither Email Routing Rules: Edit nor Email Routing
 * Addresses: Edit authorize it. Both return 10000 regardless of token
 * scopes. The dashboard's "Onboard Domain" button works because the
 * dashboard uses session OAuth with broader internal scopes that aren't
 * available to API tokens.
 *
 * DNS:Read (or Zone:Read on some accounts) is grantable, so we infer the
 * routing state from the MX records that Routing's enable flow installs.
 */
export async function detectEmailRouting(
  token: string,
  zoneId: string,
): Promise<{ enabled: boolean }> {
  const records = await cfFetch<Array<{ type: string; content: string }>>(
    `/zones/${zoneId}/dns_records?type=MX&per_page=20`,
    { method: 'GET', token },
  );
  const enabled = records.some((r) => /\.mx\.cloudflare\.net\.?$/i.test(r.content));
  return { enabled };
}

export async function createRoutingRule(
  token: string,
  zoneId: string,
  mailboxAddress: string,
  workerName: string,
) {
  // Cloudflare creates rules in a *disabled* state regardless of the
  // `enabled: true` we send in POST (verified empirically in the
  // dashboard — rule appears with Status toggle off). So we PUT the
  // rule after POST to actually enable it.
  const existing = await cfFetch<Array<any>>(`/zones/${zoneId}/email/routing/rules`, {
    method: 'GET',
    token,
  }).catch(() => [] as any[]);
  const dup = (existing ?? []).find((r: any) =>
    r.matchers?.some((m: any) => m.type === 'literal' && m.field === 'to' && m.value === mailboxAddress),
  );

  let rule: any;
  if (dup) {
    rule = dup;
  } else {
    rule = await cfFetch<any>(`/zones/${zoneId}/email/routing/rules`, {
      method: 'POST',
      token,
      body: {
        name: `Ranse: ${mailboxAddress}`,
        enabled: true,
        matchers: [{ type: 'literal', field: 'to', value: mailboxAddress }],
        actions: [{ type: 'worker', value: [workerName] }],
      },
    });
  }

  const ruleId = rule.tag ?? rule.id;
  if (!rule.enabled) {
    rule = await cfFetch<any>(`/zones/${zoneId}/email/routing/rules/${ruleId}`, {
      method: 'PUT',
      token,
      body: {
        name: rule.name ?? `Ranse: ${mailboxAddress}`,
        enabled: true,
        matchers: rule.matchers ?? [
          { type: 'literal', field: 'to', value: mailboxAddress },
        ],
        actions: rule.actions ?? [{ type: 'worker', value: [workerName] }],
      },
    });
  }

  return { created: !dup, id: ruleId, enabled: rule.enabled === true };
}

/**
 * Configure the zone's catch-all rule to route to the Worker. Without
 * this, mail to any-address-other-than-the-explicit-rule gets dropped
 * by default. For a support inbox where operators want flexibility
 * (sales@, billing@, hi@ all going to the same Worker), catch-all =>
 * Worker is the right default. The Worker can decide internally what
 * to do with addresses that don't map to known mailboxes.
 *
 * Catch-all is special-cased in Cloudflare's API — it's always at the
 * fixed identifier `catch_all` on the rule path; PUT replaces its
 * configuration.
 */
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

export interface ProvisionStep {
  id: string;
  label: string;
  status: 'ok' | 'fail' | 'skipped';
  message?: string;
  dns_records?: SendingDnsRecord[];
  actions?: Array<{ url: string; label: string }>;
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

  // Zone is required for Email Routing. Fail-fast if the domain isn't on
  // this Cloudflare account.
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

  // Email Routing must be enabled by the user via the Cloudflare dashboard
  // — programmatic enable is not possible (see file header). Detect state
  // via the *.mx.cloudflare.net MX records that Routing's onboard flow
  // installs.
  let routingEnabled = false;
  try {
    routingEnabled = (await detectEmailRouting(input.apiToken, zone.zoneId)).enabled;
  } catch (err: any) {
    steps.push({
      id: 'routing',
      label: 'Detect Email Routing state',
      status: 'fail',
      message: err.message,
    });
    return steps;
  }
  if (!routingEnabled) {
    steps.push({
      id: 'routing',
      label: 'Email Routing is not enabled on this zone',
      status: 'fail',
      message:
        `Email Routing has to be enabled in the Cloudflare dashboard (it can't be enabled via API tokens — Cloudflare gates the /email/routing/enable endpoint behind an internal permission that no token UI exposes).\n\n` +
        `Click "Onboard Domain" for ${input.domain}, accept Cloudflare's MX records, then return here and click Retry. ` +
        `Once Routing is on, this wizard will create the support-mailbox routing rule via API automatically.`,
      actions: [
        {
          url: `https://dash.cloudflare.com/${input.accountId}/email-service/routing`,
          label: 'Open Email Routing dashboard →',
        },
      ],
    });
    return steps;
  }
  steps.push({ id: 'routing', label: 'Email Routing is enabled', status: 'ok' });

  // Onboard Email Sending as a *subdomain* of the apex zone. The Sending
  // API takes a subdomain name within an existing zone — no separate
  // zone delegation needed. Sending on mail.<apex> coexists with
  // Routing on <apex> because their DNS records don't overlap.
  const sendingDomain = `mail.${input.domain}`;
  let sendingDnsRecords: SendingDnsRecord[] = [];
  try {
    const result = await onboardSendingDomain(input.apiToken, zone.zoneId, sendingDomain);
    steps.push({
      id: 'sending-onboard',
      label: result.created
        ? `Email Sending onboarded on "${sendingDomain}"`
        : `Email Sending already onboarded on "${sendingDomain}"`,
      status: 'ok',
    });
    sendingDnsRecords = await getSendingDnsRecords(
      input.apiToken,
      zone.zoneId,
      result.subdomain.tag,
    );
    steps.push({
      id: 'sending-dns-fetch',
      label: `Fetched ${sendingDnsRecords.length} DKIM/SPF/DMARC records`,
      status: 'ok',
      dns_records: sendingDnsRecords,
    });
  } catch (err: any) {
    steps.push({
      id: 'sending-onboard',
      label: 'Onboard Email Sending',
      status: 'fail',
      message: err.message,
    });
    return steps;
  }

  let added = 0;
  let alreadyPresent = 0;
  let routingManaged = 0;
  const routingManagedRecords: string[] = [];
  const sendingDnsFailures: string[] = [];
  for (const r of sendingDnsRecords) {
    try {
      await addDnsRecord(input.apiToken, zone.zoneId, r);
      added++;
    } catch (err: any) {
      const msg = String(err.message ?? err);
      if (/already exists|duplicate/i.test(msg)) {
        alreadyPresent++;
      } else if (/managed by Email Routing/i.test(msg)) {
        // Email Routing claims all MX records in the zone, including
        // subdomain MX like cf-bounce.mail.<apex>. Sending still works
        // without bounce-handling MX; bounces just won't be auto-
        // processed. Soft warning, not a hard fail.
        routingManaged++;
        routingManagedRecords.push(`${r.type} ${r.name} → ${r.content}`);
      } else {
        sendingDnsFailures.push(`${r.type} ${r.name}: ${msg}`);
      }
    }
  }
  const sendingParts = [`${added} added`];
  if (alreadyPresent) sendingParts.push(`${alreadyPresent} already present`);
  if (routingManaged) sendingParts.push(`${routingManaged} skipped (managed by Email Routing)`);
  if (sendingDnsFailures.length) sendingParts.push(`${sendingDnsFailures.length} failed`);
  steps.push({
    id: 'sending-dns-add',
    label: `Sending DNS records: ${sendingParts.join(', ')}`,
    status: sendingDnsFailures.length ? 'fail' : 'ok',
    message:
      [
        sendingDnsFailures.length ? `Failed:\n${sendingDnsFailures.join('\n')}` : '',
        routingManaged
          ? `Email Routing manages this zone's MX records, so the bounce-handling MX entries below couldn't be added. Sending still works fully; bounces just won't be auto-routed back to the Worker.\n\n${routingManagedRecords.join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n') || undefined,
    dns_records: sendingDnsRecords,
  });
  if (sendingDnsFailures.length) return steps;

  try {
    const rule = await createRoutingRule(
      input.apiToken,
      zone.zoneId,
      input.mailboxAddress,
      input.workerName,
    );
    const enabledNote = rule.enabled ? '' : ' (note: rule is disabled — toggle on in dashboard)';
    steps.push({
      id: 'rule',
      label: rule.created
        ? `Routing rule created: ${input.mailboxAddress} → ${input.workerName}${enabledNote}`
        : `Routing rule already present: ${input.mailboxAddress}${enabledNote}`,
      status: 'ok',
    });
  } catch (err: any) {
    steps.push({ id: 'rule', label: 'Create routing rule', status: 'fail', message: err.message });
    return steps;
  }

  // Catch-all → Worker, so any other-address mail (sales@, billing@, etc.)
  // also reaches the inbox. The Worker handles internal routing for
  // unknown addresses; default Drop would silently lose them.
  try {
    await configureCatchAllToWorker(input.apiToken, zone.zoneId, input.workerName);
    steps.push({
      id: 'catch-all',
      label: `Catch-all → ${input.workerName} (any address @ ${input.domain})`,
      status: 'ok',
    });
  } catch (err: any) {
    steps.push({
      id: 'catch-all',
      label: 'Configure catch-all to Worker',
      status: 'fail',
      message: err.message,
    });
  }

  return steps;
}
