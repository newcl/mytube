// API base URL — can be overridden by VITE_API_BASE_URL at build time
// Falls back to localStorage at runtime for dynamic config via the Settings panel
export function getApiBase(): string {
  return (
    localStorage.getItem('mytube_api_base') ||
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    'https://mytubeapi.elladali.com'
  );
}

export function getToken(): string {
  return localStorage.getItem('mytube_token') || '';
}

export function saveSettings(apiBase: string, token: string): void {
  localStorage.setItem('mytube_api_base', apiBase.replace(/\/+$/, ''));
  localStorage.setItem('mytube_token', token);
}

export function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

/** Build a file URL with token query param (for <video src>) */
export function fileUrl(jobId: number): string {
  return `${getApiBase()}/files/${jobId}?token=${encodeURIComponent(getToken())}`;
}
