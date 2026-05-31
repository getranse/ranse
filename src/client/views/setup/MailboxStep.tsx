import type { ProvisionStep } from '../../../types/shared/provisioning';
import type { MailboxForm, ProvisionForm } from '../../../types/shared/setup';
import { secretToggleStyle } from './styles';

export function MailboxStep(props: {
  mailbox: MailboxForm;
  provision: ProvisionForm;
  provisionSteps: ProvisionStep[] | null;
  provisioning: boolean;
  error: string;
  showApiToken: boolean;
  setMailbox: (mailbox: MailboxForm) => void;
  setProvision: (provision: ProvisionForm) => void;
  setShowApiToken: (fn: (value: boolean) => boolean) => void;
  runProvision: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { mailbox, provision, provisionSteps, provisioning, error } = props;
  const domain = mailbox.address ? mailbox.address.split('@')[1] : 'your-domain.com';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onNext();
      }}
    >
      <h2>Step 2 · Support mailbox</h2>
      <p className="muted">
        The address to receive support email. You'll route this address to the Ranse Worker
        in the Cloudflare Email dashboard.
      </p>
      <div className="field">
        <label>Mailbox address</label>
        <input
          type="email"
          placeholder="support@yourdomain.com"
          value={mailbox.address}
          onChange={(e) => props.setMailbox({ ...mailbox, address: e.target.value })}
          required
        />
      </div>
      <div className="field">
        <label>Display name</label>
        <input
          placeholder="Acme Support"
          value={mailbox.display_name}
          onChange={(e) => props.setMailbox({ ...mailbox, display_name: e.target.value })}
        />
      </div>
      <details
        style={{ marginTop: 12, padding: 10, background: 'var(--bg-soft)', borderRadius: 6, border: '1px solid var(--border)' }}
        open={provision.enabled}
        onToggle={(e) => props.setProvision({ ...provision, enabled: (e.target as HTMLDetailsElement).open })}
      >
        <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Auto-configure Cloudflare (optional)</summary>
        <ProvisionCopy domain={domain} />
        <ProvisionFields {...props} />
        <button type="button" onClick={props.runProvision} disabled={provisioning} style={{ marginTop: 6 }}>
          {provisioning ? 'Provisioning…' : provisionSteps ? 'Retry' : 'Run auto-configure'}
        </button>
        {provisionSteps && <ProvisionResults steps={provisionSteps} />}
      </details>
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" onClick={props.onBack} style={{ flex: 1 }}>← Back</button>
        <button type="submit" className="primary" style={{ flex: 2 }}>Next</button>
      </div>
    </form>
  );
}

function ProvisionCopy({ domain }: { domain: string }) {
  return (
    <>
      <p className="muted" style={{ marginTop: 8 }}>
        Single-zone setup on <strong>{domain}</strong>: inbound via Email Routing → Worker, outbound DKIM-signed via Email Sending on <code>mail.{domain}</code>. Routing has to be enabled once via the dashboard; everything else runs API-only. Token is used once and not stored.
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        Required token permissions: <strong>Account · Email Sending: Edit, Zone · Zone: Read, Zone · DNS: Edit, Zone · Email Routing Rules: Edit</strong>.{' '}
        <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">Create token →</a>
      </p>
    </>
  );
}

function ProvisionFields(props: {
  provision: ProvisionForm;
  showApiToken: boolean;
  setProvision: (provision: ProvisionForm) => void;
  setShowApiToken: (fn: (value: boolean) => boolean) => void;
}) {
  const { provision, showApiToken, setProvision, setShowApiToken } = props;
  return (
    <>
      <div className="field">
        <label>Cloudflare API token</label>
        <div style={{ position: 'relative' }}>
          <input
            type={showApiToken ? 'text' : 'password'}
            value={provision.api_token}
            onChange={(e) => setProvision({ ...provision, api_token: e.target.value })}
            autoComplete="off"
            spellCheck={false}
            placeholder="cf_xxx..."
            style={{ paddingRight: 56 }}
          />
          <button type="button" onClick={() => setShowApiToken((v) => !v)} style={secretToggleStyle}>
            {showApiToken ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      <div className="field">
        <label>Cloudflare account ID</label>
        <input
          value={provision.account_id}
          onChange={(e) => setProvision({ ...provision, account_id: e.target.value })}
          placeholder="0fd7f5d92bfc8b08c568e8e3cf575394"
          autoComplete="off"
          spellCheck={false}
        />
        <span className="muted">Dashboard → right sidebar → Account ID.</span>
      </div>
      <div className="field">
        <label>This Worker's script name</label>
        <input value={provision.worker_name} onChange={(e) => setProvision({ ...provision, worker_name: e.target.value })} placeholder="ranse" />
        <span className="muted">Auto-detected from your Worker URL.</span>
      </div>
    </>
  );
}

function ProvisionResults({ steps }: { steps: ProvisionStep[] }) {
  return (
    <div style={{ marginTop: 12 }}>
      {steps.map((s) => (
        <div key={s.id} className={`step ${s.status === 'ok' ? 'ok' : s.status === 'fail' ? 'fail' : ''}`}>
          <span className="dot" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>{s.label}</div>
            {s.status === 'fail' && s.message && <ProvisionError message={s.message} />}
            {s.actions && s.actions.length > 0 && <ProvisionActions actions={s.actions} />}
          </div>
        </div>
      ))}
      {steps.some((s) => s.dns_records && s.status === 'skipped') && <DnsRecords steps={steps} />}
    </div>
  );
}

function ProvisionError({ message }: { message: string }) {
  return <pre style={errorBlockStyle}>{message}</pre>;
}

function ProvisionActions({ actions }: { actions: Array<{ url: string; label: string }> }) {
  return (
    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {actions.map((a) => (
        <a key={a.url} href={a.url} target="_blank" rel="noreferrer" style={actionLinkStyle}>{a.label}</a>
      ))}
    </div>
  );
}

function DnsRecords({ steps }: { steps: ProvisionStep[] }) {
  return (
    <div style={{ marginTop: 10 }}>
      <strong style={{ fontSize: 13 }}>Add these at your registrar:</strong>
      <pre style={dnsBlockStyle}>
        {steps.flatMap((s) => s.dns_records ?? [])
          .map((r, i) => `${i + 1}. ${r.type}  ${r.name}  →  ${r.content}${r.priority ? ` (priority ${r.priority})` : ''}`)
          .join('\n')}
      </pre>
    </div>
  );
}

const errorBlockStyle = { marginTop: 4, padding: 6, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } as const;
const actionLinkStyle = { display: 'inline-block', padding: '4px 10px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-soft)', textDecoration: 'none', color: 'var(--fg)' } as const;
const dnsBlockStyle = { marginTop: 6, padding: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, overflow: 'auto' } as const;
