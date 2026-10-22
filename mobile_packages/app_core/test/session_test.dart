import 'package:app_core/app_core.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:app_core/testing.dart';

Future<ApiException?> failureOf(Future<Object?> call) => call.then<ApiException?>((_) => null, onError: (Object e) => e as ApiException);

void main() {
  FakeReply loginReply(String role) => FakeReply.ok({
        'user': userJson(role: role),
        'tokens': {'accessToken': 'at-1', 'refreshToken': 'rt-1', 'expiresIn': 900, 'tokenType': 'Bearer'},
      });

  test('login stores only the refresh token in the secure store and keeps the access token in memory', () async {
    final rig = TestRig((_) => loginReply('customer'));
    final user = await rig.session.login('a@b.co', 'password-123');
    expect(user.role, 'customer');
    expect(rig.session.accessToken, 'at-1');
    expect(await rig.store.readRefreshToken(), 'rt-1');
    expect(rig.session.state, SignedIn(user));
    final body = rig.adapter.requests.single.body!;
    expect(body, contains('"platform":"android"'));
    expect(body, contains('com.test.app'));
  });

  test('bootstrap with no stored session is signed out; with one it refreshes then loads the profile', () async {
    var rig = TestRig((_) => FakeReply.ok({}));
    await rig.session.bootstrap();
    expect(rig.session.state, const SignedOut());

    rig = TestRig((req) => req.path == '/auth/refresh' ? FakeReply.ok({'accessToken': 'at-2', 'refreshToken': 'rt-2'}) : FakeReply.ok(userJson()));
    await rig.store.writeRefreshToken('rt-1');
    await rig.session.bootstrap();
    expect(rig.session.state, isA<SignedIn>());
    expect(await rig.store.readRefreshToken(), 'rt-2');
  });

  test('bootstrap offline reports "unavailable" and KEEPS the stored session', () async {
    final rig = TestRig((_) => FakeReply.error(503, 'INTERNAL'));
    await rig.store.writeRefreshToken('rt-1');
    await rig.session.bootstrap();
    expect(rig.session.state, const SessionUnavailable());
    expect(await rig.store.readRefreshToken(), 'rt-1');
  });

  test('bootstrap with a revoked refresh token signs out and clears it', () async {
    final rig = TestRig((_) => FakeReply.error(401, 'REFRESH_TOKEN_INVALID'));
    await rig.store.writeRefreshToken('rt-dead');
    await rig.session.bootstrap();
    expect(rig.session.state, const SignedOut(reason: 'expired'));
    expect(await rig.store.readRefreshToken(), isNull);
  });

  test('an app restricted to admins refuses other accounts and does not keep their session', () async {
    final rig = TestRig((req) => req.path == '/auth/logout' ? FakeReply(204) : loginReply('customer'), allowedRoles: {'admin'});
    final e = await failureOf(rig.session.login('a@b.co', 'password-123'));
    expect(e!.code, 'WRONG_APP');
    expect(rig.session.state, isNot(isA<SignedIn>()));
    expect(await rig.store.readRefreshToken(), isNull);
    expect(rig.adapter.requests.last.path, '/auth/logout'); // the server session is closed too
  });

  test('logout always clears local state even if the server is unreachable', () async {
    final rig = TestRig((req) => req.path == '/auth/logout' ? FakeReply.error(503, 'INTERNAL') : loginReply('customer'));
    await rig.session.login('a@b.co', 'password-123');
    await rig.session.logout();
    expect(rig.session.state, const SignedOut());
    expect(rig.session.accessToken, isNull);
    expect(await rig.store.readRefreshToken(), isNull);
  });

  test('failed login leaves the app signed out and surfaces the typed error', () async {
    final rig = TestRig((_) => FakeReply.error(401, 'INVALID_CREDENTIALS'));
    final e = await failureOf(rig.session.login('a@b.co', 'nope-nope-nope'));
    expect(e!.userMessage, 'Email or password is incorrect.');
    expect(rig.session.state, isNot(isA<SignedIn>()));
  });

  test('device registrar uses a stable installation id and tolerates failures on unregister', () async {
    final rig = TestRig((req) => req.method == 'DELETE' ? FakeReply.error(500, 'INTERNAL') : FakeReply(201, {'data': {'registered': true}}));
    final reg = DeviceRegistrar(client: rig.client, store: rig.store, appId: 'com.test.app', platform: 'android');
    await reg.register('push-token-123456');
    await reg.unregister(); // must not throw
    expect(rig.adapter.requests.first.body, contains('inst-memory-0001'));
    expect(rig.adapter.requests.first.body, contains('push-token-123456'));
  });
}
