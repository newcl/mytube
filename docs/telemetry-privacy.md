# Mytube telemetry privacy and App Store disclosure

Last reviewed: 2026-08-21

Mytube collects low-volume first-party usage events only when **Share private
usage analytics** is enabled in Settings. The preference is available in both
the web and iOS clients. Disabling it immediately deletes locally queued events
and prevents new collection.

Collected fields are limited to event type, web/iOS client, app version,
playback mode, retry count, elapsed seconds, a bounded outcome code, random
event ID, random per-launch/session ID, and timestamps. Mytube does not include
video/job IDs, URLs, titles, uploader names, search text, API tokens, email
addresses, IP addresses, advertising IDs, or stable device identifiers in the
analytics payload or Prometheus labels.

Events are sent only to the user's configured Mytube backend using existing API
authentication. No analytics data is sent to Google Analytics, Apple analytics,
an advertising network, or another third party. Raw events are retained for 90
days in the separate server-side `analytics.sqlite`; daily aggregate counts are
retained until the owner changes the policy.

## App Store Connect answers

Before distributing an analytics-enabled build, declare:

- Data type: **Usage Data → Product Interaction**.
- Purpose: **Analytics** and **App Functionality**.
- Linked to the user's identity: **No**.
- Used for tracking across companies' apps or websites: **No**.

Do not declare identifiers, contact information, user content, browsing
history, diagnostics, purchases, location, or advertising data for this
implementation. Revisit these answers before each release if the event schema,
server logs, third-party SDKs, or retention policy changes.
