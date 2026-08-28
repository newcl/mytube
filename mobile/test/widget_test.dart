import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mytube_mobile/main.dart';
import 'package:mytube_mobile/playlist.dart';

class FakeApiService extends ApiService {
  FakeApiService({required super.token, this.error, this.jobs = const []})
    : super(baseUrl: 'https://example.test');

  final Object? error;
  final List<Job> jobs;
  final List<String> createdUrls = [];
  int calls = 0;

  @override
  Future<List<Job>> listJobs() async {
    calls++;
    if (error != null) throw error!;
    return jobs;
  }

  @override
  Future<int> createJob(String url) async {
    createdUrls.add(url);
    return 574;
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

  testWidgets('failed jobs keep source actions available', (tester) async {
    final api = FakeApiService(
      token: 'mt_device_valid',
      jobs: [
        Job(
          id: 573,
          url: 'https://youtube.com/watch?v=VMp5gOjN-w8',
          status: 'failed',
          title: 'Failed video',
          uploader: '',
          thumbnailUrl: '',
          error: 'HTTP Error 403: Forbidden',
          createdAt: '2026-08-26T05:13:03Z',
        ),
      ],
    );
    final playlist = PlaylistController();

    await tester.pumpWidget(
      MaterialApp(
        home: JobsPage(api: api, playlist: playlist),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Open source'), findsOneWidget);
    expect(find.text('Copy URL'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    expect(find.text('HTTP Error 403: Forbidden'), findsOneWidget);

    await tester.tap(find.text('Copy URL'));
    await tester.pump();
    expect(find.text('Source URL copied'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(api.createdUrls, ['https://youtube.com/watch?v=VMp5gOjN-w8']);
    expect(find.text('Retry queued as job #574'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    playlist.dispose();
  });

  testWidgets('active jobs keep source actions without offering retry', (
    tester,
  ) async {
    final api = FakeApiService(
      token: 'mt_device_valid',
      jobs: [
        Job(
          id: 575,
          url: 'https://youtube.com/watch?v=active',
          status: 'downloading',
          title: 'Downloading video',
          uploader: '',
          thumbnailUrl: '',
          error: '',
          progress: JobProgress(percent: 42, speed: '1 MiB/s', eta: '00:30'),
          createdAt: '2026-08-28T00:00:00Z',
        ),
      ],
    );
    final playlist = PlaylistController();

    await tester.pumpWidget(
      MaterialApp(
        home: JobsPage(api: api, playlist: playlist),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Open source'), findsOneWidget);
    expect(find.text('Copy URL'), findsOneWidget);
    expect(find.text('Retry'), findsNothing);
    expect(find.textContaining('42.0%'), findsOneWidget);
    expect(find.byType(Dismissible), findsNothing);

    await tester.pumpWidget(const SizedBox.shrink());
    playlist.dispose();
  });
}
