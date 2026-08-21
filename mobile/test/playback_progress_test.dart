import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mytube_mobile/playback_progress.dart';

void main() {
  test('only unfinished meaningful positions are resumable', () {
    const duration = Duration(minutes: 10);
    expect(resumablePosition(const Duration(seconds: 4), duration), isNull);
    expect(
      resumablePosition(const Duration(minutes: 3), duration),
      const Duration(minutes: 3),
    );
    expect(
      resumablePosition(const Duration(minutes: 9, seconds: 50), duration),
      isNull,
    );
  });

  test('persists and clears progress locally', () async {
    final directory = await Directory.systemTemp.createTemp(
      'mytube-progress-test-',
    );
    addTearDown(() => directory.delete(recursive: true));

    PlaybackProgressStore store() =>
        PlaybackProgressStore(documentsDirectory: () async => directory);

    final first = store();
    await first.load();
    expect(
      first.save(
        'url:https://youtube.com/watch?v=42',
        const Duration(minutes: 2),
        const Duration(minutes: 10),
      ),
      isTrue,
    );
    await first.flush();

    final restored = store();
    await restored.load();
    expect(
      restored.positionFor(
        'url:https://youtube.com/watch?v=42',
        const Duration(minutes: 10),
      ),
      const Duration(minutes: 2),
    );

    restored.clear('url:https://youtube.com/watch?v=42');
    await restored.flush();
    final cleared = store();
    await cleared.load();
    expect(
      cleared.positionFor(
        'url:https://youtube.com/watch?v=42',
        const Duration(minutes: 10),
      ),
      isNull,
    );
  });
}
