export const extractYouTubeUrl = (inputUrl: string): string => {
  try {
    // If the URL contains another URL after the domain, extract it
    const urlParts = inputUrl.split('/');
    
    // Find the index where the YouTube URL starts
    const youtubeUrlIndex = urlParts.findIndex(part => 
      part.includes('youtube.com') || 
      part.includes('youtu.be') ||
      part.includes('watch?v=')
    );
    
    if (youtubeUrlIndex !== -1) {
      // Reconstruct the YouTube URL
      const extractedUrl = urlParts.slice(youtubeUrlIndex).join('/');
      
      // If it's just a video ID, construct a proper YouTube URL
      if (extractedUrl.startsWith('watch?v=')) {
        return `https://www.youtube.com/${extractedUrl}`;
      }
      
      // Ensure the URL starts with http:// or https://
      if (!extractedUrl.startsWith('http')) {
        return `https://${extractedUrl}`;
      }
      return extractedUrl;
    }
    
    // If no YouTube URL found, try to find a URL pattern
    const urlPattern = /(https?:\/\/[^\s]+)/;
    const match = inputUrl.match(urlPattern);
    if (match) {
      return match[1];
    }
    
    return inputUrl;
  } catch (error) {
    console.error('Error extracting YouTube URL:', error);
    return inputUrl;
  }
}; 