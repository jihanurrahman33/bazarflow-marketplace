import 'dart:async';

import 'package:equatable/equatable.dart';

import 'api_client.dart';
import 'config.dart';
import 'errors.dart';
import 'token_store.dart';

class SessionUser extends Equatable {
  const SessionUser({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
    this.permissions = const [],
    this.vendorId,
    this.emailVerified = false,
  });

  factory SessionUser.fromJson(Map<String, dynamic> j) => SessionUser(
        id: j['id'] as String,
        email: j['email'] as String,
        name: j['name'] as String,
        role: j['role'] as String,
        permissions: [for (final p in (j['permissions'] as List<dynamic>? ?? const [])) p as String],
        vendorId: j['vendorId'] as String?,
        emailVerified: j['emailVerified'] == true,
      );

  final String id;
  final String email;
  final String name;
  final String role; // customer | vendor | admin
  final List<String> permissions;
  final String? vendorId;
  final bool emailVerified;

  bool can(String permission) => permissions.contains(permission);
  @override
  List<Object?> get props => [id, email, name, role, permissions, vendorId, emailVerified];
}

sealed class SessionState extends Equatable {
  const SessionState();
  @override
  List<Object?> get props => [];
}

/// App just started; checking for a stored session.
class SessionBooting extends SessionState {
  const SessionBooting();
}

class SignedOut extends SessionState {
  const SignedOut({this.reason});

  /// `expired` when the server ended the session, null for a normal sign-out.
  final String? reason;
  @override
  List<Object?> get props => [reason];
}

class SignedIn extends SessionState {
  const SignedIn(this.user);
  final SessionUser user;
  @override
  List<Object?> get props => [user];
}

/// A stored session exists but could not be verified (offline). Offer "Retry", do not sign the user out.
class SessionUnavailable extends SessionState {
  const SessionUnavailable();
}

/// Owns tokens: access token in memory, refresh token in the secure store. One refresh at a time, ever.
class SessionManager implements AuthSession {
  SessionManager({required this.client, required this.store, required this.config, this.allowedRoles}) {
    client.auth = this;
  }

  final ApiClient client;
  final TokenStore store;
  final AppConfig config;

  /// An app can restrict who may sign in (the admin app only accepts admins).
  final Set<String>? allowedRoles;

  /// Supplied by the UI: asks the user for their password for a high-risk action. Return null if they cancel.
  Future<String?> Function()? requestPassword;

  final _controller = StreamController<SessionState>.broadcast();
  SessionState _state = const SessionBooting();
  String? _accessToken;
  Future<bool>? _refreshing;

  SessionState get state => _state;
  Stream<SessionState> get states => _controller.stream;
  SessionUser? get user => switch (_state) { SignedIn(:final user) => user, _ => null };

  @override
  String? get accessToken => _accessToken;

  void _emit(SessionState s) {
    if (_state == s) return;
    _state = s;
    _controller.add(s);
  }

  Map<String, dynamic> get _device => {'platform': config.platform, 'appId': config.appId};

  Future<void> bootstrap() async {
    final rt = await store.readRefreshToken();
    if (rt == null) return _emit(const SignedOut());
    try {
      if (!await refresh()) return; // refresh() already moved us to SignedOut(expired)
      await _loadProfile();
    } on ApiException catch (e) {
      _emit(e.isNetwork || e.status >= 500 ? const SessionUnavailable() : const SignedOut(reason: 'expired'));
    }
  }

  Future<void> _loadProfile() async {
    final res = await client.get('/me');
    final u = SessionUser.fromJson(res.map);
    if (allowedRoles != null && !allowedRoles!.contains(u.role)) {
      await _clear();
      _emit(const SignedOut(reason: 'wrong_app'));
      return;
    }
    _emit(SignedIn(u));
  }

  Future<SessionUser> login(String email, String password) async {
    final res = await client.post('/auth/login', body: {'email': email, 'password': password, 'device': _device}, authenticated: false);
    return _accept(res);
  }

  Future<SessionUser> register({required String name, required String email, required String password, String? phone}) async {
    final res = await client.post(
      '/auth/register',
      body: {'name': name, 'email': email, 'password': password, if (phone != null && phone.isNotEmpty) 'phone': phone, 'device': _device},
      authenticated: false,
    );
    return _accept(res);
  }

  Future<SessionUser> _accept(ApiResponse res) async {
    final user = SessionUser.fromJson(res.map['user'] as Map<String, dynamic>);
    if (allowedRoles != null && !allowedRoles!.contains(user.role)) {
      // Authenticated, but this app is not for that kind of account. Do not keep the session.
      try {
        await client.post('/auth/logout', body: {'refreshToken': (res.map['tokens'] as Map<String, dynamic>)['refreshToken']}, authenticated: false);
      } catch (_) {/* best effort */}
      throw const ApiException(status: 403, code: 'WRONG_APP', message: 'This account cannot be used in this app.');
    }
    final tokens = res.map['tokens'] as Map<String, dynamic>;
    _accessToken = tokens['accessToken'] as String;
    await store.writeRefreshToken(tokens['refreshToken'] as String);
    _emit(SignedIn(user));
    return user;
  }

  void updateUser(SessionUser user) {
    if (_state is SignedIn) _emit(SignedIn(user));
  }

  Future<void> reloadProfile() => _loadProfile();

  /// Single-flight refresh. Network failure keeps the session; a rejected refresh token ends it.
  @override
  Future<bool> refresh() => _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);

  Future<bool> _doRefresh() async {
    final rt = await store.readRefreshToken();
    if (rt == null) {
      await _expire();
      return false;
    }
    try {
      final res = await client.post('/auth/refresh', body: {'refreshToken': rt, 'device': _device}, authenticated: false);
      _accessToken = res.map['accessToken'] as String;
      await store.writeRefreshToken(res.map['refreshToken'] as String);
      return true;
    } on ApiException catch (e) {
      if (e.status == 401 || e.status == 403) {
        await _expire();
        return false;
      }
      rethrow;
    }
  }

  Future<void> _expire() async {
    await _clear();
    _emit(const SignedOut(reason: 'expired'));
  }

  Future<void> _clear() async {
    _accessToken = null;
    await store.clear();
  }

  Future<void> logout() async {
    final rt = await store.readRefreshToken();
    try {
      if (rt != null) await client.post('/auth/logout', body: {'refreshToken': rt}, authenticated: false);
    } catch (_) {/* signing out locally must always work */}
    await _clear();
    _emit(const SignedOut());
  }

  Future<void> logoutAll() async {
    try {
      await client.post('/auth/logout-all');
    } catch (_) {/* best effort */}
    await _clear();
    _emit(const SignedOut());
  }

  @override
  Future<bool> stepUp() async {
    final ask = requestPassword;
    if (ask == null) return false;
    final password = await ask();
    if (password == null || password.isEmpty) return false;
    await client.post('/auth/step-up', body: {'password': password}); // throws INVALID_CREDENTIALS to the caller
    return true;
  }

  Future<void> dispose() => _controller.close();
}
