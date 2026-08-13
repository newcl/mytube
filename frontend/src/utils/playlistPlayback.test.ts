import { describe, expect, it } from 'vitest';
import { getPlaylistPlaybackState } from './playlistPlayback';

const entries = [
  { playable: true },
  { playable: false },
  { playable: true },
  { playable: true },
];

describe('playlist playback state', () => {
  it('counts only playable entries and skips unavailable ones', () => {
    expect(getPlaylistPlaybackState(entries, 2, (entry) => entry.playable)).toEqual({
      position: 2,
      total: 3,
      previousIndex: 0,
      nextIndex: 3,
    });
  });

  it('disables previous and next at playlist boundaries', () => {
    expect(getPlaylistPlaybackState(entries, 0, (entry) => entry.playable)?.previousIndex).toBeNull();
    expect(getPlaylistPlaybackState(entries, 3, (entry) => entry.playable)?.nextIndex).toBeNull();
  });

  it('returns no state for an unavailable current entry', () => {
    expect(getPlaylistPlaybackState(entries, 1, (entry) => entry.playable)).toBeNull();
  });
});
