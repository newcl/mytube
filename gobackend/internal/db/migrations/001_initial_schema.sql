-- 001_initial_schema.sql
CREATE TABLE IF NOT EXISTS jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    url             TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'queued',
    created_at      DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at      DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

    -- metadata (filled after download)
    title           TEXT,
    uploader        TEXT,
    thumbnail_url   TEXT,
    extractor       TEXT,
    webpage_url     TEXT,
    output_path     TEXT,
    error_msg       TEXT,

    -- progress (JSON blob)
    progress_json   TEXT,

    -- capped log tail (last ~32 KB)
    log_tail        TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
