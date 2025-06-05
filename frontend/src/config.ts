// Use Vite's environment variables (prefixed with VITE_)
// API convention: No trailing slashes in URLs (e.g., /api/videos, /api/videos/123)
const baseUrl = new URL(import.meta.env.VITE_BACKEND_URL || 'http://192.168.1.50:8000');
baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, ''); // Remove any trailing slashes from path

export const BACKEND_URL = baseUrl.toString().replace(/\/+$/, ''); // Ensure no trailing slash

// For development, you can set this in a .env file:
// VITE_BACKEND_URL=http://192.168.1.50:8000