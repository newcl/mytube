CREATE TABLE mobile_pairings (
    id TEXT PRIMARY KEY,
    secret_hash BLOB NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT
);

CREATE INDEX mobile_pairings_expires_at_idx ON mobile_pairings(expires_at);

CREATE TABLE mobile_devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash BLOB NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE INDEX mobile_devices_active_idx ON mobile_devices(revoked_at, last_used_at);
