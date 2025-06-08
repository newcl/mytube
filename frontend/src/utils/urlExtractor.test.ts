import { describe, it, expect } from 'vitest';
import { extractYouTubeUrl } from './urlExtractor';

describe('extractYouTubeUrl', () => {
  it('should extract full YouTube URL with https', () => {
    const input = 'https://lhmswww.com/videos/https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const expected = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    expect(extractYouTubeUrl(input)).toBe(expected);
  });

  it('should extract YouTube URL without https', () => {
    const input = 'https://lhmswww.com/videos/www.youtube.com/watch?v=dQw4w9WgXcQ';
    const expected = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    expect(extractYouTubeUrl(input)).toBe(expected);
  });

  it('should handle just the video ID', () => {
    const input = 'https://lhmswww.com/videos/watch?v=dQw4w9WgXcQ';
    const expected = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    expect(extractYouTubeUrl(input)).toBe(expected);
  });

  it('should handle youtu.be URLs with https', () => {
    const input = 'https://lhmswww.com/videos/https://youtu.be/dQw4w9WgXcQ';
    const expected = 'https://youtu.be/dQw4w9WgXcQ';
    expect(extractYouTubeUrl(input)).toBe(expected);
  });

  it('should handle youtu.be URLs without https', () => {
    const input = 'https://lhmswww.com/videos/youtu.be/dQw4w9WgXcQ';
    const expected = 'https://youtu.be/dQw4w9WgXcQ';
    expect(extractYouTubeUrl(input)).toBe(expected);
  });
}); 