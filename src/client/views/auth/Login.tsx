import { useState } from 'react';
import { API } from '../../api';

export function LoginView({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await API.login(email, password, totpCode || undefined);
      onSuccess();
    } catch (err: any) {
      if (err.code === 'totp_required') setNeedsTotp(true);
      else setError(err.message || 'Invalid credentials');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="auth-card card" onSubmit={submit}>
        <h1>Sign in to Ranse</h1>
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {needsTotp && (
          <div className="field">
            <label>Two-factor code</label>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              required
              autoFocus
            />
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
