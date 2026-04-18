import { useState } from 'react';
import { API } from '../api';

export function SetupView({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState({
    bootstrap_token: '',
    workspace_name: '',
    admin_email: '',
    admin_password: '',
    admin_name: '',
  });
  const [mailbox, setMailbox] = useState({ address: '', display_name: '' });
  const [error, setError] = useState('');
  const [checks, setChecks] = useState<any>(null);

  async function submitBootstrap(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await API.bootstrap(form);
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function submitMailbox(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await API.addMailbox(mailbox);
      const v = await API.verify();
      setChecks(v);
      setStep(3);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="center">
      <div className="auth-card card">
        <h1>Welcome to Ranse</h1>
        <p className="muted">Let's set up your support workspace.</p>

        {step === 1 && (
          <form onSubmit={submitBootstrap}>
            <h2>Step 1 · Admin account</h2>
            <div className="field">
              <label>Bootstrap token</label>
              <input
                value={form.bootstrap_token}
                onChange={(e) => setForm({ ...form, bootstrap_token: e.target.value })}
                placeholder="From ADMIN_BOOTSTRAP_TOKEN secret"
                required
              />
              <span className="muted">
                This is the <code>ADMIN_BOOTSTRAP_TOKEN</code> value you set during deploy — single-use.
              </span>
            </div>
            <div className="field">
              <label>Workspace name</label>
              <input value={form.workspace_name} onChange={(e) => setForm({ ...form, workspace_name: e.target.value })} required />
            </div>
            <div className="field">
              <label>Your name</label>
              <input value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} />
            </div>
            <div className="field">
              <label>Admin email</label>
              <input type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} required />
            </div>
            <div className="field">
              <label>Password (min 12 chars)</label>
              <input type="password" value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} required minLength={12} />
            </div>
            {error && <div className="error">{error}</div>}
            <button type="submit" className="primary" style={{ width: '100%' }}>Create workspace</button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={submitMailbox}>
            <h2>Step 2 · Support mailbox</h2>
            <p className="muted">
              The address to receive support email. You'll route this address to the Ranse Worker in the
              Cloudflare Email dashboard.
            </p>
            <div className="field">
              <label>Mailbox address</label>
              <input
                type="email"
                placeholder="support@yourdomain.com"
                value={mailbox.address}
                onChange={(e) => setMailbox({ ...mailbox, address: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Display name</label>
              <input
                placeholder="Acme Support"
                value={mailbox.display_name}
                onChange={(e) => setMailbox({ ...mailbox, display_name: e.target.value })}
              />
            </div>
            {error && <div className="error">{error}</div>}
            <button type="submit" className="primary" style={{ width: '100%' }}>Add mailbox & verify</button>
          </form>
        )}

        {step === 3 && checks && (
          <>
            <h2>Step 3 · Verification</h2>
            <div className="step ok"><span className="dot" />Workspace created</div>
            {Object.entries<any>(checks.checks).map(([k, v]) => (
              <div key={k} className={`step ${v.ok ? 'ok' : 'fail'}`}>
                <span className="dot" />
                {k.toUpperCase()} {v.ok ? 'OK' : `— ${v.message}`}
              </div>
            ))}
            <p className="muted" style={{ marginTop: 16 }}>
              Next: in Cloudflare → Email Routing, add your support address and set the destination to the
              <code> ranse </code> Worker. Then send a test email.
            </p>
            <button className="primary" style={{ width: '100%' }} onClick={onDone}>Enter inbox</button>
          </>
        )}
      </div>
    </div>
  );
}
