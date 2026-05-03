import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:chewie/chewie.dart';
import 'package:video_player/video_player.dart';

const String kStorageGroupId = 'group.com.mytube.mobile';
const String kKeyServerUrl   = 'mytube_server_url';
const String kKeyBearerToken = 'mytube_bearer_token';
const String kDefaultApiUrl  = 'https://mytubeapi.elladali.com';
const String kDefaultToken   = 'a86ff4614dc198cdaaa004e344e2ea3656a88fbd07959ead78e7c496f426cfc4';

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
  Job({required this.id, required this.url, required this.status,
      required this.title, required this.uploader, required this.thumbnailUrl,
      required this.error, this.progress, required this.createdAt});
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
        .post(Uri.parse('$baseUrl/api/jobs'),
            headers: _headers, body: jsonEncode({'url': url}))
        .timeout(const Duration(seconds: 10));
    if (res.statusCode != 201) throw Exception(res.body.trim());
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
      title: 'MyTube',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFFFF0000), brightness: Brightness.light),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFFFF0000), brightness: Brightness.dark),
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
  final _storage = const FlutterSecureStorage(
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock,
      groupId: 'com.mytube.mytubeMobile',
    ),
  );

  @override
  void initState() {
    super.initState();
    _loadSettings().then((_) => _checkIncomingUrl());
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
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text('Added to queue: $url'),
              backgroundColor: Colors.green,
            ));
            setState(() => _index = 0);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      JobsPage(api: _api),
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
              label: 'Library'),
          NavigationDestination(
              icon: Icon(Icons.add_circle_outline),
              selectedIcon: Icon(Icons.add_circle),
              label: 'Submit'),
          NavigationDestination(
              icon: Icon(Icons.settings_outlined),
              selectedIcon: Icon(Icons.settings),
              label: 'Settings'),
        ],
      ),
    );
  }
}

// ── Jobs page ─────────────────────────────────────────────────────────────────

class JobsPage extends StatefulWidget {
  final ApiService api;
  const JobsPage({super.key, required this.api});
  @override
  State<JobsPage> createState() => _JobsPageState();
}

class _JobsPageState extends State<JobsPage> with WidgetsBindingObserver {
  List<Job> _jobs = [];
  bool _loading = true;
  String? _error;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
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
      _pollTimer = Timer(const Duration(seconds: 3), () => _refresh(silent: true));
    }
  }

  Future<void> _refresh({bool silent = false}) async {
    if (!silent) setState(() { _loading = true; _error = null; });
    try {
      final jobs = await widget.api.listJobs();
      if (!mounted) return;
      setState(() { _jobs = jobs; _loading = false; _error = null; });
      _schedulePoll();
    } catch (e) {
      if (!mounted) return;
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _delete(Job job) async {
    try {
      await widget.api.deleteJob(job.id);
      if (mounted) setState(() => _jobs.removeWhere((j) => j.id == job.id));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Delete failed: $e'),
          backgroundColor: Colors.red,
        ));
      }
    }
  }

  Future<void> _play(Job job) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => VideoPlayerPage(
          title: job.title.isNotEmpty ? job.title : 'Video #${job.id}',
          videoUrl: widget.api.fileUrl(job.id),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('MyTube'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _refresh),
        ],
      ),
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
                          onPlay: () => _play(_jobs[i]),
                        ),
                      ),
                    ),
    );
  }

  Widget _buildEmpty() => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.video_library_outlined, size: 64, color: Colors.grey.shade400),
            const SizedBox(height: 16),
            Text('No downloads yet',
                style: TextStyle(fontSize: 18, color: Colors.grey.shade600)),
            const SizedBox(height: 8),
            Text('Use the Submit tab to add a YouTube URL',
                style: TextStyle(color: Colors.grey.shade500)),
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
              const Text('Could not reach server',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: Colors.grey), textAlign: TextAlign.center),
              const SizedBox(height: 20),
              FilledButton.icon(onPressed: _refresh, icon: const Icon(Icons.refresh), label: const Text('Retry')),
            ],
          ),
        ),
      );
}

// ── Job card ──────────────────────────────────────────────────────────────────

