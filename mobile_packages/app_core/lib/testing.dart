/// Test doubles for the HTTP layer, shared by every app's test suite (not for production code).
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'app_core.dart';
import 'package:dio/dio.dart';

class RecordedRequest {
  RecordedRequest(this.method, this.path, this.headers, this.body);
  final String method;
  final String path;
  final Map<String, dynamic> headers;
  final String? body;
}

typedef Responder = FutureOr<FakeReply> Function(RecordedRequest req);

class FakeReply {
  FakeReply(this.status, [this.json, this.raw]);
  final int status;
  final Object? json;
  final String? raw;
  factory FakeReply.ok(Object? data, {Map<String, dynamic>? meta}) => FakeReply(200, {'data': data, 'meta': ?meta});
  factory FakeReply.error(int status, String code, {String? message, List<Map<String, String>> details = const []}) =>
      FakeReply(status, {'error': {'code': code, 'message': message ?? code, 'details': details, 'requestId': 'req-test'}});
}

/// Scripted HTTP layer: lets tests exercise the real ApiClient/SessionManager without a network.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.responder);
  Responder responder;
  final requests = <RecordedRequest>[];

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final req = RecordedRequest(options.method, options.path, Map<String, dynamic>.from(options.headers), options.data as String?);
    requests.add(req);
    final reply = await responder(req);
    final body = reply.raw ?? (reply.json == null ? '' : jsonEncode(reply.json));
    return ResponseBody.fromString(body, reply.status, headers: {
      Headers.contentTypeHeader: ['application/json']
    });
  }
}

class TestRig {
  TestRig(Responder responder, {AppConfig? config, Set<String>? allowedRoles, this.retryDelay = Duration.zero})
      : adapter = FakeAdapter(responder),
        store = MemoryTokenStore(),
        config = config ?? const AppConfig(baseUrl: 'https://api.test', appId: 'com.test.app') {
    final dio = Dio()..httpClientAdapter = adapter;
    client = ApiClient(this.config, dio: dio, retryBaseDelay: retryDelay);
    session = SessionManager(client: client, store: store, config: this.config, allowedRoles: allowedRoles);
  }
  final FakeAdapter adapter;
  final MemoryTokenStore store;
  final AppConfig config;
  final Duration retryDelay;
  late final ApiClient client;
  late final SessionManager session;
}

Map<String, dynamic> userJson({String role = 'customer', String id = 'u1'}) =>
    {'id': id, 'email': 'a@b.co', 'name': 'Test User', 'role': role, 'permissions': <String>[], 'emailVerified': true};
