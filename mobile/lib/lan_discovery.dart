import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:nsd/nsd.dart' as nsd;

const String mytubeBonjourService = '_mytube._tcp';

class LanService {
  const LanService({required this.host, required this.port});

  final String host;
  final int port;

  String get baseUrl => Uri(
    scheme: 'http',
    host: host.replaceFirst(RegExp(r'\.$'), ''),
    port: port,
  ).toString().replaceFirst(RegExp(r'/$'), '');
}

abstract interface class LanServiceBrowser {
  Future<List<LanService>> browse({required Duration timeout});
}

class MdnsLanServiceBrowser implements LanServiceBrowser {
  @override
  Future<List<LanService>> browse({required Duration timeout}) async {
    final services = <LanService>[];
    nsd.Discovery? discovery;
    try {
      discovery = await nsd
          .startDiscovery(mytubeBonjourService)
          .timeout(timeout);
      final found = Completer<void>();

      void collect(nsd.Service service, nsd.ServiceStatus status) {
        if (status != nsd.ServiceStatus.found) return;
        final host = service.host;
        final port = service.port;
        if (host != null &&
            host.isNotEmpty &&
            port != null &&
            port > 0 &&
            port <= 65535) {
          services.add(LanService(host: host, port: port));
          if (!found.isCompleted) found.complete();
        }
      }

      discovery.addServiceListener(collect);
      for (final service in discovery.services) {
        collect(service, nsd.ServiceStatus.found);
      }
      await Future.any([found.future, Future<void>.delayed(timeout)]);
    } on Object {
      // Local-network permission denial and unavailable Bonjour both fall back
      // to the public endpoint without blocking app startup.
    } finally {
      if (discovery != null) {
        try {
          await nsd.stopDiscovery(discovery);
        } on Object {
          // The native discovery may already have stopped with the network.
        }
      }
    }
    return services;
  }
}

class LanEndpointSelector {
  LanEndpointSelector({LanServiceBrowser? browser, http.Client? client})
    : _browser = browser ?? MdnsLanServiceBrowser(),
      _client = client ?? http.Client(),
      _ownsClient = client == null;

  final LanServiceBrowser _browser;
  final http.Client _client;
  final bool _ownsClient;

  Future<String?> discover({
    Duration discoveryTimeout = const Duration(seconds: 2),
    Duration probeTimeout = const Duration(seconds: 2),
  }) async {
    final services = await _browser.browse(timeout: discoveryTimeout);
    for (final service in services) {
      try {
        final response = await _client
            .get(Uri.parse('${service.baseUrl}/health'))
            .timeout(probeTimeout);
        final payload = jsonDecode(response.body) as Map<String, dynamic>;
        if (response.statusCode == 200 &&
            response.headers['x-mytube-lan'] == '1' &&
            payload['status'] == 'ok') {
          return service.baseUrl;
        }
      } on Object {
        // Try the next advertisement, then fall back to public HTTPS.
      }
    }
    return null;
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}
