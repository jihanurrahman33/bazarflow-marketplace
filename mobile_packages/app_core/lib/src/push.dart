import 'api_client.dart';
import 'token_store.dart';

/// A notification the user tapped. Only allow-listed in-app routes are ever opened.
class DeepLink {
  const DeepLink(this.route);
  final String route;
}

/// Accepts `/orders/<id>`-style paths only. Anything else (other hosts, odd characters) is dropped.
DeepLink? safeDeepLink(String? raw, List<RegExp> allowed) {
  if (raw == null || raw.length > 200 || !raw.startsWith('/') || raw.startsWith('//')) return null;
  for (final pattern in allowed) {
    if (pattern.hasMatch(raw)) return DeepLink(raw);
  }
  return null;
}

class PushMessage {
  const PushMessage({required this.title, required this.body, this.deepLink});
  final String title;
  final String body;
  final String? deepLink;
}

/// Platform push boundary (FCM implementation lives in the `observability` package).
abstract interface class PushService {
  Future<void> init();
  Future<bool> requestPermission();
  Future<String?> token();
  Stream<String> get onTokenRefresh;
  Stream<PushMessage> get onForegroundMessage;

  /// Taps from background AND from a cold start.
  Stream<String?> get onOpenedLink;
}

class NoopPushService implements PushService {
  @override
  Future<void> init() async {}
  @override
  Future<bool> requestPermission() async => false;
  @override
  Future<String?> token() async => null;
  @override
  Stream<String> get onTokenRefresh => const Stream.empty();
  @override
  Stream<PushMessage> get onForegroundMessage => const Stream.empty();
  @override
  Stream<String?> get onOpenedLink => const Stream.empty();
}

/// Keeps the server's device registry in step with the OS token. Called after sign-in; undone on sign-out.
class DeviceRegistrar {
  DeviceRegistrar({required this.client, required this.store, required this.appId, required this.platform});
  final ApiClient client;
  final TokenStore store;
  final String appId;
  final String platform;

  Future<void> register(String pushToken) async {
    final id = await store.installationId();
    await client.post('/devices', body: {'installationId': id, 'platform': platform, 'appId': appId, 'pushToken': pushToken});
  }

  Future<void> unregister() async {
    final id = await store.installationId();
    try {
      await client.delete('/devices/$id');
    } catch (_) {/* signing out must not fail because of this */}
  }
}
