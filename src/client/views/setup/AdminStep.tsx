import type { AdminForm } from '../../../types/setup';

export function AdminStep(props: {
  admin: AdminForm;
  error: string;
  showToken: boolean;
  setAdmin: (admin: AdminForm) => void;
  setShowToken: (fn: (value: boolean) => boolean) => void;
  onNext: () => void;
}) {
  const { admin, error, showToken, setAdmin, setShowToken, onNext } = props;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
    >
      <h2>Step 1 · Admin account</h2>
      <div className="field">
        <label>Setup token</label>
        <div style={{ position: 'relative' }}>
          <input
            type={showToken ? 'text' : 'password'}
            value={admin.setup_token}
            onChange={(e) => setAdmin({ ...admin, setup_token: e.target.value })}
            placeholder="Paste your ADMIN_SETUP_TOKEN"
            autoComplete="off"
            spellCheck={false}
            required
            style={{ paddingRight: 56 }}
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            style={secretToggleStyle}
          >
            {showToken ? 'Hide' : 'Show'}
          </button>
        </div>
        <div className="muted" style={{ marginTop: 6, lineHeight: 1.55 }}>
          Find it in your Cloudflare deploy build log, or rotate with
          <code style={{ display: 'inline-block', margin: '0 4px' }}>
            wrangler secret put ADMIN_SETUP_TOKEN
          </code>
          . One-time use.
        </div>
      </div>
      <div className="field">
        <label>Workspace name</label>
        <input value={admin.workspace_name} onChange={(e) => setAdmin({ ...admin, workspace_name: e.target.value })} required />
      </div>
      <div className="field">
        <label>Your name</label>
        <input value={admin.admin_name} onChange={(e) => setAdmin({ ...admin, admin_name: e.target.value })} />
      </div>
      <div className="field">
        <label>Admin email</label>
        <input type="email" value={admin.admin_email} onChange={(e) => setAdmin({ ...admin, admin_email: e.target.value })} required />
      </div>
      <div className="field">
        <label>Password (min 12 chars)</label>
        <input
          type="password"
          value={admin.admin_password}
          onChange={(e) => setAdmin({ ...admin, admin_password: e.target.value })}
          required
          minLength={12}
        />
      </div>
      {error && <div className="error">{error}</div>}
      <button type="submit" className="primary" style={{ width: '100%' }}>
        Next
      </button>
    </form>
  );
}

const secretToggleStyle = {
  position: 'absolute',
  right: 4,
  top: '50%',
  transform: 'translateY(-50%)',
  padding: '4px 10px',
  fontSize: 12,
  background: 'transparent',
  border: 'none',
  color: 'var(--text-muted)',
} as const;
