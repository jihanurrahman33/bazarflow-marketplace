import 'package:flutter_test/flutter_test.dart';
import 'package:observability/observability.dart';

void main() {
  group('parameter redaction (allow-list)', () {
    test('keeps only approved, primitive, non-PII parameters', () {
      final out = sanitizeParams({
        'screen': 'order_detail', 'status': 'delivered', 'count': 3, 'currency': 'BDT', 'has_query': true,
        'email': 'rahim@example.com', 'address': 'House 5, Road 3', 'token': 'abc', 'order_id': '0123456789abcdef01234567', 'payload': {'x': 1},
      });
      expect(out, {'screen': 'order_detail', 'status': 'delivered', 'count': 3, 'currency': 'BDT', 'has_query': true});
    });

    test('drops approved keys whose VALUE looks like PII or a secret', () {
      final out = sanitizeParams({
        'screen': 'rahim@example.com', 'status': '8801712345678', 'result': 'eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop', 'method': 'Bearer abcdef',
        'source': 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7', 'step': 'checkout',
      });
      expect(out, {'step': 'checkout'});
    });

    test('truncates long strings', () {
      expect(sanitizeParams({'screen': 'order detail screen ' * 5})['screen'], hasLength(40));
      expect(sanitizeParams({'screen': 'x' * 100}).containsKey('screen'), isFalse); // one long opaque run looks like a secret
    });
  });

  group('event catalogue', () {
    test('uses Firebase-safe names and the documented event set', () {
      for (final e in AnalyticsEvents.all) {
        expect(firebaseEventName(e), matches(RegExp(r'^[A-Za-z][A-Za-z0-9_]{0,39}$')), reason: e);
      }
      expect(AnalyticsEvents.all, containsAll(['checkout.started', 'checkout.completed', 'payment.confirmed', 'refund.completed']));
    });

    test('recording analytics sanitizes parameters', () async {
      final a = RecordingAnalytics();
      await a.log(AnalyticsEvents.checkoutStarted, {'count': 2, 'email': 'a@b.co', 'method': 'online'});
      expect(a.events.single.$2, {'count': 2, 'method': 'online'});
    });

    test('unconfigured Firebase falls back to safe no-ops', () async {
      final b = await initObservability(enableFirebase: false);
      expect(b.firebaseReady, isFalse);
      await b.analytics.log(AnalyticsEvents.screenViewed, {'screen': 'home'});
      await b.crash.recordError(StateError('x'), StackTrace.current);
      expect(await b.push.requestPermission(), isFalse);
    });
  });
}
