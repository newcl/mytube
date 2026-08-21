import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mytube_mobile/playlist.dart';

void main() {
  group('playlist playback state', () {
    const entries = [true, false, true, true];

    test('counts playable entries and skips unavailable entries', () {
      final state = getPlaylistPlaybackState(entries, 2, (item) => item);

      expect(state?.position, 2);
      expect(state?.total, 3);
      expect(state?.previousIndex, 0);
      expect(state?.nextIndex, 3);
    });

    test('finds the first playable entry at or after the requested index', () {
      expect(firstPlayableIndex(entries, 1, (item) => item), 2);
      expect(firstPlayableIndex(entries, 4, (item) => item), isNull);
    });
  });

  group('PlaylistController', () {
    late Directory directory;

    setUp(() async {
      directory = await Directory.systemTemp.createTemp(
        'mytube-playlist-test-',
      );
    });

    tearDown(() async {
      await directory.delete(recursive: true);
    });

    PlaylistController controller() =>
        PlaylistController(documentsDirectory: () async => directory);

    test('prevents duplicates and persists order and timer', () async {
      final playlist = controller();
      await playlist.load();

      expect(
        playlist.add(
          jobId: 1,
          url: 'https://youtube.com/watch?v=one',
          title: 'One',
        ),
        isTrue,
      );
      expect(
        playlist.add(
          jobId: 1,
          url: 'https://youtube.com/watch?v=one',
          title: 'Duplicate',
        ),
        isFalse,
      );
      playlist.add(
        jobId: 2,
        url: 'https://youtube.com/watch?v=two',
        title: 'Two',
      );
      playlist.reorder(0, 2);
      playlist.setSessionMinutes(60);
      await playlist.flush();

      final restored = controller();
      await restored.load();
      expect(restored.items.map((item) => item.jobId), [1, 2]);
      expect(restored.sessionMinutes, 60);
    });

    test('edits and removes entries', () async {
      final playlist = controller();
      await playlist.load();
      playlist.add(
        jobId: 1,
        url: 'https://youtube.com/watch?v=one',
        title: 'One',
      );

      expect(
        playlist.updateAt(
          0,
          title: 'Updated',
          url: 'https://youtube.com/watch?v=updated',
          jobId: 3,
        ),
        isTrue,
      );
      expect(playlist.items.single.title, 'Updated');
      expect(playlist.items.single.jobId, 3);

      playlist.removeAt(0);
      expect(playlist.items, isEmpty);
      await playlist.flush();
    });
  });
}
