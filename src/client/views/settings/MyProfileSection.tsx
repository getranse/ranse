import { useEffect, useState } from 'react';
import { API } from '../../api';

export function MyProfileSection({ onSaved }: { onSaved: (msg?: string) => void }) {
  const [profile, setProfile] = useState({
    name: '',
    email: '',
    signature_markdown: '',
    avatar_url: '',
  });

  useEffect(() => {
    API.myProfile().then((me) =>
      setProfile({
        name: me.name ?? '',
        email: me.email ?? '',
        signature_markdown: me.signature_markdown ?? '',
        avatar_url: me.avatar_url ?? '',
      }),
    );
  }, []);

  return (
    <>
      <h2>My profile</h2>
      <div className="card">
        <p className="muted" style={{ marginBottom: 8 }}>
          Shown on replies you send manually. Display name appears in the From header (e.g. "Sarah ·
          Acme Support"); signature is appended to the HTML body.
        </p>
        <div className="field">
          <label>Display name</label>
          <input
            type="text"
            value={profile.name}
            placeholder="Sarah"
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            onBlur={async () => {
              await API.setMyProfile({ name: profile.name });
              onSaved();
            }}
          />
        </div>
        <div className="field">
          <label>
            Avatar{' '}
            <span className="muted" style={{ fontSize: 12 }}>
              (falls back to Gravatar from {profile.email || 'your email'})
            </span>
          </label>
          <div className="row">
            <input
              type="url"
              value={profile.avatar_url}
              placeholder="https://example.com/avatar.jpg"
              onChange={(e) => setProfile({ ...profile, avatar_url: e.target.value })}
              onBlur={async () => {
                await API.setMyProfile({ avatar_url: profile.avatar_url });
                onSaved();
              }}
            />
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const { url } = await API.uploadAvatar(file);
                setProfile((p) => ({ ...p, avatar_url: url }));
                onSaved();
                e.target.value = '';
              }}
            />
          </div>
          {profile.avatar_url && (
            <img
              src={profile.avatar_url}
              alt="Avatar preview"
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                marginTop: 8,
                objectFit: 'cover',
                alignSelf: 'flex-start',
              }}
            />
          )}
        </div>
        <div className="field">
          <label>Email signature (markdown)</label>
          <textarea
            rows={4}
            value={profile.signature_markdown}
            placeholder={'Sarah Smith\nCustomer Success · Acme\n[acme.com](https://acme.com)'}
            onChange={(e) => setProfile({ ...profile, signature_markdown: e.target.value })}
            onBlur={async () => {
              await API.setMyProfile({ signature_markdown: profile.signature_markdown });
              onSaved();
            }}
          />
        </div>
      </div>
    </>
  );
}
