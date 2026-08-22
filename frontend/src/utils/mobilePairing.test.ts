import { describe, expect, it } from 'vitest';
import { buildMobilePairingUri } from './mobilePairing';

describe('mobile pairing URI', () => {
  it('encodes the API and one-time code', () => {
    const value = buildMobilePairingUri('https://mytubeapi.elladali.com', 'mt_pair_a+b/c');
    const uri = new URL(value);
    expect(uri.protocol).toBe('mytube:');
    expect(uri.host).toBe('pair');
    expect(uri.searchParams.get('v')).toBe('1');
    expect(uri.searchParams.get('api')).toBe('https://mytubeapi.elladali.com');
    expect(uri.searchParams.get('code')).toBe('mt_pair_a+b/c');
  });
});
