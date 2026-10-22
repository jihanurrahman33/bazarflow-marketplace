import 'dart:convert';
import 'dart:math';

import 'package:dio/dio.dart';

import 'config.dart';
import 'errors.dart';

/// Implemented by the session layer; keeps the HTTP client free of any storage or UI knowledge.
abstract interface class AuthSession {
  String? get accessToken;

  /// Single-flight: concurrent callers share one refresh. Returns false when the session can no longer be renewed.
  Future<bool> refresh();

  /// Called when the server demands password re-entry for a high-risk action. Return true once step-up succeeded.
  Future<bool> stepUp();
}

class ApiResponse {
  const ApiResponse({required this.data, required this.meta, required this.status, this.headers});
  final dynamic data;
  final Map<String, dynamic> meta;
  final int status;
  final Headers? headers;

  String? get nextCursor => meta['nextCursor'] as String?;
  bool get hasMore => meta['hasMore'] == true;
  List<dynamic> get list => (data as List<dynamic>?) ?? const [];
  Map<String, dynamic> get map => (data as Map<String, dynamic>?) ?? const {};
}

String _newRequestId() {
  final r = Random.secure();
  return List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
}

/// Idempotency keys for money-moving mutations. Reuse the SAME key when retrying the same logical action.
String newIdempotencyKey() => 'app-${_newRequestId()}';

class ApiClient {
  ApiClient(this.config, {Dio? dio, this.maxGetRetries = 2, this.retryBaseDelay = const Duration(milliseconds: 300)})
      : dio = dio ?? Dio() {
    this.dio.options = BaseOptions(
      baseUrl: '${config.baseUrl}/api/v1',
      connectTimeout: config.connectTimeout,
      receiveTimeout: config.receiveTimeout,
      sendTimeout: config.receiveTimeout,
      contentType: Headers.jsonContentType,
      responseType: ResponseType.plain, // we decode ourselves so an HTML error page never crashes the JSON parser
      validateStatus: (_) => true, // every response is inspected here, not thrown by Dio
      headers: {'accept': 'application/json'},
    );
  }

  final AppConfig config;
  final Dio dio;
  final int maxGetRetries;
  final Duration retryBaseDelay;
  AuthSession? auth;

  Future<ApiResponse> get(String path, {Map<String, dynamic>? query, bool authenticated = true}) =>
      _send('GET', path, query: query, authenticated: authenticated);
  Future<ApiResponse> post(String path, {Object? body, String? idempotencyKey, bool authenticated = true}) =>
      _send('POST', path, body: body ?? const {}, idempotencyKey: idempotencyKey, authenticated: authenticated);
  Future<ApiResponse> put(String path, {Object? body}) => _send('PUT', path, body: body ?? const {});
  Future<ApiResponse> patch(String path, {Object? body}) => _send('PATCH', path, body: body ?? const {});
  Future<ApiResponse> delete(String path) => _send('DELETE', path);

  Future<ApiResponse> _send(
    String method,
    String path, {
    Map<String, dynamic>? query,
    Object? body,
    String? idempotencyKey,
    bool authenticated = true,
  }) async {
    var refreshed = false;
    var steppedUp = false;
    var attempt = 0;
    final requestId = _newRequestId();
    while (true) {
      final headers = <String, dynamic>{
        'x-request-id': requestId,
        if (authenticated && auth?.accessToken != null) 'authorization': 'Bearer ${auth!.accessToken}',
        'idempotency-key': ?idempotencyKey,
      };
      final Response<dynamic> res;
      try {
        res = await dio.request<dynamic>(path,
            data: body == null ? null : jsonEncode(body), queryParameters: query, options: Options(method: method, headers: headers));
      } on DioException catch (e) {
        final failure = _fromDio(e);
        // Only idempotent reads are retried automatically, a bounded number of times.
        if (method == 'GET' && failure.isNetwork && attempt < maxGetRetries) {
          await Future<void>.delayed(retryBaseDelay * pow(2, attempt).toInt());
          attempt++;
          continue;
        }
        throw failure;
      }

      final parsed = _parse(res);
      if (parsed.error == null) return parsed.response!;
      final err = parsed.error!;

      if (authenticated && !refreshed && auth != null && err.status == 401 && (err.code == 'TOKEN_EXPIRED' || err.code == 'UNAUTHENTICATED')) {
        refreshed = true;
        if (await auth!.refresh()) continue; // the 401 meant "not processed", so replaying is safe
      }
      if (err.stepUpRequired && !steppedUp && auth != null) {
        steppedUp = true;
        if (await auth!.stepUp()) continue;
      }
      if (method == 'GET' && err.status >= 502 && err.status <= 504 && attempt < maxGetRetries) {
        await Future<void>.delayed(retryBaseDelay * pow(2, attempt).toInt());
        attempt++;
        continue;
      }
      throw err;
    }
  }

  ApiException _fromDio(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
        return const ApiException(status: 0, code: ApiException.timeout, message: 'The request timed out.');
      case DioExceptionType.cancel:
        return const ApiException(status: 0, code: ApiException.cancelled, message: 'Cancelled.');
      default:
        return const ApiException(status: 0, code: ApiException.network, message: 'No connection.');
    }
  }

  ({ApiResponse? response, ApiException? error}) _parse(Response<dynamic> res) {
    final status = res.statusCode ?? 0;
    Map<String, dynamic>? json;
    final raw = res.data;
    if (raw is String && raw.isNotEmpty) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is Map<String, dynamic>) json = decoded;
      } catch (_) {/* not JSON (proxy error page): handled below */}
    }
    if (status >= 200 && status < 300 && (json == null || json['error'] == null)) {
      return (
        response: ApiResponse(data: json?['data'], meta: (json?['meta'] as Map<String, dynamic>?) ?? const {}, status: status, headers: res.headers),
        error: null,
      );
    }
    final e = json?['error'] as Map<String, dynamic>?;
    return (
      response: null,
      error: ApiException(
        status: status,
        code: (e?['code'] as String?) ?? (status >= 500 ? 'INTERNAL' : 'UNKNOWN'),
        message: (e?['message'] as String?) ?? 'Unexpected response ($status).',
        requestId: e?['requestId'] as String?,
        details: [
          for (final d in (e?['details'] as List<dynamic>? ?? const []))
            FieldIssue((d as Map<String, dynamic>)['field'] as String? ?? '', d['code'] as String? ?? ''),
        ],
      ),
    );
  }
}
