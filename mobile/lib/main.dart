import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:video_player/video_player.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'playlist.dart';

const String kStorageGroupId = 'group.com.mytube.mobile';
const String kKeyServerUrl = 'mytube_server_url';
const String kKeyBearerToken = 'mytube_bearer_token';
const String kDefaultApiUrl = 'https://mytubeapi.elladali.com';
const String kDefaultToken =
    'a86ff4614dc198cdaaa004e344e2ea3656a88fbd07959ead78e7c496f426cfc4';

// ── Models ───────────────────────────────────────────────────────────────────

class JobProgress {
  final double percent;
  final String speed;
  final String eta;
  JobProgress({required this.percent, required this.speed, required this.eta});
  factory JobProgress.fromJson(Map<String, dynamic> j) => JobProgress(
    percent: (j['percent'] as num?)?.toDouble() ?? 0,
    speed: j['speed'] as String? ?? '',
    eta: j['eta'] as String? ?? '',
  );
}

class Job {
  final int id;
  final String url;
  final String status;
  final String title;
  final String uploader;
  final String thumbnailUrl;
  final String error;
  final JobProgress? progress;
  final String createdAt;
  bool get isActive => status == 'queued' || status == 'downloading';
  Job({
    required this.id,
    required this.url,
    required this.status,
    required this.title,
    required this.uploader,
    required this.thumbnailUrl,
    required this.error,
    this.progress,
    required this.createdAt,
  });
  factory Job.fromJson(Map<String, dynamic> j) => Job(
    id: j['id'] as int,
    url: j['url'] as String? ?? '',
    status: j['status'] as String? ?? '',
    title: j['title'] as String? ?? '',
    uploader: j['uploader'] as String? ?? '',
    thumbnailUrl: j['thumbnail_url'] as String? ?? '',
    error: j['error'] as String? ?? '',
    progress: j['progress'] != null
        ? JobProgress.fromJson(j['progress'] as Map<String, dynamic>)
        : null,
    createdAt: j['created_at'] as String? ?? '',
  );
}

// ── API service ───────────────────────────────────────────────────────────────

class ApiService {
  final String baseUrl;
  final String token;
  ApiService({required this.baseUrl, required this.token});
  Map<String, String> get _headers => {
    'Authorization': 'Bearer $token',
    'Content-Type': 'application/json',
  };
  Future<List<Job>> listJobs() async {
    final res = await http
        .get(Uri.parse('$baseUrl/api/jobs?limit=100'), headers: _headers)
        .timeout(const Duration(seconds: 10));
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
    final list = jsonDecode(res.body) as List;
    return list.map((j) => Job.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<int> createJob(String url) async {
    final res = await http
        .post(
          Uri.parse('$baseUrl/api/jobs'),
          headers: _headers,
          body: jsonEncode({'url': url}),
        )
        .timeout(const Duration(seconds: 10));
    if (res.statusCode != 200 && res.statusCode != 201) {
      throw Exception(res.body.trim());
    }
    return (jsonDecode(res.body) as Map<String, dynamic>)['id'] as int;
  }

  Future<void> deleteJob(int id) async {
    final res = await http
        .delete(Uri.parse('$baseUrl/api/jobs/$id'), headers: _headers)
        .timeout(const Duration(seconds: 10));
    if (res.statusCode != 204 && res.statusCode != 200) {
      throw Exception('HTTP ${res.statusCode}');
    }
  }

  String fileUrl(int id) =>
      '$baseUrl/files/$id?token=${Uri.encodeQueryComponent(token)}';
}

// ── Local download manager ────────────────────────────────────────────────────

class LocalDownloadManager {
  LocalDownloadManager({required this.baseUrl, required this.token});
  final String baseUrl;
  final String token;

  Future<Directory> _dir() async {
    final docs = await getApplicationDocumentsDirectory();
    final dir = Directory('${docs.path}/mytube_offline');
    if (!await dir.exists()) await dir.create();
    return dir;
  }

  File _fileFor(Directory dir, int jobId) => File('${dir.path}/$jobId.mp4');

  Future<bool> isDownloaded(int jobId) async {
    try {
      return _fileFor(await _dir(), jobId).existsSync();
    } catch (_) {
      return false;
    }
  }

  Future<File?> getLocalFile(int jobId) async {
    try {
      final f = _fileFor(await _dir(), jobId);
      return f.existsSync() ? f : null;
    } catch (_) {
      return null;
    }
  }

  Future<Set<int>> localJobIds() async {
    try {
      final dir = await _dir();
      final ids = <int>{};
      await for (final entity in dir.list()) {
        final name = entity.path.split('/').last;
        if (name.endsWith('.mp4')) {
          final id = int.tryParse(name.replaceAll('.mp4', ''));
          if (id != null) ids.add(id);
        }
      }
      return ids;
    } catch (_) {
      return {};
    }
  }

  Future<File> download(int jobId, void Function(double) onProgress) async {
    final url =
        '$baseUrl/files/$jobId?token=${Uri.encodeQueryComponent(token)}';
    final dir = await _dir();
    final file = _fileFor(dir, jobId);
    final tmpFile = File('${dir.path}/$jobId.tmp');

    final request = http.Request('GET', Uri.parse(url));
    final response = await request.send().timeout(const Duration(minutes: 30));
    if (response.statusCode != 200) {
      throw Exception('HTTP ${response.statusCode}');
    }

    final total = response.contentLength ?? 0;
    int received = 0;
    final sink = tmpFile.openWrite();
    try {
      await for (final chunk in response.stream) {
        sink.add(chunk);
        received += chunk.length;
        if (total > 0) onProgress(received / total);
      }
    } finally {
      await sink.close();
    }
    await tmpFile.rename(file.path);
    onProgress(1.0);
    return file;
  }

  Future<void> deleteLocalFile(int jobId) async {
    try {
      final f = _fileFor(await _dir(), jobId);
      if (await f.exists()) await f.delete();
    } catch (_) {}
  }
}

// ── App ───────────────────────────────────────────────────────────────────────

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MyTubeApp());
}

class MyTubeApp extends StatelessWidget {
  const MyTubeApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Mytube',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFFF0000),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFFF0000),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      themeMode: ThemeMode.system,
      home: const MainShell(),
    );
  }
}

// ── Main shell ────────────────────────────────────────────────────────────────

class MainShell extends StatefulWidget {
  const MainShell({super.key});
  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;
  ApiService _api = ApiService(baseUrl: kDefaultApiUrl, token: kDefaultToken);
  late final PlaylistController _playlist;
  final _storage = const FlutterSecureStorage(
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock,
      groupId: 'com.mytube.mytubeMobile',
    ),
  );

  @override
  void initState() {
    super.initState();
    _playlist = PlaylistController();
    unawaited(_playlist.load());
    _loadSettings().then((_) => _checkIncomingUrl());
  }

  @override
  void dispose() {
    _playlist.dispose();
    super.dispose();
  }

  Future<void> _loadSettings() async {
    String url = kDefaultApiUrl;
    String token = kDefaultToken;
    try {
      final results = await Future.wait([
        _storage.read(key: kKeyServerUrl),
        _storage.read(key: kKeyBearerToken),
      ]).timeout(const Duration(seconds: 5));
      final storedUrl = results[0];
      final storedToken = results[1];
      if (storedUrl != null &&
          storedUrl.isNotEmpty &&
          storedUrl != 'https://mytube.elladali.com' &&
          storedUrl != 'https://api.mytube.elladali.com') {
        url = storedUrl;
      }
      if (storedToken != null && storedToken.isNotEmpty) {
        token = storedToken;
      }
      // Persist corrected defaults back (best-effort)
      unawaited(_storage.write(key: kKeyServerUrl, value: url));
      unawaited(_storage.write(key: kKeyBearerToken, value: token));
    } catch (_) {
      // Keychain unavailable or timed out — proceed with defaults
    }
    if (!mounted) return;
    setState(() => _api = ApiService(baseUrl: url, token: token));
  }

  Future<void> _checkIncomingUrl() async {
    try {
      const channel = MethodChannel('com.mytube.mobile/share');
      final url = await channel
          .invokeMethod<String>('getPendingUrl')
          .timeout(const Duration(seconds: 3));
      if (url != null && url.isNotEmpty && mounted) {
        await channel.invokeMethod('clearPendingUrl');
        try {
          await _api.createJob(url);
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Added to queue: $url'),
                backgroundColor: Colors.green,
              ),
            );
            setState(() => _index = 0);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      JobsPage(api: _api, playlist: _playlist),
      PlaylistPage(api: _api, playlist: _playlist),
      SubmitPage(api: _api),
      SettingsPage(storage: _storage, onSaved: _loadSettings),
    ];
    return Scaffold(
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.video_library_outlined),
            selectedIcon: Icon(Icons.video_library),
            label: 'Library',
          ),
          NavigationDestination(
            icon: Icon(Icons.queue_music_outlined),
            selectedIcon: Icon(Icons.queue_music),
            label: 'Playlist',
          ),
          NavigationDestination(
            icon: Icon(Icons.add_circle_outline),
            selectedIcon: Icon(Icons.add_circle),
            label: 'Submit',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}

