// API base URL — can be overridden by VITE_API_BASE_URL at build time
// Falls back to localStorage at runtime for dynamic config via the Settings panel
export function getApiBase(): string {
  return (
    localStorage.getItem('mytube_api_base') ||
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    'https://mytubeapi.elladali.com'
  );
}

const DEFAULT_TOKEN = 'a86ff4614dc198cdaaa004e344e2ea3656a88fbd07959ead78e7c496f426cfc4';

export function getToken(): string {
  return localStorage.getItem('mytube_token') || DEFAULT_TOKEN;
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

/** Build a file URL that forces browser download (no fetch/CORS needed). */
// NOTE: kept for reference but superseded by the blob download approach in the UI.
export function fileDownloadUrl(jobId: number): string {
  return `${getApiBase()}/files/${jobId}?token=${encodeURIComponent(getToken())}&download=1`;
}

/** Build a file URL that wraps video into zip for iOS download behavior. */
export function fileZipDownloadUrl(jobId: number): string {
  return `${getApiBase()}/files/${jobId}?token=${encodeURIComponent(getToken())}&zip=1`;
}
