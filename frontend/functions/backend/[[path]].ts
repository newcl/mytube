interface Env {
  MYTUBE_ADMIN_TOKEN?: string;
}

const upstreamOrigin = 'https://mytubeapi.elladali.com';
const allowedPrefixes = [
  '/api/jobs',
  '/api/subtitles',
  '/api/telemetry/events',
  '/api/auth/pairings',
  '/api/auth/devices',
  '/files/',
];

function isAllowedPath(path: string): boolean {
  if (path === '/api/auth/pairings/exchange') return false;
  return allowedPrefixes.some((prefix) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
}

function proxiedPath(value: string | string[] | undefined): string {
  const segments = (Array.isArray(value) ? value : value ? value.split('/') : [])
    .filter((segment) => segment.length > 0);
  return `/${segments.map(encodeURIComponent).join('/')}`;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (!context.env.MYTUBE_ADMIN_TOKEN) {
    return new Response('Backend proxy is not configured', { status: 503 });
  }

  const method = context.request.method.toUpperCase();
  if (!['GET', 'HEAD', 'POST', 'DELETE'].includes(method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, POST, DELETE' } });
  }

  const incoming = new URL(context.request.url);
  const path = proxiedPath(context.params.path);
  if (!isAllowedPath(path)) return new Response('Not found', { status: 404 });

  if (method !== 'GET' && method !== 'HEAD') {
    const origin = context.request.headers.get('Origin');
    if (origin !== incoming.origin) return new Response('Invalid request origin', { status: 403 });
  }

  const upstream = new URL(path, upstreamOrigin);
  incoming.searchParams.forEach((value, key) => {
    if (key.toLowerCase() !== 'token') upstream.searchParams.append(key, value);
  });

  const headers = new Headers();
  for (const name of ['Accept', 'Content-Type', 'Range', 'If-Range']) {
    const value = context.request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Authorization', `Bearer ${context.env.MYTUBE_ADMIN_TOKEN}`);

  const response = await fetch(upstream, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : context.request.body,
    redirect: 'manual',
  });
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('Set-Cookie');
  if (path.startsWith('/api/auth/')) responseHeaders.set('Cache-Control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};
