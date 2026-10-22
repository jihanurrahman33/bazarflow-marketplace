import 'dart:convert';

import 'package:app_core/app_core.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers.dart';

Future<ApiException?> failureOf(Future<Object?> call) => call.then<ApiException?>((_) => null, onError: (Object e) => e as ApiException);

void main() {
  group('response parsing', () {
    test('unwraps data and paging meta', () async {
      final rig = TestRig((_) => FakeReply.ok([1, 2], meta: {'nextCursor': 'abc', 'hasMore': true}));
      final res = await rig.client.get('/orders');
      expect(res.list, [1, 2]);
      expect(res.nextCursor, 'abc');
      expect(res.hasMore, isTrue);
    });

    test('turns error envelopes into typed exceptions with field details and request id', () async {
      final rig = TestRig((_) => FakeReply.error(400, 'VALIDATION_FAILED', details: [
            {'field': 'email', 'code': 'INVALID_FORMAT'}
          ]));
      final e = await failureOf(rig.client.post('/auth/register', body: {}));
      expect(e, isNotNull);
      expect(e!.status, 400);
      expect(e.code, 'VALIDATION_FAILED');
      expect(e.fieldError('email'), 'INVALID_FORMAT');
      expect(e.requestId, 'req-test');
      expect(e.retryable, isFalse);
    });

    test('a non-JSON error page (proxy/CDN) never crashes the parser and 5xx copy hides server text', () async {
      final rig = TestRig((_) => FakeReply(502, null, '<html>Bad gateway</html>'));
      final e = await failureOf(rig.client.post('/checkout', body: {}));
      expect(e!.status, 502);
      expect(e.retryable, isTrue);
      expect(e.userMessage, isNot(contains('html')));
    });

    test('204 responses are fine', () async {
      final rig = TestRig((_) => FakeReply(204));
      expect((await rig.client.delete('/devices/x')).status, 204);
    });
  });

  group('request construction', () {
    test('sends bearer token, request id and idempotency key; JSON body', () async {
      final rig = TestRig((_) => FakeReply.ok({'ok': true}));
      rig.client.auth = _StaticAuth('tok-1');
      await rig.client.post('/checkout', body: {'a': 1}, idempotencyKey: 'app-key-0001');
      final r = rig.adapter.requests.single;
      expect(r.path, '/checkout');
      expect(r.headers['authorization'], 'Bearer tok-1');
      expect(r.headers['idempotency-key'], 'app-key-0001');
      expect((r.headers['x-request-id'] as String).length, 32);
      expect(jsonDecode(r.body!), {'a': 1});
    });

    test('does not attach the access token to unauthenticated calls', () async {
      final rig = TestRig((_) => FakeReply.ok({}));
      rig.client.auth = _StaticAuth('tok-1');
      await rig.client.post('/auth/login', body: {}, authenticated: false);
      expect(rig.adapter.requests.single.headers.containsKey('authorization'), isFalse);
    });

    test('idempotency keys are unique and well-formed', () {
      final keys = {for (var i = 0; i < 50; i++) newIdempotencyKey()};
      expect(keys.length, 50);
      expect(keys.every((k) => RegExp(r'^app-[0-9a-f]{32}$').hasMatch(k)), isTrue);
    });
  });

  group('retry policy', () {
    test('GET retries transient failures a bounded number of times, then fails', () async {
      var calls = 0;
      final rig = TestRig((_) {
        calls++;
        return FakeReply.error(503, 'INTERNAL');
      });
      final e = await failureOf(rig.client.get('/products'));
      expect(e!.status, 503);
      expect(calls, 3); // 1 try + 2 retries
    });

    test('mutations are NEVER retried automatically, even on 5xx', () async {
      var calls = 0;
      final rig = TestRig((_) {
        calls++;
        return FakeReply.error(503, 'INTERNAL');
      });
      await failureOf(rig.client.post('/checkout', body: {}, idempotencyKey: 'app-key-0002'));
      expect(calls, 1);
    });

    test('GET succeeds if a retry recovers', () async {
      var calls = 0;
      final rig = TestRig((_) => ++calls < 2 ? FakeReply.error(504, 'INTERNAL') : FakeReply.ok(['ok']));
      expect((await rig.client.get('/products')).list, ['ok']);
    });
  });

  group('token renewal', () {
    test('expired token: refresh once, replay the original request, success', () async {
      var refreshed = false;
      final rig = TestRig((req) {
        if (req.path == '/auth/refresh') {
          refreshed = true;
          return FakeReply.ok({'accessToken': 'new', 'refreshToken': 'rt-2', 'expiresIn': 900});
        }
        return refreshed && req.headers['authorization'] == 'Bearer new' ? FakeReply.ok({'id': 1}) : FakeReply.error(401, 'TOKEN_EXPIRED');
      });
      await rig.store.writeRefreshToken('rt-1');
      final res = await rig.client.get('/orders');
      expect(res.map['id'], 1);
      expect(await rig.store.readRefreshToken(), 'rt-2');
    });

    test('five simultaneous 401s trigger exactly ONE refresh', () async {
      var refreshCalls = 0;
      var fresh = false;
      final rig = TestRig((req) async {
        if (req.path == '/auth/refresh') {
          refreshCalls++;
          await Future<void>.delayed(const Duration(milliseconds: 30));
          fresh = true;
          return FakeReply.ok({'accessToken': 'new', 'refreshToken': 'rt-2'});
        }
        return fresh ? FakeReply.ok({'path': req.path}) : FakeReply.error(401, 'TOKEN_EXPIRED');
      });
      await rig.store.writeRefreshToken('rt-1');
      final results = await Future.wait<ApiResponse>([for (var i = 0; i < 5; i++) rig.client.get('/r$i')]);
      expect(results.map((r) => r.map['path']), ['/r0', '/r1', '/r2', '/r3', '/r4']);
      expect(refreshCalls, 1);
    });

    test('refresh rejected: signs out, surfaces 401, does not loop', () async {
      var calls = 0;
      final rig = TestRig((req) {
        calls++;
        return req.path == '/auth/refresh' ? FakeReply.error(401, 'REFRESH_TOKEN_INVALID') : FakeReply.error(401, 'TOKEN_EXPIRED');
      });
      await rig.store.writeRefreshToken('rt-1');
      final states = <SessionState>[];
      rig.session.states.listen(states.add);
      final e = await failureOf(rig.client.get('/orders'));
      await Future<void>.delayed(Duration.zero);
      expect(e!.status, 401);
      expect(calls, 2); // original + one refresh; no replay
      expect(await rig.store.readRefreshToken(), isNull);
      expect(states.last, const SignedOut(reason: 'expired'));
    });

    test('network failure during refresh keeps the session instead of logging out', () async {
      final rig = TestRig((req) => req.path == '/auth/refresh' ? FakeReply.error(503, 'INTERNAL') : FakeReply.error(401, 'TOKEN_EXPIRED'));
      await rig.store.writeRefreshToken('rt-1');
      await failureOf(rig.client.get('/orders'));
      expect(await rig.store.readRefreshToken(), 'rt-1');
    });
  });

  group('step-up', () {
    test('asks for the password once, then replays the rejected request', () async {
      var stepped = false;
      final rig = TestRig((req) {
        if (req.path == '/auth/step-up') {
          stepped = true;
          return FakeReply.ok({'expiresInSeconds': 300});
        }
        return stepped ? FakeReply.ok({'approved': true}) : FakeReply.error(403, 'STEP_UP_REQUIRED');
      });
      var prompts = 0;
      rig.session.requestPassword = () async {
        prompts++;
        return 'secret-password';
      };
      final res = await rig.client.post('/admin/payouts/1/approve');
      expect(res.map['approved'], isTrue);
      expect(prompts, 1);
    });

    test('cancelled prompt returns the original error; wrong password surfaces INVALID_CREDENTIALS', () async {
      final rig = TestRig((req) => req.path == '/auth/step-up' ? FakeReply.error(401, 'INVALID_CREDENTIALS') : FakeReply.error(403, 'STEP_UP_REQUIRED'));
      rig.session.requestPassword = () async => null;
      var e = await failureOf(rig.client.post('/x'));
      expect(e!.stepUpRequired, isTrue);
      rig.session.requestPassword = () async => 'wrong';
      e = await failureOf(rig.client.post('/x'));
      expect(e!.code, 'INVALID_CREDENTIALS');
    });
  });

  group('config', () {
    test('rejects insecure production URLs and trailing slashes', () {
      expect(() => const AppConfig(baseUrl: 'http://api.example.com', appId: 'a', environment: 'production').validate(), throwsArgumentError);
      expect(() => const AppConfig(baseUrl: 'https://api.example.com/', appId: 'a').validate(), throwsArgumentError);
      expect(() => const AppConfig(baseUrl: 'not a url', appId: 'a').validate(), throwsArgumentError);
      const AppConfig(baseUrl: 'https://api.example.com', appId: 'a', environment: 'production').validate();
    });
  });

  group('money', () {
    test('formats minor units and parses user input without floating point', () {
      expect(formatMoney(250000), '৳2,500.00');
      expect(formatMoney(5), '৳0.05');
      expect(formatMoney(-12050), '-৳120.50');
      expect(formatMoney(123456789), '৳1,234,567.89');
      expect(parseMoneyInput('1200'), 120000);
      expect(parseMoneyInput('1200.5'), 120050);
      for (final bad in ['', 'abc', '12.345', '-5', '1e3', '1,200', '12.']) {
        expect(parseMoneyInput(bad), isNull, reason: bad);
      }
    });
  });

  group('deep links', () {
    final allowed = [RegExp(r'^/orders/[0-9a-f]{24}$'), RegExp(r'^/vendor/orders/[0-9a-f]{24}$')];
    test('accepts allow-listed routes only', () {
      expect(safeDeepLink('/orders/0123456789abcdef01234567', allowed)?.route, '/orders/0123456789abcdef01234567');
      for (final bad in [null, '', 'https://evil.example/orders/x', '//evil.example', '/admin/users', '/orders/../../etc', '/orders/ZZZ', 'orders/1']) {
        expect(safeDeepLink(bad, allowed), isNull, reason: '$bad');
      }
    });
  });
}

class _StaticAuth implements AuthSession {
  _StaticAuth(this.accessToken);
  @override
  final String? accessToken;
  @override
  Future<bool> refresh() async => false;
  @override
  Future<bool> stepUp() async => false;
}