// ── Jobs page ─────────────────────────────────────────────────────────────────

class JobsPage extends StatefulWidget {
  final ApiService api;
  final PlaylistController playlist;
  const JobsPage({super.key, required this.api, required this.playlist});
  @override
  State<JobsPage> createState() => _JobsPageState();
}

class _JobsPageState extends State<JobsPage> with WidgetsBindingObserver {
  List<Job> _jobs = [];
  bool _loading = true;
  String? _error;
  Timer? _pollTimer;

  // Bulk-select state
  bool _selectMode = false;
  final Set<int> _selected = {};

  // Local offline downloads
  final Set<int> _locallyDownloaded = {};
  final Map<int, double> _downloading = {};
  LocalDownloadManager get _dlManager => LocalDownloadManager(
    baseUrl: widget.api.baseUrl,
    token: widget.api.token,
  );

  void _enterSelectMode(int id) {
    setState(() {
      _selectMode = true;
      _selected.add(id);
    });
  }

  void _exitSelectMode() {
    setState(() {
      _selectMode = false;
      _selected.clear();
    });
  }

  void _toggleSelect(int id) {
    setState(() {
      if (_selected.contains(id)) {
        _selected.remove(id);
        if (_selected.isEmpty) _selectMode = false;
      } else {
        _selected.add(id);
      }
    });
  }

