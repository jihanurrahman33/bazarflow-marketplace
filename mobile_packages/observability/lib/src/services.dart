import 'package:flutter/foundation.dart';

import 'events.dart';

abstract interface class AnalyticsService {
  Future<void> log(String event, [Map<String, Object?> params = const {}]);
  Future<void> setUserRole(String? role);
}

abstract interface class CrashReporter {
  Future<void> recordError(Object error, StackTrace? stack, {bool fatal = false, String? reason});

  /// Short breadcrumb. Never put PII, tokens or provider payloads in here.
  Future<void> breadcrumb(String message);

  /// Opaque account id only (never email/name).
  Future<void> setUserId(String? id);
}

class NoopAnalytics implements AnalyticsService {
  @override
  Future<void> log(String event, [Map<String, Object?> params = const {}]) async {}
  @override
  Future<void> setUserRole(String? role) async {}
}

class NoopCrashReporter implements CrashReporter {
  @override
  Future<void> recordError(Object error, StackTrace? stack, {bool fatal = false, String? reason}) async {
    if (kDebugMode) debugPrint('error (not reported): ${error.runtimeType}');
  }

  @override
  Future<void> breadcrumb(String message) async {}
  @override
  Future<void> setUserId(String? id) async {}
}

/// Test double that records what would have been sent.
class RecordingAnalytics implements AnalyticsService {
  final events = <(String, Map<String, Object>)>[];
  String? role;
  @override
  Future<void> log(String event, [Map<String, Object?> params = const {}]) async {
    assert(AnalyticsEvents.all.contains(event), 'Unknown analytics event: $event');
    events.add((event, sanitizeParams(params)));
  }

  @override
  Future<void> setUserRole(String? r) async => role = r;
}
