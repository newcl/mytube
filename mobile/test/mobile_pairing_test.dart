import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mytube_mobile/mobile_pairing.dart';

void main() {
  test('parses a trusted Mytube pairing URI', () {
    const code = 'mt_pair_abcdefghijklmnopqrstuvwxyz';
    final payload = MobilePairingPayload.parse(
      'mytube://pair?v=1&api=https%3A%2F%2Fmytubeapi.elladali.com&code=$code',
    );
    expect(payload.apiBase, trustedMytubeApi);
    expect(payload.code, code);
  });

  test('rejects a pairing URI that targets another server', () {
    expect(
      () => MobilePairingPayload.parse(
        'mytube://pair?v=1&api=https%3A%2F%2Fevil.example&code=mt_pair_abcdefghijklmnopqrstuvwxyz',
      ),
      throwsFormatException,
    );
  });

  test('exchanges the one-time code for a device credential', () async {
    final client = MockClient((request) async {
      expect(request.headers['Authorization'], isNull);
      expect(request.url.path, '/api/auth/pairings/exchange');
      return http.Response(
        '{"token":"mt_device_abcdefghijklmnopqrstuvwxyz"}',
        201,
      );
    });
    const pairing = MobilePairingPayload(
      apiBase: trustedMytubeApi,
      code: 'mt_pair_abcdefghijklmnopqrstuvwxyz',
    );
    final credentials = await exchangeMobilePairing(pairing, client: client);
    expect(credentials.token, startsWith('mt_device_'));
  });
}
