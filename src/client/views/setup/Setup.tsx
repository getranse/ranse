import { useState } from 'react';
import type { ProvisionStep } from '../../../types/shared/provisioning';
import type { AdminForm, MailboxForm, ProvisionForm, SetupChecks, SetupStep } from '../../../types/shared/setup';
import { API } from '../../api';
import { AdminStep } from './AdminStep';
import { DoneStep } from './DoneStep';
import { MailboxStep } from './MailboxStep';
import { ReviewStep } from './ReviewStep';

function detectWorkerName(): string {
  if (typeof window === 'undefined') return '';
  const host = window.location.hostname;
  return host.endsWith('.workers.dev') ? host.split('.')[0] : '';
}

export function SetupView({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<SetupStep>(1);
  const [admin, setAdmin] = useState<AdminForm>({
    setup_token: '',
    workspace_name: '',
    admin_name: '',
    admin_email: '',
    admin_password: '',
  });
  const [mailbox, setMailbox] = useState<MailboxForm>({ address: '', display_name: '' });
  const [provision, setProvision] = useState<ProvisionForm>({
    enabled: false,
    api_token: '',
    account_id: '',
    worker_name: detectWorkerName(),
  });
  const [showToken, setShowToken] = useState(false);
  const [showApiToken, setShowApiToken] = useState(false);
  const [provisionSteps, setProvisionSteps] = useState<ProvisionStep[] | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState('');
  const [checks, setChecks] = useState<SetupChecks | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function next(to: SetupStep) {
    setError('');
    setStep(to);
  }

  async function runProvision() {
    setError('');
    if (!mailbox.address || !provision.api_token || !provision.account_id || !provision.worker_name) {
      setError('Fill in mailbox address, API token, account ID, and Worker name first.');
      return;
    }
    setProvisioning(true);
    setProvisionSteps(null);
    try {
      const res = await API.provision({
        api_token: provision.api_token,
        account_id: provision.account_id,
        domain: mailbox.address.split('@')[1],
        mailbox_address: mailbox.address,
        worker_name: provision.worker_name,
      });
      setProvisionSteps(res.steps);
      if (!res.ok) setError('Some steps failed — review below and retry.');
    } catch (err: any) {
      setError(err.message || 'Provisioning failed');
    } finally {
      setProvisioning(false);
    }
  }

  async function finish() {
    setError('');
    setSubmitting(true);
    try {
      await API.bootstrap(admin);
      await API.addMailbox(mailbox);
      setChecks(await API.verify());
      setStep(4);
    } catch (err: any) {
      setError(err.message || 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center">
      <div className="auth-card card">
        <h1>Welcome to Ranse</h1>
        <p className="muted">
          Step {step === 4 ? '3' : step} of 3
          {step === 4 && ' — all set.'}
        </p>

        {step === 1 && (
          <AdminStep
            admin={admin}
            error={error}
            showToken={showToken}
            setAdmin={setAdmin}
            setShowToken={setShowToken}
            onNext={() => next(2)}
          />
        )}

        {step === 2 && (
          <MailboxStep
            mailbox={mailbox}
            provision={provision}
            provisionSteps={provisionSteps}
            provisioning={provisioning}
            error={error}
            showApiToken={showApiToken}
            setMailbox={setMailbox}
            setProvision={setProvision}
            setShowApiToken={setShowApiToken}
            runProvision={runProvision}
            onBack={() => next(1)}
            onNext={() => next(3)}
          />
        )}

        {step === 3 && (
          <ReviewStep
            admin={admin}
            mailbox={mailbox}
            error={error}
            submitting={submitting}
            onBack={() => next(2)}
            onFinish={finish}
          />
        )}

        {step === 4 && checks && <DoneStep checks={checks} onDone={onDone} />}
      </div>
    </div>
  );
}
