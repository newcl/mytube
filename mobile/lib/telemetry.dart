import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

const telemetryEnabledKey = 'mytube_analytics_enabled';
const _queueKey = 'mytube_telemetry_queue_v1';
const _maxQueueSize = 500;
const _maxBatchSize = 50;
const _maxEventAge = Duration(days: 30);

abstract interface class TelemetryStorage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class SecureTelemetryStorage implements TelemetryStorage {
  const SecureTelemetryStorage(this.storage);
  final FlutterSecureStorage storage;

  @override
  Future<String?> read(String key) => storage.read(key: key);
  @override
  Future<void> write(String key, String value) =>
      storage.write(key: key, value: value);
  @override
  Future<void> delete(String key) => storage.delete(key: key);
}

enum TelemetryEventName {
  appOpened('app_opened'),
  videoStarted('video_started'),
  videoCompleted('video_completed'),
  playbackFailed('playback_failed'),
  playbackRecovered('playback_recovered'),
  playbackStartedOver('playback_started_over'),
  playlistStarted('playlist_started'),
  playlistItemCompleted('playlist_item_completed'),
  playlistItemSkipped('playlist_item_skipped'),
  playlistCompleted('playlist_completed'),
  downloadSubmitted('download_submitted'),
  downloadFailed('download_failed');

  const TelemetryEventName(this.wireName);
  final String wireName;
}

class MobileTelemetry with WidgetsBindingObserver {
  MobileTelemetry({
    required this.storage,
    http.Client? client,
    DateTime Function()? now,
    String Function()? randomId,
    bool startBackground = true,
  }) : _client = client ?? http.Client(),
       _now = now ?? DateTime.now,
       _randomId = randomId ?? _secureRandomId,
       _startBackground = startBackground;

  final TelemetryStorage storage;
  final http.Client _client;
  final DateTime Function() _now;
  final String Function() _randomId;
  final bool _startBackground;
  final List<Map<String, Object?>> _queue = [];
  Timer? _timer;
  bool _initialized = false;
  bool _enabled = true;
  bool _flushing = false;
  int _failures = 0;
  DateTime? _nextAttempt;
  String _baseUrl = '';
  String _token = '';
  String _appVersion = '1.0.0';
  late String _sessionId;

  bool get enabled => _enabled;
  int get queuedCount => _queue.length;

  Future<void> initialize({
    required String baseUrl,
    required String token,
    required String appVersion,
  }) async {
    configure(baseUrl: baseUrl, token: token, appVersion: appVersion);
    _sessionId = _randomId();
    try {
      _enabled = await storage.read(telemetryEnabledKey) != 'false';
      final encoded = await storage.read(_queueKey);
      if (encoded != null) {
        final decoded = jsonDecode(encoded);
        if (decoded is List) {
          _queue.addAll(
            decoded.whereType<Map>().map(
              (event) => event.map((key, value) => MapEntry('$key', value)),
            ),
          );
        }
      }
    } catch (_) {
      _queue.clear();
    }
    _removeExpired();
    _initialized = true;
    if (_startBackground) {
      WidgetsBinding.instance.addObserver(this);
      _timer = Timer.periodic(
        const Duration(seconds: 10),
        (_) => unawaited(flush()),
      );
    }
    track(TelemetryEventName.appOpened);
    if (_startBackground) unawaited(flush());
  }

  void configure({
    required String baseUrl,
    required String token,
    String? appVersion,
  }) {
    _baseUrl = baseUrl.replaceFirst(RegExp(r'/+$'), '');
    _token = token;
    if (appVersion != null) _appVersion = appVersion;
  }

  Future<void> setEnabled(bool value) async {
    if (_enabled == value) {
      await storage.write(telemetryEnabledKey, '$value');
      return;
    }
    _enabled = value;
    await storage.write(telemetryEnabledKey, '$value');
    if (!value) {
      _queue.clear();
      await storage.delete(_queueKey);
    } else {
      track(TelemetryEventName.appOpened);
      unawaited(flush(ignoreBackoff: true));
    }
  }

