import { describe, expect, it, vi } from 'vitest';
import { TelemetryClient } from './telemetry';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function createClient(fetchImpl: typeof fetch, now = Date.now()) {
  let sequence = 0;
  const storage = memoryStorage();
  const sessionStorage = memoryStorage();
  const client = new TelemetryClient({
    storage,
    sessionStorage,
    fetch: fetchImpl,
    now: () => now,
    randomID: () => `event_identifier_${++sequence}`,
    apiBase: () => 'https://api.example.test',
    appVersion: () => '1.0.0',
  });
  return { client, storage, sessionStorage };
}

describe('telemetry client', () => {
  it('queues offline and removes an accepted batch exactly once', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const { client } = createClient(fetchImpl);
    client.track('video_started', { playback_mode: 'standalone' });

    await client.flush();
    expect(client.queuedCount()).toBe(1);
    await client.flush(true);
    expect(client.queuedCount()).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('clears queued data when analytics is disabled', () => {
    const { client } = createClient(vi.fn<typeof fetch>());
    client.track('app_opened');
    expect(client.queuedCount()).toBe(1);
    client.setEnabled(false);
    expect(client.queuedCount()).toBe(0);
    client.track('video_started');
    expect(client.queuedCount()).toBe(0);
  });

  it('does not include sensitive properties in the encoded event', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const { client } = createClient(fetchImpl);
    client.track('playback_failed', { outcome_code: 'network' });
    await client.flush();

    const init = fetchImpl.mock.calls[0]?.[1];
    const body = String(init?.body);
    expect(body).toContain('outcome_code');
    expect(body).not.toContain('title');
    expect(body).not.toContain('url');
    expect(init?.headers).not.toHaveProperty('Authorization');
  });

  it('records app opened once per tab session', () => {
    const { client } = createClient(vi.fn<typeof fetch>());
    client.trackOpenedOnce();
    client.trackOpenedOnce();
    expect(client.queuedCount()).toBe(1);
  });
});
