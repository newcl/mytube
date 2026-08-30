import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mytube_mobile/lan_discovery.dart';
import 'package:nsd/nsd.dart' as nsd;

class FakeLanServiceBrowser implements LanServiceBrowser {
  FakeLanServiceBrowser(this.services);

  final List<LanService> services;

  @override
  Future<List<LanService>> browse({required Duration timeout}) async =>
      services;
}

class SequencedLanServiceBrowser implements LanServiceBrowser {
  SequencedLanServiceBrowser(this.results);

  final List<List<LanService>> results;
  int calls = 0;

  @override
  Future<List<LanService>> browse({required Duration timeout}) async {
    final index = calls < results.length ? calls : results.length - 1;
    calls++;
    return results[index];
  }
}

void main() {
  test('normalizes a Bonjour host into a local endpoint', () {
    const service = LanService(host: 'Liangs-Mac-mini.local.', port: 8083);
    expect(service.baseUrl, 'http://liangs-mac-mini.local:8083');
  });

  test('uses the dedicated Bonjour hostname after IPv4 resolution', () {
    final service = lanServiceFromNsdService(
      const nsd.Service(host: 'mytube-lan.local.', port: 8083),
    );

    expect(service?.baseUrl, 'http://mytube-lan.local:8083');
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

  test('retries Bonjour discovery and selects a later result', () async {
    final browser = SequencedLanServiceBrowser(const [
      [],
      [],
      [LanService(host: 'mytube.local.', port: 8083)],
    ]);
    final selector = LanEndpointSelector(
      browser: browser,
      client: MockClient(
        (_) async => http.Response(
          '{"status":"ok"}',
          200,
          headers: const {'x-mytube-lan': '1'},
        ),
      ),
    );

    expect(
      await selector.discover(attempts: 3, retryBackoff: Duration.zero),
      'http://mytube.local:8083',
    );
    expect(browser.calls, 3);
    selector.close();
  });

  test(
    'directly checks whether a known LAN endpoint remains healthy',
    () async {
      final selector = LanEndpointSelector(
        browser: FakeLanServiceBrowser(const []),
        client: MockClient((request) async {
          expect(request.url.toString(), 'http://mytube.local:8083/health');
          return http.Response(
            '{"status":"ok"}',
            200,
            headers: const {'x-mytube-lan': '1'},
          );
        }),
      );

      expect(await selector.isHealthy('http://mytube.local:8083'), isTrue);
      selector.close();
    },
  );
}
