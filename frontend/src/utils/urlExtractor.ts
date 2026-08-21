/**
 * Extracts the YouTube video ID from a YouTube URL.
 * Supports both standard YouTube URLs and shortened youtu.be URLs.
 *
 * @param url - The YouTube URL to extract the video ID from
 * @returns The video ID if found, null otherwise
 */
export function extractYouTubeUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    let candidate: string | null = null;
    if (hostname === 'youtu.be' || hostname.endsWith('.youtu.be')) {
      candidate = urlObj.pathname.split('/').filter(Boolean)[0] ?? null;
    } else if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
      candidate = urlObj.searchParams.get('v')?.split('&')[0] ?? null;
    }
    return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate)
      ? candidate
      : null;
  } catch {
    return null;
  }
}
