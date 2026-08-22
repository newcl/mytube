import { getApiBase, getAppVersion } from './config';

export const TELEMETRY_ENABLED_KEY = 'mytube_analytics_enabled';
const QUEUE_KEY = 'mytube_telemetry_queue_v1';
const SESSION_KEY = 'mytube_telemetry_session_v1';
const OPENED_KEY = 'mytube_telemetry_opened_v1';
const MAX_QUEUE_SIZE = 500;
const MAX_BATCH_SIZE = 50;
const MAX_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type TelemetryEventName =
  | 'app_opened'
  | 'video_started'
  | 'video_completed'
  | 'playback_failed'
  | 'playback_recovered'
  | 'playback_started_over'
  | 'playlist_started'
  | 'playlist_item_completed'
  | 'playlist_item_skipped'
  | 'playlist_completed'
  | 'download_submitted'
  | 'download_failed';

export interface TelemetryProperties {
  playback_mode?: 'standalone' | 'playlist';
  retry_count?: number;
  elapsed_seconds?: number;
  outcome_code?: string;
}

interface QueuedEvent {
  id: string;
  session_id: string;
  name: TelemetryEventName;
  occurred_at: string;
  properties: TelemetryProperties & {
    client: 'web';
    app_version: string;
  };
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface TelemetryDependencies {
  storage: StorageLike;
  sessionStorage: StorageLike;
  fetch: typeof fetch;
  now: () => number;
  randomID: () => string;
  apiBase: () => string;
  appVersion: () => string;
}

function browserDependencies(): TelemetryDependencies {
  return {
    storage: {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
    },
    sessionStorage: {
      getItem: (key) => window.sessionStorage.getItem(key),
      setItem: (key, value) => window.sessionStorage.setItem(key, value),
      removeItem: (key) => window.sessionStorage.removeItem(key),
    },
    fetch: (input, init) => window.fetch(input, init),
    now: () => Date.now(),
    randomID: () => crypto.randomUUID(),
    apiBase: getApiBase,
    appVersion: getAppVersion,
  };
}

export class TelemetryClient {
  private readonly dependencies: TelemetryDependencies;
  private flushing = false;
  private failures = 0;
  private nextAttemptAt = 0;

  constructor(dependencies: TelemetryDependencies) {
    this.dependencies = dependencies;
  }

  isEnabled(): boolean {
    return this.dependencies.storage.getItem(TELEMETRY_ENABLED_KEY) !== 'false';
  }

  setEnabled(enabled: boolean): void {
    this.dependencies.storage.setItem(TELEMETRY_ENABLED_KEY, String(enabled));
    if (!enabled) {
      this.dependencies.storage.removeItem(QUEUE_KEY);
    }
  }

  track(name: TelemetryEventName, properties: TelemetryProperties = {}): void {
    if (!this.isEnabled()) return;
    const now = this.dependencies.now();
    const queue = this.readQueue(now);
    queue.push({
      id: this.dependencies.randomID(),
      session_id: this.sessionID(),
      name,
      occurred_at: new Date(now).toISOString(),
      properties: {
        client: 'web',
        app_version: this.dependencies.appVersion(),
        ...properties,
      },
    });
    this.writeQueue(queue.slice(-MAX_QUEUE_SIZE));
    if (queue.length >= 10) void this.flush();
  }

  trackOpenedOnce(): void {
    if (!this.isEnabled() || this.dependencies.sessionStorage.getItem(OPENED_KEY)) return;
    this.dependencies.sessionStorage.setItem(OPENED_KEY, 'true');
    this.track('app_opened');
  }

  async flush(keepalive = false): Promise<void> {
    if (this.flushing || !this.isEnabled()) return;
    const now = this.dependencies.now();
    if (!keepalive && now < this.nextAttemptAt) return;
    const queue = this.readQueue(now);
    if (queue.length === 0) return;

    const batch = queue.slice(0, MAX_BATCH_SIZE);
    this.flushing = true;
    try {
      const response = await this.dependencies.fetch(`${this.dependencies.apiBase()}/api/telemetry/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema_version: 1, events: batch }),
        keepalive,
      });
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403 && response.status !== 429)) {
        const delivered = new Set(batch.map((event) => event.id));
        this.writeQueue(this.readQueue(this.dependencies.now()).filter((event) => !delivered.has(event.id)));
      }
      if (response.ok) {
        this.failures = 0;
        this.nextAttemptAt = 0;
      } else {
        this.scheduleRetry();
      }
    } catch {
      this.scheduleRetry();
    } finally {
      this.flushing = false;
    }
  }

  queuedCount(): number {
    return this.readQueue(this.dependencies.now()).length;
  }

  private scheduleRetry(): void {
    this.failures = Math.min(this.failures + 1, 6);
    this.nextAttemptAt = this.dependencies.now() + Math.min(60_000, 1000 * (2 ** this.failures));
  }

  private sessionID(): string {
    const existing = this.dependencies.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = this.dependencies.randomID();
    this.dependencies.sessionStorage.setItem(SESSION_KEY, created);
    return created;
  }

  private readQueue(now: number): QueuedEvent[] {
    try {
      const parsed = JSON.parse(this.dependencies.storage.getItem(QUEUE_KEY) ?? '[]') as QueuedEvent[];
      if (!Array.isArray(parsed)) return [];
      const cutoff = now - MAX_EVENT_AGE_MS;
      return parsed.filter((event) =>
        typeof event?.id === 'string'
        && typeof event?.occurred_at === 'string'
        && Date.parse(event.occurred_at) >= cutoff,
      ).slice(-MAX_QUEUE_SIZE);
    } catch {
      return [];
    }
  }

  private writeQueue(queue: QueuedEvent[]): void {
    try {
      if (queue.length === 0) {
        this.dependencies.storage.removeItem(QUEUE_KEY);
      } else {
        this.dependencies.storage.setItem(QUEUE_KEY, JSON.stringify(queue));
      }
    } catch {
      // Telemetry must never affect playback or downloads.
    }
  }
}

export const telemetry = new TelemetryClient(browserDependencies());

export function startTelemetry(): () => void {
  telemetry.trackOpenedOnce();
  void telemetry.flush();
  const timer = window.setInterval(() => void telemetry.flush(), 10_000);
  const onOnline = () => void telemetry.flush();
  const onPageHide = () => void telemetry.flush(true);
  window.addEventListener('online', onOnline);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('pagehide', onPageHide);
  };
}