  void track(
    TelemetryEventName name, {
    String? playbackMode,
    int? retryCount,
    num? elapsedSeconds,
    String? outcomeCode,
  }) {
    if (!_initialized || !_enabled) return;
    final properties = <String, Object?>{
      'client': 'ios',
      'app_version': _appVersion,
      'playback_mode': ?playbackMode,
      if (retryCount != null) 'retry_count': retryCount.clamp(0, 100),
      if (elapsedSeconds != null)
        'elapsed_seconds': elapsedSeconds.clamp(0, 86400),
      'outcome_code': ?outcomeCode,
    };
    _queue.add({
      'id': _randomId(),
      'session_id': _sessionId,
      'name': name.wireName,
      'occurred_at': _now().toUtc().toIso8601String(),
      'properties': properties,
    });
    if (_queue.length > _maxQueueSize) {
      _queue.removeRange(0, _queue.length - _maxQueueSize);
    }
    unawaited(_persist());
    if (_queue.length >= 10) unawaited(flush());
  }

  Future<void> flush({bool ignoreBackoff = false}) async {
    if (!_initialized || !_enabled || _flushing || _queue.isEmpty) return;
    if (_token.isEmpty || _baseUrl.isEmpty) return;
    final now = _now();
    if (!ignoreBackoff && _nextAttempt != null && now.isBefore(_nextAttempt!)) {
      return;
    }
    _removeExpired();
    if (_queue.isEmpty) return;
    final batch = _queue.take(_maxBatchSize).toList(growable: false);
    final ids = batch.map((event) => event['id']).toSet();
    _flushing = true;
    try {
      final response = await _client
          .post(
            Uri.parse('$_baseUrl/api/telemetry/events'),
            headers: {
              'Authorization': 'Bearer $_token',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({'schema_version': 1, 'events': batch}),
          )
          .timeout(const Duration(seconds: 10));
      final discard =
          response.statusCode >= 400 &&
          response.statusCode < 500 &&
          response.statusCode != 401 &&
          response.statusCode != 403 &&
          response.statusCode != 429;
      if (response.statusCode >= 200 && response.statusCode < 300 || discard) {
        _queue.removeWhere((event) => ids.contains(event['id']));
        await _persist();
      }
      if (response.statusCode >= 200 && response.statusCode < 300) {
        _failures = 0;
        _nextAttempt = null;
      } else {
        _scheduleRetry();
      }
    } catch (_) {
      _scheduleRetry();
    } finally {
      _flushing = false;
    }
  }

  void _scheduleRetry() {
    _failures = min(_failures + 1, 6);
    _nextAttempt = _now().add(
      Duration(seconds: min(60, pow(2, _failures).toInt())),
    );
  }

  void _removeExpired() {
    final cutoff = _now().subtract(_maxEventAge);
    _queue.removeWhere((event) {
      final timestamp = DateTime.tryParse('${event['occurred_at']}');
      return timestamp == null || timestamp.isBefore(cutoff);
    });
  }

  Future<void> _persist() async {
    try {
      if (_queue.isEmpty) {
        await storage.delete(_queueKey);
      } else {
        await storage.write(_queueKey, jsonEncode(_queue));
      }
    } catch (_) {
      // Analytics must never affect playback or downloads.
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached ||
        state == AppLifecycleState.hidden) {
      unawaited(flush(ignoreBackoff: true));
    } else if (state == AppLifecycleState.resumed) {
      unawaited(flush(ignoreBackoff: true));
    }
  }

  Future<void> dispose() async {
    _timer?.cancel();
    if (_startBackground) WidgetsBinding.instance.removeObserver(this);
    await flush(ignoreBackoff: true);
    _client.close();
  }

  static String _secureRandomId() {
    final random = Random.secure();
    final bytes = List<int>.generate(18, (_) => random.nextInt(256));
    return base64UrlEncode(bytes).replaceAll('=', '');
  }
}
