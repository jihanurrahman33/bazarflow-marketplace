import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'events.dart';
import 'services.dart';

class FirebaseAnalyticsService implements AnalyticsService {
  FirebaseAnalyticsService(this._fa);
  final FirebaseAnalytics _fa;

  @override
  Future<void> log(String event, [Map<String, Object?> params = const {}]) async {
    if (!AnalyticsEvents.all.contains(event)) return; // unknown events are dropped, never invented at call sites
    try {
      await _fa.logEvent(name: firebaseEventName(event), parameters: sanitizeParams(params));
    } catch (_) {/* analytics must never break a flow */}
  }

  @override
  Future<void> setUserRole(String? role) async {
    try {
      await _fa.setUserProperty(name: 'role', value: role);
    } catch (_) {}
  }
}

class FirebaseCrashReporter implements CrashReporter {
  FirebaseCrashReporter(this._fc);
  final FirebaseCrashlytics _fc;

  @override
  Future<void> recordError(Object error, StackTrace? stack, {bool fatal = false, String? reason}) async {
    try {
      await _fc.recordError(error, stack, fatal: fatal, reason: reason);
    } catch (_) {}
  }

  @override
  Future<void> breadcrumb(String message) async {
    try {
      await _fc.log(message.length > 120 ? message.substring(0, 120) : message);
    } catch (_) {}
  }

  @override
  Future<void> setUserId(String? id) async {
    try {
      await _fc.setUserIdentifier(id ?? '');
    } catch (_) {}
  }
}

/// FCM adapter for the app_core [PushService] boundary.
class FcmPushService implements PushService {
  FcmPushService(this._fm);
  final FirebaseMessaging _fm;
  final _opened = StreamController<String?>.broadcast();

  @override
  Future<void> init() async {
    FirebaseMessaging.onMessageOpenedApp.listen((m) => _opened.add(m.data['deepLink'] as String?));
    // Cold start from a tapped notification.
    final initial = await _fm.getInitialMessage();
    if (initial != null) scheduleMicrotask(() => _opened.add(initial.data['deepLink'] as String?));
  }

  @override
  Future<bool> requestPermission() async {
    final s = await _fm.requestPermission();
    return s.authorizationStatus == AuthorizationStatus.authorized || s.authorizationStatus == AuthorizationStatus.provisional;
  }

  // The registration-token API is deprecated in favour of Firebase Installation IDs (register()/onRegistered).
  // We keep it because our server-side sender targets classic FCM tokens (HTTP v1 `token`); migrate both together.
  @override
  Future<String?> token() async {
    try {
      // ignore: deprecated_member_use
      return await _fm.getToken();
    } catch (_) {
      return null;
    }
  }

  @override
  // ignore: deprecated_member_use
  Stream<String> get onTokenRefresh => _fm.onTokenRefresh;

  @override
  Stream<PushMessage> get onForegroundMessage => FirebaseMessaging.onMessage.where((m) => m.notification != null).map(
        (m) => PushMessage(title: m.notification!.title ?? '', body: m.notification!.body ?? '', deepLink: m.data['deepLink'] as String?),
      );

  @override
  Stream<String?> get onOpenedLink => _opened.stream;
}

class ObservabilityBundle {
  const ObservabilityBundle({required this.analytics, required this.crash, required this.push, required this.firebaseReady});
  final AnalyticsService analytics;
  final CrashReporter crash;
  final PushService push;
  final bool firebaseReady;
}

/// Initialise Firebase if the app was built with its config files; otherwise run with safe no-ops.
/// (Run `flutterfire configure` per app/environment to enable it — see docs/16.)
Future<ObservabilityBundle> initObservability({bool enableFirebase = true}) async {
  if (!enableFirebase) return _noop(false);
  try {
    await Firebase.initializeApp();
  } catch (e) {
    if (kDebugMode) debugPrint('Firebase not configured; analytics/crash/push disabled (${e.runtimeType}).');
    return _noop(false);
  }
  final crash = FirebaseCrashReporter(FirebaseCrashlytics.instance);
  await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(!kDebugMode);
  FlutterError.onError = (details) => FirebaseCrashlytics.instance.recordFlutterFatalError(details);
  PlatformDispatcher.instance.onError = (error, stack) {
    unawaited(crash.recordError(error, stack, fatal: true));
    return true;
  };
  final push = FcmPushService(FirebaseMessaging.instance);
  await push.init();
  return ObservabilityBundle(analytics: FirebaseAnalyticsService(FirebaseAnalytics.instance), crash: crash, push: push, firebaseReady: true);
}

ObservabilityBundle _noop(bool ready) => ObservabilityBundle(analytics: NoopAnalytics(), crash: NoopCrashReporter(), push: NoopPushService(), firebaseReady: ready);