  Future<void> _deleteSelected() async {
    final ids = Set<int>.from(_selected);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete selected?'),
        content: Text(
          'Delete ${ids.length} video${ids.length == 1 ? '' : 's'} and their files?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    _exitSelectMode();
    int failed = 0;
    for (final id in ids) {
      try {
        await widget.api.deleteJob(id);
        unawaited(_dlManager.deleteLocalFile(id));
        if (mounted) {
          setState(() {
            _jobs.removeWhere((j) => j.id == id);
            _locallyDownloaded.remove(id);
          });
        }
      } catch (_) {
        failed++;
      }
    }
    if (failed > 0 && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('$failed deletion(s) failed'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.playlist.addListener(_playlistChanged);
    _refresh();
    _loadLocalDownloads();
  }

  @override
  void didUpdateWidget(covariant JobsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.playlist != widget.playlist) {
      oldWidget.playlist.removeListener(_playlistChanged);
      widget.playlist.addListener(_playlistChanged);
    }
  }

  void _playlistChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _loadLocalDownloads() async {
    final ids = await _dlManager.localJobIds();
    if (!mounted) return;
    setState(() {
      _locallyDownloaded.clear();
      _locallyDownloaded.addAll(ids);
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    widget.playlist.removeListener(_playlistChanged);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  void _schedulePoll() {
    _pollTimer?.cancel();
    if (_jobs.any((j) => j.isActive)) {
      _pollTimer = Timer(
        const Duration(seconds: 3),
        () => _refresh(silent: true),
      );
    }
  }

  Future<void> _refresh({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final jobs = await widget.api.listJobs();
      if (!mounted) return;
      setState(() {
        _jobs = jobs;
        _loading = false;
        _error = null;
      });
      _schedulePoll();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  Future<void> _delete(Job job) async {
    try {
      await widget.api.deleteJob(job.id);
      unawaited(_dlManager.deleteLocalFile(job.id));
      if (mounted) {
        setState(() {
          _jobs.removeWhere((j) => j.id == job.id);
          _locallyDownloaded.remove(job.id);
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Delete failed: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  Future<void> _play(Job job) async {
    final localFile = await _dlManager.getLocalFile(job.id);
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => VideoPlayerPage.single(
          job: job,
          videoUrl: widget.api.fileUrl(job.id),
          localFile: localFile,
        ),
      ),
    );
  }

  void _addToPlaylist(Job job) {
    final added = widget.playlist.add(
      jobId: job.id,
      url: job.url,
      title: job.title.isEmpty ? job.url : job.title,
    );
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(added ? 'Added to playlist' : 'Already in playlist'),
        duration: const Duration(seconds: 2),
      ),
    );
  }

  Future<void> _downloadToPhone(Job job) async {
    if (_downloading.containsKey(job.id)) return;
    setState(() => _downloading[job.id] = 0.0);
    try {
      await _dlManager.download(job.id, (progress) {
        if (mounted) setState(() => _downloading[job.id] = progress);
      });
      if (mounted) {
        setState(() {
          _downloading.remove(job.id);
          _locallyDownloaded.add(job.id);
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _downloading.remove(job.id));
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Save failed: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final allSelected = _jobs.isNotEmpty && _selected.length == _jobs.length;
    return Scaffold(
      appBar: _selectMode
          ? AppBar(
              leading: IconButton(
                icon: const Icon(Icons.close),
                onPressed: _exitSelectMode,
              ),
              title: Text('${_selected.length} selected'),
              actions: [
                IconButton(
                  tooltip: allSelected ? 'Deselect all' : 'Select all',
                  icon: Icon(allSelected ? Icons.deselect : Icons.select_all),
                  onPressed: () => setState(() {
                    if (allSelected) {
                      _selected.clear();
                      _selectMode = false;
                    } else {
                      _selected.addAll(_jobs.map((j) => j.id));
                    }
                  }),
                ),
                IconButton(
                  tooltip: 'Delete selected',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: _selected.isEmpty ? null : _deleteSelected,
                ),
              ],
            )
          : AppBar(title: const Text('Mytube'), actions: const []),
      body: _loading && _jobs.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : _error != null && _jobs.isEmpty
          ? _buildError()
          : _jobs.isEmpty
          ? _buildEmpty()
          : RefreshIndicator(
              onRefresh: _refresh,
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(vertical: 8),
                itemCount: _jobs.length,
                itemBuilder: (_, i) => _JobCard(
                  job: _jobs[i],
                  onDelete: () => _delete(_jobs[i]),
                  onPlay: _selectMode ? null : () => _play(_jobs[i]),
                  selectMode: _selectMode,
                  selected: _selected.contains(_jobs[i].id),
                  onLongPress: () => _enterSelectMode(_jobs[i].id),
                  onToggleSelect: () => _toggleSelect(_jobs[i].id),
                  isLocallyDownloaded: _locallyDownloaded.contains(_jobs[i].id),
                  downloadingProgress: _downloading[_jobs[i].id],
                  onDownloadToPhone: _selectMode
                      ? null
                      : () => _downloadToPhone(_jobs[i]),
                  isInPlaylist: widget.playlist.contains(
                    jobId: _jobs[i].id,
                    url: _jobs[i].url,
                  ),
                  onAddToPlaylist: _selectMode
                      ? null
                      : () => _addToPlaylist(_jobs[i]),
                ),
              ),
            ),
    );
  }

  Widget _buildEmpty() => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          Icons.video_library_outlined,
          size: 64,
          color: Colors.grey.shade400,
        ),
        const SizedBox(height: 16),
        Text(
          'No downloads yet',
          style: TextStyle(fontSize: 18, color: Colors.grey.shade600),
        ),
        const SizedBox(height: 8),
        Text(
          'Use the Submit tab to add a YouTube URL',
          style: TextStyle(color: Colors.grey.shade500),
        ),
      ],
    ),
  );

  Widget _buildError() => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off, size: 56, color: Colors.grey),
          const SizedBox(height: 16),
          const Text(
            'Could not reach server',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Text(
            _error!,
            style: const TextStyle(color: Colors.grey),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    ),
  );
}

// ── Playlist page ─────────────────────────────────────────────────────────────

class PlaylistPage extends StatefulWidget {
  const PlaylistPage({super.key, required this.api, required this.playlist});

  final ApiService api;
  final PlaylistController playlist;

  @override
  State<PlaylistPage> createState() => _PlaylistPageState();
}

class _PlaylistPageState extends State<PlaylistPage>
    with WidgetsBindingObserver {
  List<Job> _jobs = [];
  bool _loading = true;
  String? _error;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.playlist.addListener(_playlistChanged);
    _refresh();
  }

  @override
  void didUpdateWidget(covariant PlaylistPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.playlist != widget.playlist) {
      oldWidget.playlist.removeListener(_playlistChanged);
      widget.playlist.addListener(_playlistChanged);
    }
    if (oldWidget.api.baseUrl != widget.api.baseUrl ||
        oldWidget.api.token != widget.api.token) {
      _refresh();
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    widget.playlist.removeListener(_playlistChanged);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  void _playlistChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _refresh() async {
    try {
      final jobs = await widget.api.listJobs();
      if (!mounted) return;
      setState(() {
        _jobs = jobs;
        _loading = false;
        _error = null;
      });
      _pollTimer?.cancel();
      if (jobs.any((job) => job.isActive)) {
        _pollTimer = Timer(const Duration(seconds: 3), _refresh);
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Job? _jobFor(PlaylistItem item) {
    for (final job in _jobs) {
      if ((item.jobId != null && item.jobId == job.id) || item.url == job.url) {
        return job;
      }
    }
    return null;
  }

  bool _isPlayable(PlaylistItem item) => _jobFor(item)?.status == 'completed';

  Future<void> _playFrom(int requestedIndex) async {
    final items = widget.playlist.items;
    final startIndex = firstPlayableIndex(items, requestedIndex, _isPlayable);
    if (startIndex == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No playable videos from this point in the playlist.'),
        ),
      );
      return;
    }

    final playableOriginalIndices = <int>[];
    final jobs = <Job>[];
    for (var index = 0; index < items.length; index++) {
      final job = _jobFor(items[index]);
      if (job?.status == 'completed') {
        playableOriginalIndices.add(index);
        jobs.add(job!);
      }
    }
    final initialIndex = playableOriginalIndices.indexOf(startIndex);
    if (initialIndex < 0 || !mounted) return;

    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => VideoPlayerPage.playlist(
          jobs: jobs,
          initialIndex: initialIndex,
          api: widget.api,
          sessionMinutes: widget.playlist.sessionMinutes,
        ),
      ),
    );
  }

  Future<void> _editItem(int index) async {
    final item = widget.playlist.items[index];
    final titleController = TextEditingController(text: item.title);
    final urlController = TextEditingController(text: item.url);
    final shouldSave = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit playlist item'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: titleController,
              decoration: const InputDecoration(labelText: 'Title'),
              textCapitalization: TextCapitalization.sentences,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: urlController,
              decoration: const InputDecoration(labelText: 'Source URL'),
              keyboardType: TextInputType.url,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (shouldSave != true || !mounted) return;

    final newUrl = urlController.text.trim();
    Job? matchingJob;
    for (final job in _jobs) {
      if (job.url == newUrl) {
        matchingJob = job;
        break;
      }
    }
    final updated = widget.playlist.updateAt(
      index,
      title: titleController.text,
      url: newUrl,
      jobId: matchingJob?.id,
    );
    if (!updated) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a unique, non-empty URL.')),
      );
    }
  }

  Future<void> _clearPlaylist() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Clear playlist?'),
        content: const Text('This removes every item from your playlist.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Clear'),
          ),
        ],
      ),
    );
    if (confirmed == true) widget.playlist.clear();
  }

  Widget _thumbnail(Job? job, bool playable) {
    return SizedBox(
      width: 96,
      height: 58,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (job?.thumbnailUrl.isNotEmpty == true)
              Image.network(
                job!.thumbnailUrl,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => Container(
                  color: Colors.grey.shade300,
                  child: const Icon(Icons.movie_outlined),
                ),
              )
            else
              Container(
                color: Colors.grey.shade300,
                child: const Icon(Icons.movie_outlined),
              ),
            if (playable)
              Container(
                color: Colors.black26,
                child: const Icon(
                  Icons.play_circle_fill,
                  color: Colors.white,
                  size: 30,
                ),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.playlist.items;
    final playableCount = items.where(_isPlayable).length;

    return Scaffold(
      appBar: AppBar(
        title: Text(items.isEmpty ? 'Playlist' : 'Playlist · ${items.length}'),
        actions: [
          IconButton(
            tooltip: 'Refresh availability',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Clear playlist',
            onPressed: items.isEmpty ? null : _clearPlaylist,
            icon: const Icon(Icons.delete_sweep_outlined),
          ),
        ],
      ),
      body: !widget.playlist.loaded || (_loading && _jobs.isEmpty)
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      playableCount == 0
                                          ? 'Nothing ready yet'
                                          : '$playableCount ready to play',
                                      style: Theme.of(
                                        context,
                                      ).textTheme.titleMedium,
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      'Unavailable items are skipped automatically.',
                                      style: Theme.of(
                                        context,
                                      ).textTheme.bodySmall,
                                    ),
                                  ],
                                ),
                              ),
                              FilledButton.icon(
                                onPressed: playableCount == 0
                                    ? null
                                    : () => _playFrom(0),
                                icon: const Icon(Icons.play_arrow),
                                label: const Text('Play all'),
                              ),
                            ],
                          ),
                          const SizedBox(height: 14),
                          Row(
                            children: [
                              const Icon(Icons.timer_outlined, size: 18),
                              const SizedBox(width: 8),
                              Text(
                                'Session timer',
                                style: Theme.of(context).textTheme.labelLarge,
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: Row(
                              children: [
                                for (final minutes in playlistSessionOptions)
                                  Padding(
                                    padding: const EdgeInsets.only(right: 8),
                                    child: ChoiceChip(
                                      label: Text('$minutes min'),
                                      selected:
                                          widget.playlist.sessionMinutes ==
                                          minutes,
                                      onSelected: (_) => widget.playlist
                                          .setSessionMinutes(minutes),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Text(
                      'Could not refresh availability: $_error',
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                        fontSize: 12,
                      ),
                    ),
                  ),
                Expanded(
                  child: items.isEmpty
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(32),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.queue_music,
                                  size: 72,
                                  color: Colors.grey.shade400,
                                ),
                                const SizedBox(height: 16),
                                const Text(
                                  'Build your listening queue',
                                  style: TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'Add completed videos from the Library. Your order and timer are saved automatically.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: Colors.grey.shade600),
                                ),
                              ],
                            ),
                          ),
                        )
                      : ReorderableListView.builder(
                          buildDefaultDragHandles: false,
                          padding: const EdgeInsets.fromLTRB(12, 6, 12, 24),
                          itemCount: items.length,
                          onReorder: widget.playlist.reorder,
                          proxyDecorator: (child, _, animation) => Material(
                            elevation: 8,
                            borderRadius: BorderRadius.circular(12),
                            child: child,
                          ),
                          itemBuilder: (context, index) {
                            final item = items[index];
                            final job = _jobFor(item);
                            final playable = job?.status == 'completed';
                            final status = playable
                                ? 'Ready'
                                : job?.status == 'downloading'
                                ? 'Downloading'
                                : job?.status == 'queued'
                                ? 'Queued'
                                : job?.status == 'failed'
                                ? 'Failed'
                                : 'Not downloaded';
                            return Card(
                              key: ValueKey(item.id),
                              margin: const EdgeInsets.only(bottom: 8),
                              clipBehavior: Clip.antiAlias,
                              child: InkWell(
                                onTap: playable ? () => _playFrom(index) : null,
                                child: Padding(
                                  padding: const EdgeInsets.all(10),
                                  child: Row(
                                    children: [
                                      _thumbnail(job, playable),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              item.title,
                                              maxLines: 2,
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                            const SizedBox(height: 5),
                                            Row(
                                              children: [
                                                Icon(
                                                  playable
                                                      ? Icons.check_circle
                                                      : Icons.schedule,
                                                  size: 14,
                                                  color: playable
                                                      ? Colors.green
                                                      : Colors.grey,
                                                ),
                                                const SizedBox(width: 4),
                                                Expanded(
                                                  child: Text(
                                                    status,
                                                    style: TextStyle(
                                                      fontSize: 12,
                                                      color: playable
                                                          ? Colors.green
                                                          : Colors
                                                                .grey
                                                                .shade600,
                                                    ),
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ],
                                        ),
                                      ),
                                      PopupMenuButton<String>(
                                        tooltip: 'Playlist item actions',
                                        onSelected: (action) {
                                          if (action == 'edit') {
                                            _editItem(index);
                                          } else if (action == 'remove') {
                                            widget.playlist.removeAt(index);
                                          }
                                        },
                                        itemBuilder: (_) => const [
                                          PopupMenuItem(
                                            value: 'edit',
                                            child: ListTile(
                                              leading: Icon(
                                                Icons.edit_outlined,
                                              ),
                                              title: Text('Edit'),
                                              contentPadding: EdgeInsets.zero,
                                            ),
                                          ),
                                          PopupMenuItem(
                                            value: 'remove',
                                            child: ListTile(
                                              leading: Icon(
                                                Icons.delete_outline,
                                              ),
                                              title: Text('Remove'),
                                              contentPadding: EdgeInsets.zero,
                                            ),
                                          ),
                                        ],
                                      ),
                                      ReorderableDragStartListener(
                                        index: index,
                                        child: const Padding(
                                          padding: EdgeInsets.all(8),
                                          child: Icon(Icons.drag_handle),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
    );
  }
}

// ── Job card ──────────────────────────────────────────────────────────────────

class _JobCard extends StatelessWidget {
  final Job job;
  final VoidCallback onDelete;
  final VoidCallback? onPlay;
  final bool selectMode;
  final bool selected;
  final VoidCallback onLongPress;
  final VoidCallback onToggleSelect;
  final bool isLocallyDownloaded;
  final double? downloadingProgress;
  final VoidCallback? onDownloadToPhone;
  final bool isInPlaylist;
  final VoidCallback? onAddToPlaylist;
  const _JobCard({
    required this.job,
    required this.onDelete,
    required this.onPlay,
    required this.selectMode,
    required this.selected,
    required this.onLongPress,
    required this.onToggleSelect,
    required this.isLocallyDownloaded,
    required this.downloadingProgress,
    required this.onDownloadToPhone,
    required this.isInPlaylist,
    required this.onAddToPlaylist,
  });

  Color _statusColor(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return switch (job.status) {
      'completed' => Colors.green,
      'failed' => cs.error,
      'downloading' => cs.primary,
      _ => Colors.orange,
    };
  }

  @override
  Widget build(BuildContext context) {
    final card = Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      color: selected
          ? Theme.of(context).colorScheme.primaryContainer.withAlpha(120)
          : null,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top row: thumbnail/checkbox + title info
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Checkbox shown in select mode, thumbnail otherwise
                if (selectMode)
                  Padding(
                    padding: const EdgeInsets.only(right: 8, top: 8),
                    child: Checkbox(
                      value: selected,
                      onChanged: (_) => onToggleSelect(),
                    ),
                  )
                else
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: job.thumbnailUrl.isNotEmpty
                        ? Image.network(
                            job.thumbnailUrl,
                            width: 90,
                            height: 60,
                            fit: BoxFit.cover,
                            errorBuilder: (context, error, stackTrace) =>
                                _placeholder(),
                          )
                        : _placeholder(),
                  ),
                if (!selectMode) const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              job.title.isNotEmpty ? job.title : job.url,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 14,
                              ),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: 8),
                          _StatusBadge(
                            status: job.status,
                            color: _statusColor(context),
                          ),
                        ],
                      ),
                      if (job.uploader.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          job.uploader,
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.grey.shade600,
                          ),
                        ),
                      ],
                      if (job.status == 'downloading' &&
                          job.progress != null) ...[
                        const SizedBox(height: 6),
                        LinearProgressIndicator(
                          value: (job.progress!.percent / 100).clamp(0.0, 1.0),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${job.progress!.percent.toStringAsFixed(1)}%  ${job.progress!.speed}  ETA ${job.progress!.eta}',
                          style: TextStyle(
                            fontSize: 11,
                            color: Colors.grey.shade600,
                          ),
                        ),
                      ],
                      if (job.status == 'failed' && job.error.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          job.error,
                          style: TextStyle(
                            fontSize: 12,
                            color: Theme.of(context).colorScheme.error,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
            // Bottom row: full-width action buttons (completed jobs only)
            if (job.status == 'completed' && !selectMode) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: onPlay,
                      icon: Icon(
                        isLocallyDownloaded
                            ? Icons.offline_pin
                            : Icons.play_arrow,
                      ),
                      label: const Text('Play'),
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 8,
                        ),
                        minimumSize: const Size(0, 36),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (downloadingProgress != null)
                    SizedBox(
                      width: 36,
                      height: 36,
                      child: Padding(
                        padding: const EdgeInsets.all(7),
                        child: CircularProgressIndicator(
                          value: downloadingProgress! > 0
                              ? downloadingProgress
                              : null,
                          strokeWidth: 2.5,
                        ),
                      ),
                    )
                  else if (!isLocallyDownloaded)
                    IconButton.outlined(
                      onPressed: onDownloadToPhone,
                      icon: const Icon(
                        Icons.download_for_offline_outlined,
                        size: 20,
                      ),
                      tooltip: 'Save to phone',
                      style: IconButton.styleFrom(
                        minimumSize: const Size(36, 36),
                        padding: EdgeInsets.zero,
                      ),
                    )
                  else
                    Tooltip(
                      message: 'Saved on phone',
                      child: Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          border: Border.all(
                            color: Theme.of(context).colorScheme.outline,
                          ),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(
                          Icons.check_circle_outline,
                          size: 20,
                          color: Colors.green,
                        ),
                      ),
                    ),
                  const SizedBox(width: 8),
                  IconButton.outlined(
                    onPressed: isInPlaylist ? null : onAddToPlaylist,
                    icon: Icon(
                      isInPlaylist
                          ? Icons.playlist_add_check
                          : Icons.playlist_add,
                      size: 20,
                    ),
                    tooltip: isInPlaylist
                        ? 'Already in playlist'
                        : 'Add to playlist',
                    style: IconButton.styleFrom(
                      minimumSize: const Size(36, 36),
                      padding: EdgeInsets.zero,
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.outlined(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: job.url));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('URL copied'),
                          duration: Duration(seconds: 2),
                        ),
                      );
                    },
                    icon: const Icon(Icons.link, size: 20),
                    tooltip: 'Copy URL',
                    style: IconButton.styleFrom(
                      minimumSize: const Size(36, 36),
                      padding: EdgeInsets.zero,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );

    // In select mode: tap toggles selection, no swipe-to-dismiss
    if (selectMode) {
      return GestureDetector(
        onTap: onToggleSelect,
        onLongPress: onLongPress,
        child: card,
      );
    }

    // Normal mode: swipe to delete, long-press to enter select mode
    return Dismissible(
      key: ValueKey(job.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: Theme.of(context).colorScheme.error,
        child: const Icon(Icons.delete_outline, color: Colors.white, size: 28),
      ),
      confirmDismiss: (_) async {
        return await showDialog<bool>(
              context: context,
              builder: (ctx) => AlertDialog(
                title: const Text('Delete?'),
                content: Text(
                  'Remove "${job.title.isNotEmpty ? job.title : job.url}" and its downloaded file?',
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(ctx, false),
                    child: const Text('Cancel'),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.pop(ctx, true),
                    child: const Text('Delete'),
                  ),
                ],
              ),
            ) ??
            false;
      },
      onDismissed: (_) => onDelete(),
      child: GestureDetector(onLongPress: onLongPress, child: card),
    );
  }

  Widget _placeholder() => Container(
    width: 90,
    height: 60,
    color: Colors.grey.shade200,
    child: const Icon(Icons.movie_outlined, color: Colors.grey),
  );
}

