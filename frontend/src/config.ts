export const DEFAULT_API_BASE = 'https://mytubeapi.elladali.com';

const LEGACY_API_BASES = new Set([
  'https://api.mytube.elladali.com',
  'https://mytube.elladali.com',
]);

function normalizeApiBase(apiBase: string): string {
  const normalized = apiBase.trim().replace(/\/+$/, '');
  return LEGACY_API_BASES.has(normalized) ? DEFAULT_API_BASE : normalized;
}

// API base URL — local settings take precedence over the build-time value.
// Legacy production URLs are migrated automatically on first load.
export function getApiBase(): string {
  const stored = localStorage.getItem('mytube_api_base');
  const resolved = normalizeApiBase(
    stored ||
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    DEFAULT_API_BASE,
  );

  if (stored !== null && stored !== resolved) {
    localStorage.setItem('mytube_api_base', resolved);
  }

  return resolved;
}

export function getToken(): string {
  return localStorage.getItem('mytube_token') || '';
}

export function saveSettings(apiBase: string, token: string): void {
  localStorage.setItem('mytube_api_base', normalizeApiBase(apiBase));
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
