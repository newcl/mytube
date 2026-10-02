-- Original upload date reported by yt-dlp, normalized as YYYY-MM-DD.
ALTER TABLE jobs ADD COLUMN published_at TEXT;
CREATE INDEX IF NOT EXISTS idx_jobs_published_at ON jobs(published_at DESC);
