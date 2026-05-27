import type { AdminForm, MailboxForm } from '../../../types/setup';

export function ReviewStep(props: {
  admin: AdminForm;
  mailbox: MailboxForm;
  error: string;
  submitting: boolean;
  onBack: () => void;
  onFinish: () => void;
}) {
  const { admin, mailbox, error, submitting, onBack, onFinish } = props;
  return (
    <>
      <h2>Step 3 · Review & finish</h2>
      <p className="muted">
        Double-check these values before committing. You can't undo setup without resetting the database.
      </p>
      <dl className="review">
        <dt>Workspace</dt>
        <dd>{admin.workspace_name}</dd>
        <dt>Admin</dt>
        <dd>{admin.admin_name ? `${admin.admin_name} · ${admin.admin_email}` : admin.admin_email}</dd>
        <dt>Password</dt>
        <dd>{'•'.repeat(Math.min(admin.admin_password.length, 16))}</dd>
        <dt>Mailbox</dt>
        <dd>
          {mailbox.address}
          {mailbox.display_name ? ` (${mailbox.display_name})` : ''}
        </dd>
      </dl>
      {error && <div className="error">{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onBack} disabled={submitting} style={{ flex: 1 }}>← Back</button>
        <button type="button" className="primary" onClick={onFinish} disabled={submitting} style={{ flex: 2 }}>
          {submitting ? 'Setting up…' : 'Finish setup'}
        </button>
      </div>
    </>
  );
}
