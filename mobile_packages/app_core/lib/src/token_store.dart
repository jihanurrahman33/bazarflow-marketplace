import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists ONLY the refresh token (opaque, server-rotated). The short-lived access token stays in memory.
abstract interface class TokenStore {
  Future<String?> readRefreshToken();
  Future<void> writeRefreshToken(String token);

  /// Removes the refresh token. The installation id survives sign-out (it identifies this app install, not a user).
  Future<void> clear();

  /// Stable random id for this install, used to register the device for push notifications.
  Future<String> installationId();
}

/// Backed by the platform keystore (Keychain / EncryptedSharedPreferences). Never use Hive or prefs for this.
class SecureTokenStore implements TokenStore {
  SecureTokenStore({FlutterSecureStorage? storage, this.namespace = 'bazarflow'}) : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;
  final String namespace;
  String get _key => '$namespace.refresh_token';

  @override
  Future<String?> readRefreshToken() async {
    try {
      return await _storage.read(key: _key);
    } catch (_) {
      return null; // unreadable keystore (e.g. after restore): behave as signed out rather than crash
    }
  }

  @override
  Future<void> writeRefreshToken(String token) => _storage.write(key: _key, value: token);
  @override
  Future<void> clear() => _storage.delete(key: _key);

  @override
  Future<String> installationId() async {
    final key = '$namespace.installation_id';
    try {
      final existing = await _storage.read(key: key);
      if (existing != null && existing.length >= 8) return existing;
    } catch (_) {/* fall through and mint a new one */}
    final r = Random.secure();
    final id = 'inst-${List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join()}';
    try {
      await _storage.write(key: key, value: id);
    } catch (_) {/* best effort */}
    return id;
  }
}

class MemoryTokenStore implements TokenStore {
  String? _token;
  @override
  Future<String?> readRefreshToken() async => _token;
  @override
  Future<void> writeRefreshToken(String token) async => _token = token;
  @override
  Future<void> clear() async => _token = null;
  @override
  Future<String> installationId() async => _id ??= 'inst-memory-0001';
  String? _id;
}
