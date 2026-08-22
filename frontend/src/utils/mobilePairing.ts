export function buildMobilePairingUri(apiBase: string, code: string): string {
  const uri = new URL('mytube://pair');
  uri.searchParams.set('v', '1');
  uri.searchParams.set('api', apiBase);
  uri.searchParams.set('code', code);
  return uri.toString();
}
