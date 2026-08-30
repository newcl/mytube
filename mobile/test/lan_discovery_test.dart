import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mytube_mobile/lan_discovery.dart';

class FakeLanServiceBrowser implements LanServiceBrowser {
  FakeLanServiceBrowser(this.services);

  final List<LanService> services;

  @override
  Future<List<LanService>> browse({required Duration timeout}) async =>
      services;
}

void main() {
  test('normalizes a Bonjour host into a local endpoint', () {
    const service = LanService(host: 'Liangs-Mac-mini.local.', port: 8083);
    expect(service.baseUrl, 'http://liangs-mac-mini.local:8083');
  });

  test('selects a healthy authenticated MyTube LAN advertisement', () async {
    final selector = LanEndpointSelector(
      browser: FakeLanServiceBrowser(const [
        LanService(host: 'mytube.local.', port: 8083),
      ]),
      client: MockClient((request) async {
        expect(request.url.toString(), 'http://mytube.local:8083/health');
        return http.Response(
          '{"status":"ok"}',
          200,
          headers: const {'x-mytube-lan': '1'},
        );
      }),
    );

    expect(await selector.discover(), 'http://mytube.local:8083');
    selector.close();
  });

  test('ignores an advertisement that fails the MyTube probe', () async {
    final selector = LanEndpointSelector(
      browser: FakeLanServiceBrowser(const [
        LanService(host: 'not-mytube.local.', port: 8083),
      ]),
      client: MockClient((_) async => http.Response('{"status":"ok"}', 200)),
    );

    expect(await selector.discover(), isNull);
    selector.close();
  });

  test('returns null when no LAN service is advertised', () async {
    final selector = LanEndpointSelector(
      browser: FakeLanServiceBrowser(const []),
      client: MockClient((_) async => http.Response('', 500)),
    );

    expect(await selector.discover(), isNull);
    selector.close();
  });
}
