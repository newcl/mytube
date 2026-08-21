import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

const minimumResumePosition = Duration(seconds: 5);
const completionMargin = Duration(seconds: 15);

Duration? resumablePosition(Duration position, Duration duration) {
  if (position < minimumResumePosition) return null;
  if (duration <= Duration.zero) return position;
  if (position >= duration || duration - position <= completionMargin) {
    return null;
  }
  return position;
}

class PlaybackProgressStore {
  PlaybackProgressStore({Future<Directory> Function()? documentsDirectory})
    : _documentsDirectory =
          documentsDirectory ?? getApplicationDocumentsDirectory;

  final Future<Directory> Function() _documentsDirectory;
  final Map<String, Duration> _positions = {};
  Future<void> _writeQueue = Future.value();
  Future<void>? _loadOperation;

  Future<File> _storageFile() async {
    final directory = await _documentsDirectory();
    return File('${directory.path}/mytube_playback_progress.json');
  }

  Future<void> load() => _loadOperation ??= _load();

  Future<void> _load() async {
    try {
      final file = await _storageFile();
      if (!await file.exists()) return;
      final decoded = jsonDecode(await file.readAsString());
      if (decoded is! Map) return;
      for (final entry in decoded.entries) {
        final videoKey = entry.key.toString();
        final milliseconds = entry.value;
        if (videoKey.isNotEmpty && milliseconds is int && milliseconds > 0) {
          _positions[videoKey] = Duration(milliseconds: milliseconds);
        }
      }
    } catch (_) {
      _positions.clear();
    }
  }

  Duration? positionFor(String videoKey, Duration duration) {
    final position = _positions[videoKey];
    if (position == null) return null;
    final resumable = resumablePosition(position, duration);
    if (resumable == null) clear(videoKey);
    return resumable;
  }

  bool save(String videoKey, Duration position, Duration duration) {
    final resumable = resumablePosition(position, duration);
    if (resumable == null) {
      clear(videoKey);
      return false;
    }
    _positions[videoKey] = resumable;
    _schedulePersist();
    return true;
  }

  void clear(String videoKey) {
    if (_positions.remove(videoKey) != null) _schedulePersist();
  }

  void _schedulePersist() {
    final payload = jsonEncode({
      for (final entry in _positions.entries)
        entry.key: entry.value.inMilliseconds,
    });
    _writeQueue = _writeQueue.then((_) => _persist(payload));
  }

  Future<void> flush() => _writeQueue;

  Future<void> _persist(String payload) async {
    try {
      final file = await _storageFile();
      await file.writeAsString(payload, flush: true);
    } catch (_) {
      // Playback must keep working when local persistence is unavailable.
    }
  }
}
