import { extractYouTubeUrl } from '../urlExtractor';

describe('URL Extractor', () => {
  describe('Valid YouTube URLs', () => {
    test('should extract video ID from standard YouTube URL', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      expect(extractYouTubeUrl(url)).toBe('dQw4w9WgXcQ');
    });

    test('should extract video ID from shortened YouTube URL', () => {
      const url = 'https://youtu.be/dQw4w9WgXcQ';
      expect(extractYouTubeUrl(url)).toBe('dQw4w9WgXcQ');
    });

    test('should extract video ID from URL with additional parameters', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123s&feature=share';
      expect(extractYouTubeUrl(url)).toBe('dQw4w9WgXcQ');
    });

    test('should extract video ID from URL with www prefix', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      expect(extractYouTubeUrl(url)).toBe('dQw4w9WgXcQ');
    });

    test('should extract video ID from URL without www prefix', () => {
      const url = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
      expect(extractYouTubeUrl(url)).toBe('dQw4w9WgXcQ');
    });
  });

  describe('Invalid YouTube URLs', () => {
    test('should return null for non-YouTube URLs', () => {
      const url = 'https://www.example.com/video/123';
      expect(extractYouTubeUrl(url)).toBeNull();
    });

    test('should return null for malformed YouTube URLs', () => {
      const url = 'https://youtube.com/watch';
      expect(extractYouTubeUrl(url)).toBeNull();
    });

    test('should return null for empty string', () => {
      expect(extractYouTubeUrl('')).toBeNull();
    });

    test('should return null for null input', () => {
      expect(extractYouTubeUrl(null)).toBeNull();
    });

    test('should return null for undefined input', () => {
      expect(extractYouTubeUrl(undefined)).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    test('should handle URLs with special characters', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123s&feature=share&utm_source=test';
      expect(extractYouTubeUrl(url)).toBe('dQw4w9WgXcQ');
    });

    test('should handle URLs with multiple v parameters', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=anotherID';
      expect(extractYouTubeUrl(url)).toBe('dQw4w9WgXcQ');
    });

    test('should handle URLs with encoded characters', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ%26t%3D123s';
      expect(extractYouTubeUrl(url)).toBe('dQw4w9WgXcQ');
    });
  });
}); 