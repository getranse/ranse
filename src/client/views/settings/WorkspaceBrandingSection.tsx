import { useEffect, useState } from 'react';
import { API } from '../../api';

export function WorkspaceBrandingSection({ onSaved }: { onSaved: (msg?: string) => void }) {
  const [fromName, setFromName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');

  useEffect(() => {
    API.workspaceSettings().then((w) => {
      setWorkspaceName(w.workspace_name ?? '');
      setFromName(w.from_name ?? '');
      setLogoUrl(w.logo_url ?? '');
    });
  }, []);

  return (
    <>
      <h2>Workspace branding</h2>
      <div className="card">
        <p className="muted" style={{ marginBottom: 8 }}>
          From-header display name on outbound replies. The logo is uploaded to your R2 bucket —
          handy for BIMI/Gravatar setup so it appears in Gmail's sender avatar (the email body
          itself stays clean, no inline header).
        </p>
        <div className="field">
          <label>From name</label>
          <input
            type="text"
            value={fromName}
            placeholder={workspaceName || 'Acme Support'}
            onChange={(e) => setFromName(e.target.value)}
            onBlur={async () => {
              await API.setWorkspaceSettings({ from_name: fromName });
              onSaved();
            }}
          />
          {!fromName && workspaceName && (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Falling back to workspace name: <strong>{workspaceName}</strong>
            </div>
          )}
        </div>
        <div className="field">
          <label>Logo</label>
          <div className="row">
            <input
              type="url"
              value={logoUrl}
              placeholder="https://example.com/logo.png"
              onChange={(e) => setLogoUrl(e.target.value)}
              onBlur={async () => {
                await API.setWorkspaceSettings({ logo_url: logoUrl });
                onSaved();
              }}
            />
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const { url } = await API.uploadWorkspaceLogo(file);
                setLogoUrl(url);
                onSaved();
                e.target.value = '';
              }}
            />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Paste a URL or upload an image (≤ 2MB, PNG/JPEG/WebP/GIF). Uploads are stored in your R2
            bucket.
          </div>
          {logoUrl && (
            <img
              src={logoUrl}
              alt="Logo preview"
              style={{
                maxHeight: 40,
                maxWidth: 200,
                width: 'auto',
                marginTop: 8,
                alignSelf: 'flex-start',
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}
