import type { InviteAcceptViewProps } from '../../../interfaces/client';
import { useEffect, useState } from 'react';
import { API } from '../../api';

export function InviteAcceptView({ token, onDone }: InviteAcceptViewProps) {
  const [error, setError] = useState('');

  useEffect(() => {
    API.acceptInvitation(token)
      .then(onDone)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [token]);

  return (
    <div className="center">
      <div className="card auth-card">
        <h1>Joining workspace</h1>
        {error ? <p className="error">{error}</p> : <p className="muted">Applying invitation…</p>}
      </div>
    </div>
  );
}