class _StatusBadge extends StatelessWidget {
  final String status;
  final Color color;
  const _StatusBadge({required this.status, required this.color});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withAlpha(38),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        status,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }
}

class VideoPlayerPage extends StatefulWidget {
  const VideoPlayerPage._({
    super.key,
    required this.jobs,
    required this.initialIndex,
    required this.playlistMode,
    this.api,
    this.singleVideoUrl,
    this.singleLocalFile,
    this.sessionMinutes,
  });

  factory VideoPlayerPage.single({
    Key? key,
    required Job job,
    required String videoUrl,
    File? localFile,
  }) {
    return VideoPlayerPage._(
      key: key,
      jobs: [job],
      initialIndex: 0,
      playlistMode: false,
      singleVideoUrl: videoUrl,
      singleLocalFile: localFile,
    );
  }

  factory VideoPlayerPage.playlist({
    Key? key,
    required List<Job> jobs,
    required int initialIndex,
    required ApiService api,
    required int sessionMinutes,
  }) {
    return VideoPlayerPage._(
      key: key,
      jobs: List.unmodifiable(jobs),
      initialIndex: initialIndex,
      playlistMode: true,
      api: api,
      sessionMinutes: sessionMinutes,
    );
  }

  final List<Job> jobs;
  final int initialIndex;
  final bool playlistMode;
  final ApiService? api;
  final String? singleVideoUrl;
  final File? singleLocalFile;
  final int? sessionMinutes;

