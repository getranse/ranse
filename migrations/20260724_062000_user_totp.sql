-- TOTP two-factor auth. The secret is stored on enrollment but 2FA only
-- enforces at login once the user has confirmed a valid code (totp_enabled).
ALTER TABLE user ADD COLUMN totp_secret TEXT;
ALTER TABLE user ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
