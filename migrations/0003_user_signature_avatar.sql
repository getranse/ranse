-- Migration number: 0003 	 2026-04-29T07:25:27.010Z

-- Per-agent signature (markdown) and avatar URL, used in outbound email
-- HTML body. user.name already exists and serves as the display name.
ALTER TABLE user ADD COLUMN signature_markdown TEXT;
ALTER TABLE user ADD COLUMN avatar_url TEXT;
