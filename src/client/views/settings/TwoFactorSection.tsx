import { useState } from 'react';
import { API } from '../../api';

/**
 * TOTP enrollment: provision a secret, confirm one valid code to enable.
 * The secret + otpauth URI are shown for authenticator apps (manual entry —
 * no QR dependency; most apps accept the setup key directly).
 */
export function TwoFactorSection({ onSaved }: { onSaved: (message: string) => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  async function begin() {
    setError('');
    try {
      setSetup(await API.totpSetup());
    } catch (err: any) {
      setError(err.message || 'Setup failed');
    }
  }

  async function confirm() {
    setError('');
    try {
      await API.totpVerify(code);
      setSetup(null);
      setCode('');
      onSaved('Two-factor auth enabled');
    } catch (err: any) {
      setError(err.message || 'Invalid code');
    }
  }

  async function disable() {
    setError('');
    try {
      await API.totpDisable(code);
      setCode('');
      onSaved('Two-factor auth disabled');
    } catch (err: any) {
      setError(err.message || 'Invalid code');
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <strong>Two-factor authentication</strong>
      {!setup ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
          <button type="button" onClick={begin}>
            Set up 2FA
          </button>
          <input
            placeholder="Code (to disable)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ maxWidth: 140 }}
          />
          <button type="button" onClick={disable} disabled={code.length < 6}>
            Disable
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 13 }}>
          <p style={{ margin: '0 0 6px' }}>
            Add this setup key to your authenticator app, then confirm with a code:
          </p>
          <code style={{ userSelect: 'all' }}>{setup.secret}</code>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input
              placeholder="123456"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ maxWidth: 140 }}
            />
            <button type="button" className="primary" onClick={confirm} disabled={code.length < 6}>
              Confirm & enable
            </button>
          </div>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
