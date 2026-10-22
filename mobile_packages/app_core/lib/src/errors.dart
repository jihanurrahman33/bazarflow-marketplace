import 'package:equatable/equatable.dart';

/// A field-level problem reported by the API (`details[]`).
class FieldIssue extends Equatable {
  const FieldIssue(this.field, this.code);
  final String field;
  final String code;
  @override
  List<Object?> get props => [field, code];
}

/// Every failed API call surfaces as this type. UI branches on [code] / [status], never on [message].
class ApiException extends Equatable implements Exception {
  const ApiException({
    required this.status,
    required this.code,
    required this.message,
    this.details = const [],
    this.requestId,
  });

  /// HTTP status, or 0 when no response was received.
  final int status;
  final String code;
  final String message;
  final List<FieldIssue> details;
  final String? requestId;

  static const network = 'NETWORK';
  static const timeout = 'TIMEOUT';
  static const cancelled = 'CANCELLED';

  bool get isNetwork => code == network || code == timeout;
  bool get isUnauthenticated => status == 401;
  bool get isForbidden => status == 403;
  bool get isNotFound => status == 404;
  bool get isConflict => status == 409;
  bool get stepUpRequired => code == 'STEP_UP_REQUIRED';

  /// Safe to offer a "Try again" button.
  bool get retryable => isNetwork || status >= 500 || status == 429;

  String? fieldError(String field) {
    for (final d in details) {
      if (d.field == field || d.field.startsWith('$field.')) return d.code;
    }
    return null;
  }

  /// Short copy for the user. Unknown server messages are never shown for 5xx.
  String get userMessage {
    final known = _copy[code];
    if (known != null) return known;
    if (status >= 500) return 'Something went wrong on our side. Please try again.';
    return message;
  }

  @override
  List<Object?> get props => [status, code, message, details, requestId];
  @override
  String toString() => 'ApiException($status $code)';
}

const _copy = <String, String>{
  'INVALID_CREDENTIALS': 'Email or password is incorrect.',
  'EMAIL_TAKEN': 'An account with this email already exists. Try signing in.',
  'INVENTORY_UNAVAILABLE': 'Some items are no longer available in that quantity.',
  'PRODUCT_UNAVAILABLE': 'An item is no longer available.',
  'PRICE_CHANGED': 'Prices changed since you last looked. Please review your order.',
  'CART_EMPTY': 'Your cart is empty.',
  'RATE_LIMITED': 'Too many attempts. Please wait a moment and try again.',
  'IDEMPOTENCY_IN_PROGRESS': 'We are still processing your request. Please wait a moment.',
  'VENDOR_NOT_ACTIVE': 'This store is not active right now.',
  'FORBIDDEN': 'You do not have permission to do that.',
  'ACCOUNT_SUSPENDED': 'This account is suspended. Please contact support.',
  'STEP_UP_REQUIRED': 'Confirm your password to continue.',
  'NETWORK': 'You appear to be offline. Check your connection and try again.',
  'TIMEOUT': 'The request timed out. Please try again.',
};
