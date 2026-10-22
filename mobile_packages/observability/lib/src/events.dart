/// Central analytics event catalogue (docs/13 §2). Only these names may be logged; nothing is free-form.
/// Analytics is NOT the financial system of record: orders, payments and the ledger on the server are.
abstract final class AnalyticsEvents {
  static const productViewed = 'catalog.product_viewed';
  static const searchPerformed = 'catalog.search_performed';
  static const cartItemAdded = 'cart.item_added';
  static const checkoutStarted = 'checkout.started';
  static const checkoutCompleted = 'checkout.completed';
  static const paymentAttemptCreated = 'payment.attempt_created';
  static const paymentConfirmed = 'payment.confirmed';
  static const paymentFailed = 'payment.failed';
  static const orderVendorOrderShipped = 'order.vendor_order_shipped';
  static const refundCompleted = 'refund.completed';
  static const authLogin = 'auth.login';
  static const authRegister = 'auth.register';
  static const authLogout = 'auth.logout';
  static const screenViewed = 'app.screen_viewed';
  static const notificationOpened = 'app.notification_opened';
  static const actionFailed = 'app.action_failed';

  static const all = {
    productViewed, searchPerformed, cartItemAdded, checkoutStarted, checkoutCompleted, paymentAttemptCreated, paymentConfirmed, paymentFailed,
    orderVendorOrderShipped, refundCompleted, authLogin, authRegister, authLogout, screenViewed, notificationOpened, actionFailed,
  };
}

/// Only these parameter names are ever sent. Everything else is dropped, not scrubbed after the fact.
const _allowedParams = {'screen', 'status', 'result', 'method', 'count', 'role', 'step', 'error_code', 'currency', 'source', 'sort', 'has_query'};

final _email = RegExp(r'[^\s@]+@[^\s@]+\.[^\s@]+');
final _longDigits = RegExp(r'\d{7,}');
final _tokenish = RegExp(r'(eyJ[A-Za-z0-9_-]{10,}|bearer\s|[A-Za-z0-9+/_-]{32,})', caseSensitive: false);

/// Allow-list filter for analytics/crash parameters. Values must be primitives and must not look like PII or secrets.
Map<String, Object> sanitizeParams(Map<String, Object?> params) {
  final out = <String, Object>{};
  for (final entry in params.entries) {
    if (!_allowedParams.contains(entry.key)) continue;
    final v = entry.value;
    if (v is num || v is bool) {
      out[entry.key] = v!;
    } else if (v is String) {
      final s = v.length > 40 ? v.substring(0, 40) : v;
      if (_email.hasMatch(s) || _longDigits.hasMatch(s) || _tokenish.hasMatch(s)) continue;
      out[entry.key] = s;
    }
  }
  return out;
}

/// Firebase event names allow only letters, digits and underscores.
String firebaseEventName(String event) => event.replaceAll('.', '_');