  @override
  State<VideoPlayerPage> createState() => _VideoPlayerPageState();
}

class _VideoPlayerPageState extends State<VideoPlayerPage>
    with WidgetsBindingObserver {
  VideoPlayerController? _controller;
  late int _index;
  bool _ready = false;
  String? _error;
  double _speed = 1.0;
  bool _wasPlayingBeforeBackground = false;
  bool _changingTrack = false;
  bool _completionHandled = false;
  bool _queueFinished = false;
  bool _sessionEnded = false;
  int _loadGeneration = 0;
  Timer? _sessionTimer;
  Timer? _controlsTimer;
  DateTime? _sessionDeadline;
  Duration _sessionRemaining = Duration.zero;
  bool _controlsVisible = true;
  bool _screenAwakeForPlayback = false;

  // Now Playing / lock-screen controls.
  static const _nowPlayingChannel = MethodChannel('com.mytube/nowPlaying');
  bool _lastIsPlaying = false;
  Duration _lastReportedPosition = Duration.zero;

  static const List<double> _speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
  static final Map<double, String> _speedLabels = {
    0.5: '0.5×',
    0.75: '0.75×',
    1.0: '1×',
    1.25: '1.25×',
    1.5: '1.5×',
    2.0: '2×',
  };

  Job get _job => widget.jobs[_index];
  bool get _hasPrevious => widget.playlistMode && _index > 0;
  bool get _hasNext => widget.playlistMode && _index < widget.jobs.length - 1;
  String get _currentVideoUrl => widget.playlistMode
      ? widget.api!.fileUrl(_job.id)
      : widget.singleVideoUrl!;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _index = widget.initialIndex.clamp(0, widget.jobs.length - 1).toInt();
    _nowPlayingChannel.setMethodCallHandler(_handleRemoteCommand);
    _startSessionTimer();
    unawaited(_loadCurrentTrack());
  }

  void _startSessionTimer() {
    final minutes = widget.sessionMinutes;
    if (!widget.playlistMode || minutes == null) return;
    _sessionRemaining = Duration(minutes: minutes);
    _sessionDeadline = DateTime.now().add(_sessionRemaining);
    _sessionTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      final deadline = _sessionDeadline;
      if (!mounted || deadline == null) return;
      final remaining = deadline.difference(DateTime.now());
      if (remaining <= Duration.zero) {
        _sessionTimer?.cancel();
        _controller?.pause();
        _wasPlayingBeforeBackground = false;
        setState(() {
          _sessionRemaining = Duration.zero;
          _sessionEnded = true;
        });
        _updateNowPlaying(force: true);
      } else {
        setState(() => _sessionRemaining = remaining);
      }
    });
  }

  Future<File?> _localFileForCurrentTrack() async {
    if (!widget.playlistMode) return widget.singleLocalFile;
    final manager = LocalDownloadManager(
      baseUrl: widget.api!.baseUrl,
      token: widget.api!.token,
    );
    return manager.getLocalFile(_job.id);
  }

  Future<void> _loadCurrentTrack() async {
    final generation = ++_loadGeneration;
    final previous = _controller;
    _controller = null;
    _controlsTimer?.cancel();
    _setScreenAwake(false);
    if (previous != null) {
      previous.removeListener(_tick);
      await previous.pause();
      await previous.dispose();
    }
    if (!mounted || generation != _loadGeneration) return;

    setState(() {
      _ready = false;
      _error = null;
      _completionHandled = false;
      _queueFinished = false;
      _controlsVisible = true;
    });

    try {
      final localFile = await _localFileForCurrentTrack();
      if (!mounted || generation != _loadGeneration) return;
      final options = VideoPlayerOptions(
        allowBackgroundPlayback: true,
        mixWithOthers: false,
      );
      final controller = localFile != null
          ? VideoPlayerController.file(localFile, videoPlayerOptions: options)
          : VideoPlayerController.networkUrl(
              Uri.parse(_currentVideoUrl),
              videoPlayerOptions: options,
            );
      await controller.initialize();
      if (!mounted || generation != _loadGeneration) {
        await controller.dispose();
        return;
      }
      _controller = controller;
      controller.addListener(_tick);
      await controller.setPlaybackSpeed(_speed);
      setState(() => _ready = true);
      if (!_sessionEnded) {
        _wasPlayingBeforeBackground = true;
        await controller.play();
      }
      _updateNowPlaying(force: true);
    } catch (error) {
      if (!mounted || generation != _loadGeneration) return;
      setState(() => _error = error.toString());
    }
  }

  Future<void> _changeTrack(int index) async {
    if (_changingTrack || index < 0 || index >= widget.jobs.length) return;
    _changingTrack = true;
    setState(() {
      _index = index;
      _ready = false;
      _error = null;
    });
    await _loadCurrentTrack();
    if (mounted) setState(() => _changingTrack = false);
  }

  void _handleTrackCompletion() {
    if (_completionHandled) return;
    _completionHandled = true;
    if (_hasNext && !_sessionEnded) {
      unawaited(_changeTrack(_index + 1));
    } else if (mounted) {
      _wasPlayingBeforeBackground = false;
      _sessionTimer?.cancel();
      setState(() => _queueFinished = widget.playlistMode);
      _updateNowPlaying(force: true);
    }
  }

  void _setScreenAwake(bool enabled) {
    if (_screenAwakeForPlayback == enabled) return;
    _screenAwakeForPlayback = enabled;
    unawaited(enabled ? WakelockPlus.enable() : WakelockPlus.disable());
  }

  void _restartControlsHideTimer() {
    _controlsTimer?.cancel();
    final controller = _controller;
    if (!mounted || controller == null || !controller.value.isPlaying) return;
    _controlsTimer = Timer(const Duration(seconds: 3), () {
      if (!mounted || !(_controller?.value.isPlaying ?? false)) return;
      setState(() => _controlsVisible = false);
    });
  }

  void _showControls() {
    if (!_controlsVisible) setState(() => _controlsVisible = true);
    _restartControlsHideTimer();
  }

  void _toggleControls() {
    final isPlaying = _controller?.value.isPlaying ?? false;
    if (_controlsVisible && isPlaying) {
      _controlsTimer?.cancel();
      setState(() => _controlsVisible = false);
    } else {
      _showControls();
    }
  }

  Future<void> _togglePlayback() async {
    final controller = _controller;
    if (controller == null) return;
    if (controller.value.isPlaying) {
      _wasPlayingBeforeBackground = false;
      await controller.pause();
    } else if (!_sessionEnded) {
      _wasPlayingBeforeBackground = true;
      await controller.play();
    }
    _showControls();
  }

  void _seekBy(Duration offset) {
    final controller = _controller;
    if (controller == null) return;
    final duration = controller.value.duration;
    final target = controller.value.position + offset;
    controller.seekTo(
      Duration(
        milliseconds: target.inMilliseconds
            .clamp(0, duration.inMilliseconds)
            .toInt(),
      ),
    );
    _showControls();
  }

  void _syncPlaybackChrome(bool isPlaying) {
    if (_screenAwakeForPlayback == isPlaying) return;
    _setScreenAwake(isPlaying);
    if (isPlaying) {
      _restartControlsHideTimer();
    } else {
      _controlsTimer?.cancel();
      _controlsVisible = true;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final controller = _controller;
    if (controller == null) return;
    if (state == AppLifecycleState.inactive) {
      // Capture play state before the system has a chance to auto-pause the
      // AVPlayer (which iOS does for video content when entering background).
      _wasPlayingBeforeBackground = controller.value.isPlaying;
    } else if (state == AppLifecycleState.paused) {
      // iOS automatically sets AVPlayer rate → 0 for video content when the app
      // enters background, even with UIBackgroundModes:audio configured. We
      // override this by re-issuing play immediately and again after a short
      // delay (to win any race against the system auto-pause).
      if (_wasPlayingBeforeBackground) {
        controller.play();
        Future<void>.delayed(const Duration(milliseconds: 500), () {
          if (mounted &&
              _controller == controller &&
              _wasPlayingBeforeBackground) {
            controller.play();
          }
        });
      }
    } else if (state == AppLifecycleState.resumed) {
      // Catch anything that slipped through while backgrounded.
      if (_wasPlayingBeforeBackground && !controller.value.isPlaying) {
        controller.play();
      }
    }
  }

  void _tick() {
    final controller = _controller;
    if (!mounted || controller == null) return;
    final value = controller.value;
    _syncPlaybackChrome(value.isPlaying);
    if (!_completionHandled &&
        value.isInitialized &&
        value.duration > Duration.zero &&
        value.position >= value.duration &&
        !value.isPlaying) {
      _handleTrackCompletion();
    }
    setState(() {});
    _updateNowPlaying();
  }

  void _updateNowPlaying({bool force = false}) {
    final controller = _controller;
    if (!_ready || controller == null) return;
    final pos = controller.value.position;
    final isPlaying = controller.value.isPlaying;
    // Throttle: only push an update when position moves ≥1 s or play state changes.
    if (!force &&
        (pos - _lastReportedPosition).abs() <
            const Duration(milliseconds: 950) &&
        isPlaying == _lastIsPlaying) {
      return;
    }
    _lastReportedPosition = pos;
    _lastIsPlaying = isPlaying;
    final title = _job.title.isNotEmpty ? _job.title : 'Video #${_job.id}';
    _nowPlayingChannel.invokeMethod<void>('update', {
      'title': title,
      'position': pos.inMilliseconds / 1000.0,
      'duration': controller.value.duration.inMilliseconds / 1000.0,
      'isPlaying': isPlaying,
      'hasNext': _hasNext && !_sessionEnded,
      'hasPrevious': _hasPrevious,
    });
  }

  Future<void> _handleRemoteCommand(MethodCall call) async {
    final controller = _controller;
    if (controller == null) return;
    switch (call.method) {
      case 'play':
        _wasPlayingBeforeBackground = true;
        await controller.play();
      case 'pause':
        _wasPlayingBeforeBackground = false;
        await controller.pause();
      case 'togglePlayPause':
        if (controller.value.isPlaying) {
          _wasPlayingBeforeBackground = false;
          await controller.pause();
        } else {
          _wasPlayingBeforeBackground = true;
          await controller.play();
        }
      case 'seekTo':
        final secs = (call.arguments as num).toDouble();
        await controller.seekTo(Duration(milliseconds: (secs * 1000).round()));
      case 'nextTrack':
        if (_hasNext) await _changeTrack(_index + 1);
      case 'previousTrack':
        if (_hasPrevious) await _changeTrack(_index - 1);
    }
  }

  @override
  void dispose() {
    _loadGeneration++;
    _sessionTimer?.cancel();
    _controlsTimer?.cancel();
    _setScreenAwake(false);
    WidgetsBinding.instance.removeObserver(this);
    _controller?.removeListener(_tick);
    _nowPlayingChannel.invokeMethod<void>('clear');
    _nowPlayingChannel.setMethodCallHandler(null);
    final controller = _controller;
    if (controller != null) unawaited(controller.dispose());
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  String _fmt(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return h > 0 ? '$h:$m:$s' : '$m:$s';
  }

  void _cycleSpeed() {
    final newSpeed = _speeds[(_speeds.indexOf(_speed) + 1) % _speeds.length];
    setState(() => _speed = newSpeed);
    _controller?.setPlaybackSpeed(newSpeed);
    _showControls();
  }

  void _showInfo() {
    final title = _job.title.isNotEmpty ? _job.title : 'Video #${_job.id}';
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 16),
                _InfoRow(label: 'Video ID', value: _job.id.toString()),
                _InfoRow(label: 'Status', value: _job.status),
                if (_job.uploader.isNotEmpty)
                  _InfoRow(label: 'Uploader', value: _job.uploader),
                if (_job.createdAt.isNotEmpty)
                  _InfoRow(label: 'Created', value: _job.createdAt),
                if (_job.url.isNotEmpty)
                  _InfoRow(label: 'Source URL', value: _job.url),
                _InfoRow(label: 'File URL', value: _currentVideoUrl),
                if (_job.thumbnailUrl.isNotEmpty)
                  _InfoRow(label: 'Thumbnail', value: _job.thumbnailUrl),
                if (_job.error.isNotEmpty)
                  _InfoRow(label: 'Error', value: _job.error),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildControls(
    Duration pos,
    Duration dur,
    double progress,
    bool isPlaying,
  ) {
    final controller = _controller!;
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.bottomCenter,
          end: Alignment.topCenter,
          colors: [Color(0xEE000000), Colors.transparent],
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SliderTheme(
                data: SliderTheme.of(context).copyWith(
                  trackHeight: 3,
                  thumbShape: const RoundSliderThumbShape(
                    enabledThumbRadius: 8,
                  ),
                  overlayShape: const RoundSliderOverlayShape(
                    overlayRadius: 22,
                  ),
                  activeTrackColor: Colors.red,
                  inactiveTrackColor: Colors.white30,
                  thumbColor: Colors.white,
                  overlayColor: Colors.white24,
                ),
                child: Slider(
                  value: progress,
                  onChangeStart: (_) => _controlsTimer?.cancel(),
                  onChanged: (v) => controller.seekTo(
                    Duration(milliseconds: (v * dur.inMilliseconds).round()),
                  ),
                  onChangeEnd: (_) => _showControls(),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      _fmt(pos),
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                      ),
                    ),
                    Text(
                      _fmt(dur),
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 4),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  TextButton(
                    onPressed: _cycleSpeed,
                    style: TextButton.styleFrom(
                      foregroundColor: Colors.white,
                      minimumSize: const Size(56, 56),
                    ),
                    child: Text(
                      _speedLabels[_speed] ?? '$_speed×',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  IconButton(
                    iconSize: 40,
                    color: Colors.white,
                    onPressed: () => _seekBy(const Duration(seconds: -10)),
                    icon: const Icon(Icons.replay_10),
                  ),
                  IconButton(
                    iconSize: 68,
                    color: Colors.white,
                    onPressed: _togglePlayback,
                    icon: Icon(
                      isPlaying ? Icons.pause_circle : Icons.play_circle,
                    ),
                  ),
                  IconButton(
                    iconSize: 40,
                    color: Colors.white,
                    onPressed: () => _seekBy(const Duration(seconds: 10)),
                    icon: const Icon(Icons.forward_10),
                  ),
                  const SizedBox(width: 56),
                ],
              ),
              if (widget.playlistMode) ...[
                const Divider(color: Colors.white24, height: 12),
                Row(
                  children: [
                    IconButton(
                      tooltip: 'Previous video',
                      onPressed: _hasPrevious && !_changingTrack
                          ? () => _changeTrack(_index - 1)
                          : null,
                      color: Colors.white,
                      disabledColor: Colors.white24,
                      icon: const Icon(Icons.skip_previous),
                    ),
                    Expanded(
                      child: Column(
                        children: [
                          Text(
                            'Playlist · ${_index + 1} of ${widget.jobs.length}',
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _sessionEnded
                                ? 'Session complete · playback stopped'
                                : _queueFinished
                                ? 'Playlist complete'
                                : '${_fmt(_sessionRemaining)} remaining${_hasNext ? ' · Up next: ${widget.jobs[_index + 1].title}' : ''}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: _sessionEnded
                                  ? Colors.amberAccent
                                  : Colors.white60,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Next video',
                      onPressed: _hasNext && !_changingTrack && !_sessionEnded
                          ? () => _changeTrack(_index + 1)
                          : null,
                      color: Colors.white,
                      disabledColor: Colors.white24,
                      icon: const Icon(Icons.skip_next),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 4),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCompactLandscapeControls(
    Duration pos,
    Duration dur,
    double progress,
    bool isPlaying,
  ) {
    final controller = _controller!;
    final buttonStyle = IconButton.styleFrom(
      foregroundColor: Colors.white,
      disabledForegroundColor: Colors.white24,
      minimumSize: const Size(44, 44),
      padding: const EdgeInsets.all(6),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );

    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.bottomCenter,
          end: Alignment.topCenter,
          colors: [Color(0xF0000000), Color(0xA8000000), Colors.transparent],
        ),
      ),
      child: SafeArea(
        top: false,
        minimum: const EdgeInsets.only(left: 8, right: 8, bottom: 2),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                SizedBox(
                  width: 48,
                  child: Text(
                    _fmt(pos),
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white70, fontSize: 11),
                  ),
                ),
                Expanded(
                  child: SliderTheme(
                    data: SliderTheme.of(context).copyWith(
                      trackHeight: 2,
                      thumbShape: const RoundSliderThumbShape(
                        enabledThumbRadius: 6,
                      ),
                      overlayShape: const RoundSliderOverlayShape(
                        overlayRadius: 16,
                      ),
                      activeTrackColor: Colors.red,
                      inactiveTrackColor: Colors.white30,
                      thumbColor: Colors.white,
                      overlayColor: Colors.white24,
                    ),
                    child: Slider(
                      value: progress,
                      onChangeStart: (_) => _controlsTimer?.cancel(),
                      onChanged: (value) => controller.seekTo(
                        Duration(
                          milliseconds: (value * dur.inMilliseconds).round(),
                        ),
                      ),
                      onChangeEnd: (_) => _showControls(),
                    ),
                  ),
                ),
                SizedBox(
                  width: 48,
                  child: Text(
                    _fmt(dur),
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white70, fontSize: 11),
                  ),
                ),
              ],
            ),
            SizedBox(
              height: 46,
              child: Row(
                children: [
                  SizedBox(
                    width: 48,
                    child: TextButton(
                      onPressed: _cycleSpeed,
                      style: TextButton.styleFrom(
                        foregroundColor: Colors.white,
                        padding: EdgeInsets.zero,
                        minimumSize: const Size(44, 44),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: Text(
                        _speedLabels[_speed] ?? '$_speed×',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
                  if (widget.playlistMode)
                    IconButton(
                      tooltip: 'Previous video',
                      style: buttonStyle,
                      onPressed: _hasPrevious && !_changingTrack
                          ? () => _changeTrack(_index - 1)
                          : null,
                      icon: const Icon(Icons.skip_previous, size: 25),
                    ),
                  IconButton(
                    tooltip: 'Back 10 seconds',
                    style: buttonStyle,
                    onPressed: () => _seekBy(const Duration(seconds: -10)),
                    icon: const Icon(Icons.replay_10, size: 25),
                  ),
                  IconButton(
                    tooltip: isPlaying ? 'Pause' : 'Play',
                    style: buttonStyle,
                    onPressed: _togglePlayback,
                    icon: Icon(
                      isPlaying ? Icons.pause_circle : Icons.play_circle,
                      size: 42,
                    ),
                  ),
                  IconButton(
                    tooltip: 'Forward 10 seconds',
                    style: buttonStyle,
                    onPressed: () => _seekBy(const Duration(seconds: 10)),
                    icon: const Icon(Icons.forward_10, size: 25),
                  ),
                  if (widget.playlistMode)
                    IconButton(
                      tooltip: 'Next video',
                      style: buttonStyle,
                      onPressed: _hasNext && !_changingTrack && !_sessionEnded
                          ? () => _changeTrack(_index + 1)
                          : null,
                      icon: const Icon(Icons.skip_next, size: 25),
                    ),
                  const Spacer(),
                  if (widget.playlistMode)
                    Flexible(
                      child: Text(
                        _sessionEnded
                            ? 'Session complete'
                            : '${_index + 1}/${widget.jobs.length} · ${_fmt(_sessionRemaining)} left',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.end,
                        style: TextStyle(
                          color: _sessionEnded
                              ? Colors.amberAccent
                              : Colors.white70,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  const SizedBox(width: 6),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final title = _job.title.isNotEmpty ? _job.title : 'Video #${_job.id}';
    if (_error != null) {
      return Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.black,
          foregroundColor: Colors.white,
          surfaceTintColor: Colors.black,
          iconTheme: const IconThemeData(color: Colors.white),
          title: Text(title, overflow: TextOverflow.ellipsis),
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Failed to load video:\n$_error',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white),
                ),
                if (_hasNext) ...[
                  const SizedBox(height: 20),
                  FilledButton.icon(
                    onPressed: () => _changeTrack(_index + 1),
                    icon: const Icon(Icons.skip_next),
                    label: const Text('Skip to next'),
                  ),
                ],
              ],
            ),
          ),
        ),
      );
    }
    if (!_ready) {
      return Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.black,
          foregroundColor: Colors.white,
          surfaceTintColor: Colors.black,
          iconTheme: const IconThemeData(color: Colors.white),
          title: Text(title, overflow: TextOverflow.ellipsis),
        ),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    final controller = _controller!;
    final pos = controller.value.position;
    final dur = controller.value.duration;
    final progress = dur.inMilliseconds > 0
        ? (pos.inMilliseconds / dur.inMilliseconds).clamp(0.0, 1.0)
        : 0.0;
    final isPlaying = controller.value.isPlaying;

    return OrientationBuilder(
      builder: (context, orientation) {
        final isLandscape = orientation == Orientation.landscape;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          SystemChrome.setEnabledSystemUIMode(
            isLandscape
                ? SystemUiMode.immersiveSticky
                : SystemUiMode.edgeToEdge,
          );
        });

        if (isLandscape) {
          return Scaffold(
            backgroundColor: Colors.black,
            body: Stack(
              fit: StackFit.expand,
              children: [
                GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: _toggleControls,
                  child: Center(
                    child: AspectRatio(
                      aspectRatio: controller.value.aspectRatio,
                      child: VideoPlayer(controller),
                    ),
                  ),
                ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: IgnorePointer(
                    ignoring: !_controlsVisible,
                    child: AnimatedOpacity(
                      opacity: _controlsVisible ? 1 : 0,
                      duration: const Duration(milliseconds: 220),
                      child: _buildCompactLandscapeControls(
                        pos,
                        dur,
                        progress,
                        isPlaying,
                      ),
                    ),
                  ),
                ),
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  child: IgnorePointer(
                    ignoring: !_controlsVisible,
                    child: AnimatedOpacity(
                      opacity: _controlsVisible ? 1 : 0,
                      duration: const Duration(milliseconds: 220),
                      child: Container(
                        decoration: const BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [Color(0xB8000000), Colors.transparent],
                          ),
                        ),
                        child: SafeArea(
                          bottom: false,
                          child: SizedBox(
                            height: 48,
                            child: Row(
                              children: [
                                IconButton(
                                  tooltip: 'Back',
                                  icon: const Icon(
                                    Icons.arrow_back,
                                    color: Colors.white,
                                  ),
                                  onPressed: () => Navigator.pop(context),
                                ),
                                Expanded(
                                  child: Text(
                                    title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                                IconButton(
                                  tooltip: 'Video info',
                                  icon: const Icon(
                                    Icons.info_outline,
                                    color: Colors.white,
                                  ),
                                  onPressed: _showInfo,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          );
        }

        // Portrait: standard layout with AppBar.
        return Scaffold(
          backgroundColor: Colors.black,
          appBar: AppBar(
            backgroundColor: Colors.black,
            title: widget.playlistMode
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'PLAYLIST · ${_index + 1} OF ${widget.jobs.length}',
                        style: const TextStyle(
                          fontSize: 10,
                          color: Colors.white60,
                          letterSpacing: 0.8,
                        ),
                      ),
                      Text(title, overflow: TextOverflow.ellipsis),
                    ],
                  )
                : Text(title, overflow: TextOverflow.ellipsis),
            foregroundColor: Colors.white,
            surfaceTintColor: Colors.black,
            iconTheme: const IconThemeData(color: Colors.white),
            actionsIconTheme: const IconThemeData(color: Colors.white),
            actions: [
              IconButton(
                tooltip: 'Video info',
                onPressed: _showInfo,
                icon: const Icon(Icons.info_outline),
              ),
            ],
          ),
          body: Stack(
            fit: StackFit.expand,
            children: [
              GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: _toggleControls,
                child: Center(
                  child: AspectRatio(
                    aspectRatio: controller.value.aspectRatio,
                    child: VideoPlayer(controller),
                  ),
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: IgnorePointer(
                  ignoring: !_controlsVisible,
                  child: AnimatedOpacity(
                    opacity: _controlsVisible ? 1 : 0,
                    duration: const Duration(milliseconds: 220),
                    child: _buildControls(pos, dur, progress, isPlaying),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _InfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelMedium),
          const SizedBox(height: 4),
          SelectableText(value, style: Theme.of(context).textTheme.bodyMedium),
        ],
      ),
    );
  }
}

// ── Submit page ───────────────────────────────────────────────────────────────

class SubmitPage extends StatefulWidget {
  final ApiService api;
  const SubmitPage({super.key, required this.api});
  @override
  State<SubmitPage> createState() => _SubmitPageState();
}

class _SubmitPageState extends State<SubmitPage> {
  final _urlCtrl = TextEditingController();
  bool _loading = false;
  String? _result;
  bool _success = false;

  Future<void> _submit() async {
    final url = _urlCtrl.text.trim();
    if (url.isEmpty) return;
    setState(() {
      _loading = true;
      _result = null;
    });
    try {
      final id = await widget.api.createJob(url);
      if (!mounted) return;
      setState(() {
        _loading = false;
        _success = true;
        _result = '✓ Job #$id added to queue!';
      });
      _urlCtrl.clear();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _success = false;
        _result = '✗ $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Submit URL')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Paste a YouTube URL to add it to the download queue.',
              style: TextStyle(color: Colors.grey),
            ),
            const SizedBox(height: 20),
            TextField(
              controller: _urlCtrl,
              decoration: InputDecoration(
                labelText: 'YouTube URL',
                hintText: 'https://youtube.com/watch?v=...',
                border: const OutlineInputBorder(),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.paste),
                  onPressed: () async {
                    final data = await Clipboard.getData(Clipboard.kTextPlain);
                    if (data?.text != null) _urlCtrl.text = data!.text!;
                  },
                ),
              ),
              keyboardType: TextInputType.url,
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _loading ? null : _submit,
              icon: _loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.download),
              label: Text(_loading ? 'Adding...' : 'Add to Queue'),
            ),
            if (_result != null) ...[
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: _success ? Colors.green.shade50 : Colors.red.shade50,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: _success ? Colors.green : Colors.red,
                  ),
                ),
                child: Text(
                  _result!,
                  style: TextStyle(
                    color: _success
                        ? Colors.green.shade800
                        : Colors.red.shade800,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ── Settings page ─────────────────────────────────────────────────────────────

class SettingsPage extends StatefulWidget {
  final FlutterSecureStorage storage;
  final VoidCallback onSaved;
  const SettingsPage({super.key, required this.storage, required this.onSaved});
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final _apiUrlCtrl = TextEditingController();
  final _tokenCtrl = TextEditingController();
  bool _tokenVisible = false;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final url = await widget.storage.read(key: kKeyServerUrl);
    final token = await widget.storage.read(key: kKeyBearerToken);
    setState(() {
      _apiUrlCtrl.text = url ?? '';
      _tokenCtrl.text = token ?? '';
    });
  }

  Future<void> _save() async {
    await widget.storage.write(
      key: kKeyServerUrl,
      value: _apiUrlCtrl.text.trim(),
    );
    await widget.storage.write(
      key: kKeyBearerToken,
      value: _tokenCtrl.text.trim(),
    );
    widget.onSaved();
    setState(() => _saved = true);
    await Future.delayed(const Duration(seconds: 2));
    if (mounted) setState(() => _saved = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Server Configuration',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Stored in iOS Keychain and shared with the Share Extension.',
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: Colors.grey),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _apiUrlCtrl,
                    decoration: const InputDecoration(
                      labelText: 'API URL',
                      hintText: 'https://mytubeapi.elladali.com',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.dns),
                    ),
                    keyboardType: TextInputType.url,
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _tokenCtrl,
                    obscureText: !_tokenVisible,
                    decoration: InputDecoration(
                      labelText: 'Bearer Token',
                      border: const OutlineInputBorder(),
                      prefixIcon: const Icon(Icons.key),
                      suffixIcon: IconButton(
                        icon: Icon(
                          _tokenVisible
                              ? Icons.visibility_off
                              : Icons.visibility,
                        ),
                        onPressed: () =>
                            setState(() => _tokenVisible = !_tokenVisible),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _save,
                      icon: _saved
                          ? const Icon(Icons.check)
                          : const Icon(Icons.save),
                      label: Text(_saved ? 'Saved!' : 'Save Settings'),
                      style: _saved
                          ? FilledButton.styleFrom(
                              backgroundColor: Colors.green,
                            )
                          : null,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'How to Use',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 12),
                  _step(
                    context,
                    '1',
                    'Library tab shows all downloads with live progress.',
                  ),
                  _step(
                    context,
                    '2',
                    'Submit tab lets you paste any YouTube URL.',
                  ),
                  _step(
                    context,
                    '3',
                    'Share from YouTube app → Mytube to queue instantly.',
                  ),
                  _step(
                    context,
                    '4',
                    'Swipe left on any job in the Library to delete it.',
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _step(BuildContext context, String n, String text) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CircleAvatar(
          radius: 12,
          backgroundColor: Theme.of(context).colorScheme.primaryContainer,
          child: Text(
            n,
            style: TextStyle(
              fontSize: 12,
              color: Theme.of(context).colorScheme.onPrimaryContainer,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(child: Text(text)),
      ],
    ),
  );
}
