CREATE TABLE analytics_events (
    event_id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    session_id TEXT,
    event_name TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    client TEXT NOT NULL,
    app_version TEXT NOT NULL,
    playback_mode TEXT,
    retry_count INTEGER,
    elapsed_seconds REAL,
    outcome_code TEXT
);

CREATE INDEX analytics_events_received_at_idx
    ON analytics_events(received_at);
CREATE INDEX analytics_events_occurred_at_idx
    ON analytics_events(occurred_at);

CREATE TABLE analytics_daily_rollups (
    day TEXT NOT NULL,
    event_name TEXT NOT NULL,
    client TEXT NOT NULL,
    event_count INTEGER NOT NULL,
    PRIMARY KEY (day, event_name, client)
);