class _JobCard extends StatelessWidget {
  final Job job;
  final VoidCallback onDelete;
  final VoidCallback onPlay;
  const _JobCard({required this.job, required this.onDelete, required this.onPlay});

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
                content: Text('Remove "${job.title.isNotEmpty ? job.title : job.url}" and its downloaded file?'),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                  FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Delete')),
                ],
              ),
            ) ?? false;
      },
      onDismissed: (_) => onDelete(),
      child: Card(
        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: job.thumbnailUrl.isNotEmpty
                    ? Image.network(job.thumbnailUrl, width: 90, height: 60, fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) => _placeholder())
                    : _placeholder(),
              ),
              const SizedBox(width: 12),
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
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 8),
                        _StatusBadge(status: job.status, color: _statusColor(context)),
                      ],
                    ),
                    if (job.uploader.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(job.uploader, style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
                    ],
                    if (job.status == 'downloading' && job.progress != null) ...[
                      const SizedBox(height: 6),
                      LinearProgressIndicator(value: (job.progress!.percent / 100).clamp(0.0, 1.0)),
                      const SizedBox(height: 2),
                      Text(
                        '${job.progress!.percent.toStringAsFixed(1)}%  ${job.progress!.speed}  ETA ${job.progress!.eta}',
                        style: TextStyle(fontSize: 11, color: Colors.grey.shade600),
                      ),
                    ],
                    if (job.status == 'failed' && job.error.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(job.error,
                          style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.error),
                          maxLines: 2, overflow: TextOverflow.ellipsis),
                    ],
                    if (job.status == 'completed') ...[
                      const SizedBox(height: 8),
                      FilledButton.icon(
                        onPressed: onPlay,
                        icon: const Icon(Icons.play_arrow),
                        label: const Text('Play'),
                        style: FilledButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          minimumSize: const Size(0, 36),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _placeholder() => Container(
        width: 90, height: 60,
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
      child: Text(status,
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color)),
    );
  }
}

class VideoPlayerPage extends StatefulWidget {
  final String title;
  final String videoUrl;
  const VideoPlayerPage({super.key, required this.title, required this.videoUrl});

  @override
  State<VideoPlayerPage> createState() => _VideoPlayerPageState();
}

class _VideoPlayerPageState extends State<VideoPlayerPage> {
  late final VideoPlayerController _controller;
  ChewieController? _chewieController;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.networkUrl(Uri.parse(widget.videoUrl));
    _controller.initialize().then((_) {
      if (!mounted) return;
      setState(() {
        _chewieController = ChewieController(
          videoPlayerController: _controller,
          autoPlay: true,
          allowFullScreen: true,
          allowPlaybackSpeedChanging: true,
          playbackSpeeds: const [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
          showControlsOnInitialize: true,
          useRootNavigator: false,
          materialProgressColors: ChewieProgressColors(
            playedColor: Colors.red,
            handleColor: Colors.redAccent,
            backgroundColor: Colors.grey.shade800,
            bufferedColor: Colors.grey.shade500,
          ),
        );
      });
    }).catchError((e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    });
  }

  @override
  void dispose() {
    _chewieController?.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: _chewieController == null
          ? AppBar(title: Text(widget.title, overflow: TextOverflow.ellipsis))
          : null,
      body: _error != null
          ? Scaffold(
              appBar: AppBar(title: Text(widget.title, overflow: TextOverflow.ellipsis)),
              body: Center(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Text('Failed to load video: $_error', textAlign: TextAlign.center),
                ),
              ),
            )
          : _chewieController == null
              ? const Center(child: CircularProgressIndicator())
              : Chewie(controller: _chewieController!),
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
    setState(() { _loading = true; _result = null; });
    try {
      final id = await widget.api.createJob(url);
      if (!mounted) return;
      setState(() { _loading = false; _success = true; _result = '✓ Job #$id added to queue!'; });
      _urlCtrl.clear();
    } catch (e) {
      if (!mounted) return;
      setState(() { _loading = false; _success = false; _result = '✗ $e'; });
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
            const Text('Paste a YouTube URL to add it to the download queue.',
                style: TextStyle(color: Colors.grey)),
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
                  ? const SizedBox(width: 18, height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
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
                  border: Border.all(color: _success ? Colors.green : Colors.red),
                ),
                child: Text(_result!,
                    style: TextStyle(
                        color: _success ? Colors.green.shade800 : Colors.red.shade800,
                        fontWeight: FontWeight.w600)),
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
    await widget.storage.write(key: kKeyServerUrl, value: _apiUrlCtrl.text.trim());
    await widget.storage.write(key: kKeyBearerToken, value: _tokenCtrl.text.trim());
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
                  Text('Server Configuration', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text('Stored in iOS Keychain and shared with the Share Extension.',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.grey)),
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
                        icon: Icon(_tokenVisible ? Icons.visibility_off : Icons.visibility),
                        onPressed: () => setState(() => _tokenVisible = !_tokenVisible),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _save,
                      icon: _saved ? const Icon(Icons.check) : const Icon(Icons.save),
                      label: Text(_saved ? 'Saved!' : 'Save Settings'),
                      style: _saved ? FilledButton.styleFrom(backgroundColor: Colors.green) : null,
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
                  Text('How to Use', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 12),
                  _step(context, '1', 'Library tab shows all downloads with live progress.'),
                  _step(context, '2', 'Submit tab lets you paste any YouTube URL.'),
                  _step(context, '3', 'Share from YouTube app → MyTube to queue instantly.'),
                  _step(context, '4', 'Swipe left on any job in the Library to delete it.'),
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
              child: Text(n,
                  style: TextStyle(fontSize: 12,
                      color: Theme.of(context).colorScheme.onPrimaryContainer)),
            ),
            const SizedBox(width: 10),
            Expanded(child: Text(text)),
          ],
        ),
      );
}
