export const PLAYBACK_PROGRESS_STORAGE_KEY = 'mytube_playback_progress_v1';
export const MINIMUM_RESUME_SECONDS = 5;
export const COMPLETION_MARGIN_SECONDS = 15;

type PlaybackProgressRecord = {
  position: number;
  updatedAt: number;
};

type PlaybackProgressRecords = Record<string, PlaybackProgressRecord>;
type LocalStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type PlaybackProgressKey = string | number;

function defaultStorage(): LocalStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function readRecords(storage: LocalStorage | undefined): PlaybackProgressRecords {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(
      storage.getItem(PLAYBACK_PROGRESS_STORAGE_KEY) ?? '{}',
    );
    return parsed && typeof parsed === 'object'
      ? parsed as PlaybackProgressRecords
      : {};
  } catch {
    return {};
  }
}

function writeRecords(
  records: PlaybackProgressRecords,
  storage: LocalStorage | undefined,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PLAYBACK_PROGRESS_STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

export function isResumablePosition(
  position: number | null | undefined,
  duration?: number,
): position is number {
  if (
    typeof position !== 'number'
    || !Number.isFinite(position)
    || position < MINIMUM_RESUME_SECONDS
  ) {
    return false;
  }
  if (!Number.isFinite(duration) || !duration || duration <= 0) return true;
  return position < duration && duration - position > COMPLETION_MARGIN_SECONDS;
}

export function getPlaybackProgress(
  videoKey: PlaybackProgressKey,
  duration?: number,
  storage: LocalStorage | undefined = defaultStorage(),
): number | null {
  const records = readRecords(storage);
  const key = String(videoKey);
  const position = records[key]?.position;
  if (isResumablePosition(position, duration)) return position;
  if (records[key]) {
    delete records[key];
    writeRecords(records, storage);
  }
  return null;
}

export function savePlaybackProgress(
  videoKey: PlaybackProgressKey,
  position: number,
  duration?: number,
  storage: LocalStorage | undefined = defaultStorage(),
): boolean {
  if (!isResumablePosition(position, duration)) {
    clearPlaybackProgress(videoKey, storage);
    return false;
  }
  const records = readRecords(storage);
  records[String(videoKey)] = { position, updatedAt: Date.now() };

  const newest = Object.entries(records)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, 200);
  return writeRecords(Object.fromEntries(newest), storage);
}

export function clearPlaybackProgress(
  videoKey: PlaybackProgressKey,
  storage: LocalStorage | undefined = defaultStorage(),
): void {
  const records = readRecords(storage);
  const key = String(videoKey);
  if (!records[key]) return;
  delete records[key];
  writeRecords(records, storage);
}
