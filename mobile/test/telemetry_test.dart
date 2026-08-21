import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mytube_mobile/telemetry.dart';

class MemoryTelemetryStorage implements TelemetryStorage {
  final values = <String, String>{};
  @override
  Future<void> delete(String key) async => values.remove(key);
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('queues offline and removes accepted events', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      if (calls == 1) throw http.ClientException('offline');
      return http.Response('{}', 200);
    });
    var sequence = 0;
    final telemetry = MobileTelemetry(
      storage: MemoryTelemetryStorage(),
      client: client,
      randomId: () => 'event_identifier_${++sequence}',
      startBackground: false,
    );
    await telemetry.initialize(
      baseUrl: 'https://api.example.test',
      token: 'token',
      appVersion: '1.0.0',
    );
    await telemetry.flush(ignoreBackoff: true);
    expect(telemetry.queuedCount, 1);
    await telemetry.flush(ignoreBackoff: true);
    expect(telemetry.queuedCount, 0);
    await telemetry.dispose();
  });

  test('disabled analytics clears queued events', () async {
    final telemetry = MobileTelemetry(
      storage: MemoryTelemetryStorage(),
      client: MockClient((_) async => http.Response('{}', 200)),
      startBackground: false,
    );
    await telemetry.initialize(
      baseUrl: 'https://api.example.test',
      token: '',
      appVersion: '1.0.0',
    );
    expect(telemetry.queuedCount, 1);
    await telemetry.setEnabled(false);
    expect(telemetry.queuedCount, 0);
    telemetry.track(TelemetryEventName.videoStarted);
    expect(telemetry.queuedCount, 0);
    await telemetry.dispose();
  });

  test('payload excludes video metadata and token', () async {
    String body = '';
    final telemetry = MobileTelemetry(
      storage: MemoryTelemetryStorage(),
      client: MockClient((request) async {
        body = request.body;
        return http.Response('{}', 200);
      }),
      startBackground: false,
    );
    await telemetry.initialize(
      baseUrl: 'https://api.example.test',
      token: 'secret-token',
      appVersion: '1.0.0',
    );
    telemetry.track(
      TelemetryEventName.playbackFailed,
      playbackMode: 'standalone',
      outcomeCode: 'network',
    );
    await telemetry.flush(ignoreBackoff: true);
    final decoded = jsonDecode(body) as Map<String, dynamic>;
    expect(decoded['schema_version'], 1);
    expect(body, isNot(contains('secret-token')));
    expect(body, isNot(contains('title')));
    expect(body, isNot(contains('url')));
    await telemetry.dispose();
  });
}
