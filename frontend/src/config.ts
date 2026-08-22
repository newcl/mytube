export const DEFAULT_API_BASE = '/backend';
export const MOBILE_API_BASE = 'https://mytubeapi.elladali.com';

// Production API traffic stays same-origin. The Cloudflare Pages Function
// validates the Access session and injects the server-side credential.
export function getApiBase(): string {
  localStorage.removeItem('mytube_token');
  localStorage.removeItem('mytube_api_base');
  if (import.meta.env.DEV) {
    return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || DEFAULT_API_BASE;
  }
  return DEFAULT_API_BASE;
}

export function authHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' };
}

/** Same-origin URLs are authenticated by the Cloudflare Access session. */
export function fileUrl(jobId: number): string {
  return `${getApiBase()}/files/${jobId}`;
}

/** Build a file URL that forces browser download (no fetch/CORS needed). */
// NOTE: kept for reference but superseded by the blob download approach in the UI.
export function fileDownloadUrl(jobId: number): string {
  return `${getApiBase()}/files/${jobId}?download=1`;
}

/** Build a file URL that wraps video into zip for iOS download behavior. */
export function fileZipDownloadUrl(jobId: number): string {
  return `${getApiBase()}/files/${jobId}?zip=1`;
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
