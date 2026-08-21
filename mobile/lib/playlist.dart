import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

const playlistSessionOptions = [30, 45, 60, 90];

class PlaylistItem {
  const PlaylistItem({
    required this.id,
    required this.url,
    required this.title,
    this.jobId,
  });

  final String id;
  final int? jobId;
  final String url;
  final String title;

  PlaylistItem copyWith({String? url, String? title, int? jobId}) {
    return PlaylistItem(
      id: id,
      jobId: jobId ?? this.jobId,
      url: url ?? this.url,
      title: title ?? this.title,
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'job_id': jobId,
    'url': url,
    'title': title,
  };

  factory PlaylistItem.fromJson(Map<String, dynamic> json) {
    return PlaylistItem(
      id: json['id'] as String,
      jobId: json['job_id'] as int?,
      url: json['url'] as String? ?? '',
      title: json['title'] as String? ?? json['url'] as String? ?? '',
    );
  }
}

class PlaylistPlaybackState {
  const PlaylistPlaybackState({
    required this.position,
    required this.total,
    required this.previousIndex,
    required this.nextIndex,
  });

  final int position;
  final int total;
  final int? previousIndex;
  final int? nextIndex;
}

PlaylistPlaybackState? getPlaylistPlaybackState<T>(
  List<T> items,
  int? currentIndex,
  bool Function(T item) isPlayable,
) {
  if (currentIndex == null ||
      currentIndex < 0 ||
      currentIndex >= items.length) {
    return null;
  }

  final playableIndices = <int>[
    for (var index = 0; index < items.length; index++)
      if (isPlayable(items[index])) index,
  ];
  final playablePosition = playableIndices.indexOf(currentIndex);
  if (playablePosition == -1) return null;

  return PlaylistPlaybackState(
    position: playablePosition + 1,
    total: playableIndices.length,
    previousIndex: playablePosition > 0
        ? playableIndices[playablePosition - 1]
        : null,
    nextIndex: playablePosition < playableIndices.length - 1
        ? playableIndices[playablePosition + 1]
        : null,
  );
}

int? firstPlayableIndex<T>(
  List<T> items,
  int startIndex,
  bool Function(T item) isPlayable,
) {
  for (
    var index = startIndex.clamp(0, items.length).toInt();
    index < items.length;
    index++
  ) {
    if (isPlayable(items[index])) return index;
  }
  return null;
}

class PlaylistController extends ChangeNotifier {
  PlaylistController({Future<Directory> Function()? documentsDirectory})
    : _documentsDirectory =
          documentsDirectory ?? getApplicationDocumentsDirectory;

  final Future<Directory> Function() _documentsDirectory;
  final List<PlaylistItem> _items = [];
  int _sessionMinutes = playlistSessionOptions.first;
  bool _loaded = false;
  Future<void> _writeQueue = Future.value();

  List<PlaylistItem> get items => List.unmodifiable(_items);
  int get sessionMinutes => _sessionMinutes;
  bool get loaded => _loaded;

  Future<File> _storageFile() async {
    final directory = await _documentsDirectory();
    return File('${directory.path}/mytube_playlist.json');
  }

  Future<void> load() async {
    try {
      final file = await _storageFile();
      if (await file.exists()) {
        final decoded = jsonDecode(await file.readAsString());
        if (decoded is Map<String, dynamic>) {
          final rawItems = decoded['items'];
          if (rawItems is List) {
            _items
              ..clear()
              ..addAll(
                rawItems.whereType<Map>().map(
                  (item) =>
                      PlaylistItem.fromJson(Map<String, dynamic>.from(item)),
                ),
              );
          }
          final savedMinutes = decoded['session_minutes'];
          if (savedMinutes is int &&
              playlistSessionOptions.contains(savedMinutes)) {
            _sessionMinutes = savedMinutes;
          }
        }
      }
    } catch (_) {
      // A corrupt or unavailable playlist should not block app startup.
      _items.clear();
      _sessionMinutes = playlistSessionOptions.first;
    }
    _loaded = true;
    notifyListeners();
  }

  bool contains({required int jobId, required String url}) {
    return _items.any((item) => item.jobId == jobId || item.url == url);
  }

  bool add({required int jobId, required String url, required String title}) {
    final trimmedUrl = url.trim();
    if (trimmedUrl.isEmpty || contains(jobId: jobId, url: trimmedUrl)) {
      return false;
    }
    _items.insert(
      0,
      PlaylistItem(
        id: '${DateTime.now().microsecondsSinceEpoch}-$jobId',
        jobId: jobId,
        url: trimmedUrl,
        title: title.trim().isEmpty ? trimmedUrl : title.trim(),
      ),
    );
    _changed();
    return true;
  }

  void setSessionMinutes(int minutes) {
    if (!playlistSessionOptions.contains(minutes) ||
        minutes == _sessionMinutes) {
      return;
    }
    _sessionMinutes = minutes;
    _changed();
  }

  void reorder(int oldIndex, int newIndex) {
    if (oldIndex < 0 || oldIndex >= _items.length) return;
    if (newIndex > oldIndex) newIndex--;
    if (newIndex < 0 || newIndex >= _items.length || oldIndex == newIndex) {
      return;
    }
    final item = _items.removeAt(oldIndex);
    _items.insert(newIndex, item);
    _changed();
  }

  bool updateAt(
    int index, {
    required String title,
    required String url,
    int? jobId,
  }) {
    if (index < 0 || index >= _items.length) return false;
    final trimmedUrl = url.trim();
    if (trimmedUrl.isEmpty ||
        _items.indexed.any(
          (entry) => entry.$1 != index && entry.$2.url == trimmedUrl,
        )) {
      return false;
    }
    _items[index] = PlaylistItem(
      id: _items[index].id,
      jobId: jobId,
      title: title.trim().isEmpty ? trimmedUrl : title.trim(),
      url: trimmedUrl,
    );
    _changed();
    return true;
  }

  void removeAt(int index) {
    if (index < 0 || index >= _items.length) return;
    _items.removeAt(index);
    _changed();
  }

  void clear() {
    if (_items.isEmpty) return;
    _items.clear();
    _changed();
  }

  void _changed() {
    notifyListeners();
    final payload = jsonEncode({
      'session_minutes': _sessionMinutes,
      'items': _items.map((item) => item.toJson()).toList(),
    });
    _writeQueue = _writeQueue.then((_) => _persist(payload));
  }

  Future<void> flush() => _writeQueue;

  Future<void> _persist(String payload) async {
    try {
      final file = await _storageFile();
      await file.writeAsString(payload, flush: true);
    } catch (_) {
      // Keep the in-memory playlist usable if persistence is unavailable.
    }
  }
}
