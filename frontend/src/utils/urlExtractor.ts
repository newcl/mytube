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
    // Handle youtu.be URLs
    if (url.includes('youtu.be/')) {
      const videoId = url.split('youtu.be/')[1].split('?')[0];
      return videoId;
    }

    // Handle standard YouTube URLs
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('youtube.com')) {
      const videoId = urlObj.searchParams.get('v');
      return videoId;
    }

    return null;
  } catch (error) {
    console.error('Error extracting YouTube URL:', error);
    return null;
  }
} 