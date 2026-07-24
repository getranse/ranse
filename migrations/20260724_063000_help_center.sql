-- Public help center: operators mark knowledge sources public; /help/:slug
-- serves them read-only. Nothing is public by default.
ALTER TABLE knowledge_source ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
