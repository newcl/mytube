import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_scanner/mobile_scanner.dart';

const String trustedMytubeApi = 'https://mytubeapi.elladali.com';

class MobilePairingPayload {
  const MobilePairingPayload({required this.apiBase, required this.code});

  final String apiBase;
  final String code;

  static MobilePairingPayload parse(String raw) {
    final uri = Uri.tryParse(raw);
    if (uri == null ||
        uri.scheme != 'mytube' ||
        uri.host != 'pair' ||
        uri.queryParameters['v'] != '1' ||
        uri.queryParameters['api'] != trustedMytubeApi) {
      throw const FormatException('This is not a trusted Mytube pairing code.');
    }
    final code = uri.queryParameters['code'] ?? '';
    if (!code.startsWith('mt_pair_') || code.length < 20) {
      throw const FormatException('This Mytube pairing code is invalid.');
    }
    return MobilePairingPayload(apiBase: trustedMytubeApi, code: code);
  }
}

class PairingCredentials {
  const PairingCredentials({required this.apiBase, required this.token});

  final String apiBase;
  final String token;
}

Future<PairingCredentials> exchangeMobilePairing(
  MobilePairingPayload pairing, {
  http.Client? client,
}) async {
  final requestClient = client ?? http.Client();
  try {
    final response = await requestClient
        .post(
          Uri.parse('${pairing.apiBase}/api/auth/pairings/exchange'),
          headers: const {'Content-Type': 'application/json'},
          body: jsonEncode({'code': pairing.code, 'device_name': 'iPhone'}),
        )
        .timeout(const Duration(seconds: 15));
    if (response.statusCode != 201) {
      throw Exception(
        response.statusCode == 401
            ? 'This pairing code expired or was already used.'
            : 'The server rejected pairing (${response.statusCode}).',
      );
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final token = body['token'] as String? ?? '';
    if (!token.startsWith('mt_device_')) {
      throw const FormatException(
        'The server returned an invalid device credential.',
      );
    }
    return PairingCredentials(apiBase: pairing.apiBase, token: token);
  } finally {
    if (client == null) requestClient.close();
  }
}

class MobilePairingScannerPage extends StatefulWidget {
  const MobilePairingScannerPage({super.key});

  @override
  State<MobilePairingScannerPage> createState() =>
      _MobilePairingScannerPageState();
}

class _MobilePairingScannerPageState extends State<MobilePairingScannerPage> {
  final MobileScannerController _controller = MobileScannerController();
  bool _processing = false;
  String? _error;

  Future<void> _handleCapture(BarcodeCapture capture) async {
    if (_processing) return;
    final raw = capture.barcodes
        .map((barcode) => barcode.rawValue)
        .whereType<String>()
        .firstOrNull;
    if (raw == null) return;
    setState(() {
      _processing = true;
      _error = null;
    });
    await _controller.stop();
    try {
      final credentials = await exchangeMobilePairing(
        MobilePairingPayload.parse(raw),
      );
      if (mounted) Navigator.of(context).pop(credentials);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _processing = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
      await _controller.start();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan pairing code')),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(controller: _controller, onDetect: _handleCapture),
          Center(
            child: Container(
              width: 270,
              height: 270,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white, width: 3),
                borderRadius: BorderRadius.circular(20),
              ),
            ),
          ),
          Positioned(
            left: 24,
            right: 24,
            bottom: 40,
            child: Material(
              color: Colors.black87,
              borderRadius: BorderRadius.circular(12),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_processing)
                      const CircularProgressIndicator(color: Colors.white)
                    else
                      const Text(
                        'On the Mytube website, open Settings and show the mobile pairing code.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.white),
                      ),
                    if (_error != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.redAccent),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
