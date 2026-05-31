import type { SetupChecks } from '../../../types/shared/setup';

export function DoneStep({ checks, onDone }: { checks: SetupChecks; onDone: () => void }) {
  return (
    <>
      <h2>All set</h2>
      <div className="step ok">
        <span className="dot" />
        Workspace + admin created
      </div>
      <div className="step ok">
        <span className="dot" />
        Mailbox added
      </div>
      {Object.entries(checks.checks).map(([k, v]) => (
        <div key={k} className={`step ${v.ok ? 'ok' : 'fail'}`}>
          <span className="dot" />
          {k.toUpperCase()} {v.ok ? 'OK' : `— ${v.message}`}
        </div>
      ))}
      <p className="muted" style={{ marginTop: 16 }}>
        Next: in Cloudflare → Email Routing, add your support address and set the destination
        to the <code>ranse</code> Worker. Then send a test email.
      </p>
      <button className="primary" style={{ width: '100%' }} onClick={onDone}>
        Enter inbox
      </button>
    </>
  );
}
