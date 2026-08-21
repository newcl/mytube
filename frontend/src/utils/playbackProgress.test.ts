import { describe, expect, it } from 'vitest';
import {
  clearPlaybackProgress,
  getPlaybackProgress,
  isResumablePosition,
  savePlaybackProgress,
} from './playbackProgress';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('playback progress', () => {
  it('resumes meaningful unfinished positions only', () => {
    expect(isResumablePosition(4, 600)).toBe(false);
    expect(isResumablePosition(120, 600)).toBe(true);
    expect(isResumablePosition(590, 600)).toBe(false);
  });

  it('persists and clears progress in the provided local storage', () => {
    const storage = memoryStorage();
    const key = 'url:https://youtube.com/watch?v=42';
    expect(savePlaybackProgress(key, 120, 600, storage)).toBe(true);
    expect(getPlaybackProgress(key, 600, storage)).toBe(120);

    clearPlaybackProgress(key, storage);
    expect(getPlaybackProgress(key, 600, storage)).toBeNull();
  });

  it('clears progress when playback reaches the end margin', () => {
    const storage = memoryStorage();
    savePlaybackProgress(42, 120, 600, storage);
    expect(savePlaybackProgress(42, 590, 600, storage)).toBe(false);
    expect(getPlaybackProgress(42, 600, storage)).toBeNull();
  });
});
