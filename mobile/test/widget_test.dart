import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mytube_mobile/main.dart';
import 'package:mytube_mobile/playlist.dart';

class FakeApiService extends ApiService {
  FakeApiService({required super.token, this.error})
    : super(baseUrl: 'https://example.test');

  final Object? error;
  int calls = 0;

  @override
  Future<List<Job>> listJobs() async {
    calls++;
    if (error != null) throw error!;
    return [];
  }
}

void main() {
  test('media URLs never contain bearer credentials', () {
    final api = ApiService(
      baseUrl: 'https://example.test',
      token: 'mt_device_secret',
    );

    expect(api.fileUrl(42), 'https://example.test/files/42');
    expect(api.fileUrl(42), isNot(contains('mt_device_secret')));
    expect(api.mediaHeaders['Authorization'], 'Bearer mt_device_secret');
  });

  testWidgets('library retries when loaded credentials replace bootstrap API', (
    tester,
  ) async {
    final bootstrap = FakeApiService(token: '', error: Exception('HTTP 401'));
    final authenticated = FakeApiService(token: 'mt_device_valid');
    final playlist = PlaylistController();

    await tester.pumpWidget(
      MaterialApp(
        home: JobsPage(api: bootstrap, playlist: playlist),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Server access needs setup'), findsOneWidget);

    await tester.pumpWidget(
      MaterialApp(
        home: JobsPage(api: authenticated, playlist: playlist),
      ),
    );
    await tester.pumpAndSettle();

    expect(authenticated.calls, 1);
    expect(find.text('No downloads yet'), findsOneWidget);
    expect(find.text('Server access needs setup'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    playlist.dispose();
  });
}
