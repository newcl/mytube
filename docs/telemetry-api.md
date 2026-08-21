# Mytube telemetry API contract

Status: schema version 1 implemented in the backend on 2026-08-21.

Clients send authenticated batches to `POST /api/telemetry/events` using the
same API bearer token as other Mytube API requests. This endpoint is for
low-volume product events, not logs or media metadata.

```json
{
  "schema_version": 1,
  "events": [
    {
      "id": "evt_01J123456789ABCDE",
      "session_id": "ses_01J123456789ABCDE",
      "name": "video_started",
      "occurred_at": "2026-08-21T22:30:00Z",
      "properties": {
        "client": "web",
        "app_version": "1.4.0",
        "playback_mode": "standalone",
        "retry_count": 0,
        "elapsed_seconds": 0,
        "outcome_code": "initial"
      }
    }
  ]
}
```

The response reports durable inserts and event-ID duplicates:

```json
{"accepted":1,"duplicates":0}
```

## Validation

- `schema_version` must be `1`.
- A batch contains 1–50 events and its encoded body is at most 64 KiB.
- `id` is required and `session_id` is optional. Both use 16–64 characters
  from `A-Z`, `a-z`, `0-9`, `_`, and `-`.
- `occurred_at` is RFC 3339, at most 30 days old, and no more than five minutes
  in the future.
- `client` is `web` or `ios`; `app_version` is required.
- `playback_mode`, when present, is `standalone` or `playlist`.
- `retry_count` is 0–100 and `elapsed_seconds` is 0–86400.
- Unknown root, event, and property fields are rejected. This deliberately
  rejects URLs, titles, video/job IDs, email addresses, tokens, error text, and
  device identifiers.

Allowed event names are:

- `app_opened`
- `video_started`
- `video_completed`
- `playback_failed`
- `playback_recovered`
- `playback_started_over`
- `playlist_started`
- `playlist_item_completed`
- `playlist_item_skipped`
- `playlist_completed`
- `download_submitted`
- `download_failed`

Clients should keep the same event ID across retries. HTTP `200` means the
entire validated batch was processed; duplicates are successful delivery.
Retry transient network errors, `429`, and `5xx` responses with bounded
exponential backoff. Do not retry other `4xx` responses.

Raw events live in the separate `analytics.sqlite` database for 90 days.
Daily counts by event name and client are retained independently. Analytics
storage failure returns `503` from this endpoint but does not stop the main API,
playback, or downloads.
