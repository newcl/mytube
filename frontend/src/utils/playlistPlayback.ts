export interface PlaylistPlaybackState {
  position: number;
  total: number;
  previousIndex: number | null;
  nextIndex: number | null;
}

export function getPlaylistPlaybackState<T>(
  items: T[],
  currentIndex: number | null,
  isPlayable: (item: T) => boolean,
): PlaylistPlaybackState | null {
  if (currentIndex === null || currentIndex < 0 || currentIndex >= items.length) return null;

  const playableIndices = items.flatMap((item, index) => isPlayable(item) ? [index] : []);
  const playablePosition = playableIndices.indexOf(currentIndex);
  if (playablePosition === -1) return null;

  return {
    position: playablePosition + 1,
    total: playableIndices.length,
    previousIndex: playablePosition > 0 ? playableIndices[playablePosition - 1] : null,
    nextIndex: playablePosition < playableIndices.length - 1 ? playableIndices[playablePosition + 1] : null,
  };
}
