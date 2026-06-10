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

export function getAppVersion(): string {
  const raw = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__.trim() : '';
  return raw || 'dev';
}

export function getAppVersionShort(): string {
  const version = getAppVersion();
  if (version === 'dev') return 'dev';
  const m = version.match(/^([0-9a-f]{7,40})-(\d{8}T?\d{4}Z)$/i);
  if (m) {
    const stamp = m[2].replace('T', '');
    const yyyy = Number(stamp.slice(0, 4));
    const mm = Number(stamp.slice(4, 6));
    const dd = Number(stamp.slice(6, 8));
    const hh = Number(stamp.slice(8, 10));
    const min = Number(stamp.slice(10, 12));

    const utcDate = new Date(Date.UTC(yyyy, mm - 1, dd, hh, min));
    const local = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).format(utcDate);

    return `${m[1].slice(0, 7)} ${local}`;
  }
  return version;
}
