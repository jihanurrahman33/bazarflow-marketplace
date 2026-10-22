import 'package:app_core/app_core.dart';
import 'package:equatable/equatable.dart';

class OpsHealth extends Equatable {
  const OpsHealth({required this.deadEvents, required this.pendingEvents, required this.oldestPendingSeconds, required this.unknownPayments, required this.stuckPayments, required this.failedRefunds, required this.payoutsToApprove, required this.payoutsToPay});
  final int deadEvents;
  final int pendingEvents;
  final int oldestPendingSeconds;
  final int unknownPayments;
  final int stuckPayments;
  final int failedRefunds;
  final int payoutsToApprove;
  final int payoutsToPay;

  factory OpsHealth.fromJson(Map<String, dynamic> j) {
    final outbox = j['outbox'] as Map<String, dynamic>;
    final payments = j['payments'] as Map<String, dynamic>;
    final refunds = j['refunds'] as Map<String, dynamic>;
    final payouts = j['payouts'] as Map<String, dynamic>;
    return OpsHealth(
      deadEvents: outbox['dead'] as int,
      pendingEvents: outbox['pending'] as int,
      oldestPendingSeconds: outbox['oldestPendingAgeSeconds'] as int,
      unknownPayments: payments['unknown'] as int,
      stuckPayments: payments['stuckLive'] as int,
      failedRefunds: refunds['failed'] as int,
      payoutsToApprove: payouts['requested'] as int,
      payoutsToPay: payouts['approved'] as int,
    );
  }
  bool get needsAttention => deadEvents > 0 || unknownPayments > 0 || stuckPayments > 0 || failedRefunds > 0;
  @override
  List<Object?> get props => [deadEvents, pendingEvents, oldestPendingSeconds, unknownPayments, stuckPayments, failedRefunds, payoutsToApprove, payoutsToPay];
}

class SalesSummary extends Equatable {
  const SalesSummary({required this.paidOrders, required this.grossMinor, required this.commissionMinor, required this.refundsMinor});
  final int paidOrders;
  final int grossMinor;
  final int commissionMinor;
  final int refundsMinor;
  @override
  List<Object?> get props => [paidOrders, grossMinor, commissionMinor, refundsMinor];
}

class SellerApplication extends Equatable {
  const SellerApplication({required this.id, required this.status, required this.name, required this.slug, required this.phone, required this.address, required this.createdAt});
  final String id;
  final String status;
  final String name;
  final String slug;
  final String phone;
  final String address;
  final DateTime createdAt;
  @override
  List<Object?> get props => [id, status, name, slug, phone, address, createdAt];
}

class ReviewProduct extends Equatable {
  const ReviewProduct({required this.id, required this.title, required this.description, required this.minPriceMinor, required this.imageCount, required this.variantCount});
  final String id;
  final String title;
  final String description;
  final int minPriceMinor;
  final int imageCount;
  final int variantCount;
  @override
  List<Object?> get props => [id, title, description, minPriceMinor, imageCount, variantCount];
}

class PaymentException extends Equatable {
  const PaymentException({required this.id, required this.orderId, required this.reference, required this.status, required this.amountMinor, this.reason});
  final String id;
  final String orderId;
  final String reference;
  final String status;
  final int amountMinor;
  final String? reason;
  @override
  List<Object?> get props => [id, orderId, reference, status, amountMinor, reason];
}

class RefundRequest extends Equatable {
  const RefundRequest({required this.id, required this.orderId, required this.amountMinor, required this.reason, required this.status, required this.system, this.failureReason});
  final String id;
  final String orderId;
  final int amountMinor;
  final String reason;
  final String status;
  final bool system;
  final String? failureReason;
  @override
  List<Object?> get props => [id, orderId, amountMinor, reason, status, system, failureReason];
}

class PayoutRequest extends Equatable {
  const PayoutRequest({required this.id, required this.amountMinor, required this.status, required this.method, required this.accountName, required this.maskedRef, required this.createdAt});
  final String id;
  final int amountMinor;
  final String status;
  final String method;
  final String accountName;
  final String maskedRef;
  final DateTime createdAt;
  @override
  List<Object?> get props => [id, amountMinor, status, method, accountName, maskedRef, createdAt];
}

class OrderRow extends Equatable {
  const OrderRow({required this.id, required this.orderNumber, required this.status, required this.paymentStatus, required this.paymentMethod, required this.totalMinor, required this.createdAt});
  final String id;
  final String orderNumber;
  final String status;
  final String paymentStatus;
  final String paymentMethod;
  final int totalMinor;
  final DateTime createdAt;
  @override
  List<Object?> get props => [id, orderNumber, status, paymentStatus, paymentMethod, totalMinor, createdAt];
}

class OrderSupportView extends Equatable {
  const OrderSupportView({required this.row, required this.buyerName, required this.buyerEmail, required this.sellerOrders, required this.payments, required this.refunds});
  final OrderRow row;
  final String? buyerName;
  final String? buyerEmail;
  final List<({String vendor, String status, int totalMinor, int commissionMinor, int netMinor})> sellerOrders;
  final List<({String reference, String status, int amountMinor, int refundedMinor})> payments;
  final List<({String status, int amountMinor, String reason})> refunds;
  @override
  List<Object?> get props => [row, buyerName, buyerEmail, sellerOrders, payments, refunds];
}

abstract interface class AdminRepository {
  Future<OpsHealth> health();
  Future<SalesSummary> sales(DateTime from, DateTime to);
  Future<PageResult<SellerApplication>> applications({String? cursor});
  Future<void> approveApplication(String id);
  Future<void> rejectApplication(String id, String reason);
  Future<void> requestInfo(String id, String reason);
  Future<PageResult<ReviewProduct>> reviewQueue({String? cursor});
  Future<void> approveProduct(String id);
  Future<void> rejectProduct(String id, String reason);
  Future<PageResult<PaymentException>> paymentExceptions({String? cursor});
  Future<void> reconcile(String paymentId);
  Future<PageResult<RefundRequest>> refunds({String status = 'requested', String? cursor});
  Future<void> approveRefund(String id);
  Future<void> rejectRefund(String id, String reason);
  Future<PageResult<PayoutRequest>> payouts({String status = 'requested', String? cursor});
  Future<void> approvePayout(String id);
  Future<void> rejectPayout(String id, String reason);
  Future<PageResult<OrderRow>> orders({String? orderNumber, String? cursor});
  Future<OrderSupportView> order(String id);
}

OrderRow parseOrderRow(Map<String, dynamic> o) => OrderRow(
      id: o['id'] as String,
      orderNumber: o['orderNumber'] as String,
      status: o['status'] as String,
      paymentStatus: o['paymentStatus'] as String,
      paymentMethod: o['paymentMethod'] as String,
      totalMinor: (o['totals'] as Map<String, dynamic>)['totalMinor'] as int,
      createdAt: DateTime.parse(o['createdAt'] as String),
    );

class ApiAdminRepository implements AdminRepository {
  ApiAdminRepository(this._client);
  final ApiClient _client;

  Future<void> _post(String path, [Object? body]) async {
    await _client.post(path, body: body);
  }

  @override
  Future<OpsHealth> health() async => OpsHealth.fromJson((await _client.get('/admin/ops/health')).map);

  @override
  Future<SalesSummary> sales(DateTime from, DateTime to) async {
    final j = (await _client.get('/admin/reports/sales', query: {'from': from.toUtc().toIso8601String(), 'to': to.toUtc().toIso8601String()})).map;
    return SalesSummary(paidOrders: j['paidOrders'] as int, grossMinor: j['grossMerchandiseMinor'] as int, commissionMinor: j['platformCommissionMinor'] as int, refundsMinor: (j['refunds'] as Map<String, dynamic>)['totalMinor'] as int);
  }

  @override
  Future<PageResult<SellerApplication>> applications({String? cursor}) async {
    final res = await _client.get('/admin/vendor-applications', query: {'limit': 20, 'status': 'submitted', 'cursor': ?cursor});
    return PageResult(nextCursor: res.nextCursor, items: [
      for (final a in res.list.cast<Map<String, dynamic>>())
        SellerApplication(id: a['id'] as String, status: a['status'] as String, name: (a['business'] as Map<String, dynamic>)['name'] as String, slug: (a['business'] as Map<String, dynamic>)['slug'] as String, phone: (a['business'] as Map<String, dynamic>)['phone'] as String, address: (a['business'] as Map<String, dynamic>)['address'] as String, createdAt: DateTime.parse(a['createdAt'] as String)),
    ]);
  }

  @override
  Future<void> approveApplication(String id) => _post('/admin/vendor-applications/$id/approve');
  @override
  Future<void> rejectApplication(String id, String reason) => _post('/admin/vendor-applications/$id/reject', {'reason': reason});
  @override
  Future<void> requestInfo(String id, String reason) => _post('/admin/vendor-applications/$id/request-info', {'reason': reason});

  @override
  Future<PageResult<ReviewProduct>> reviewQueue({String? cursor}) async {
    final res = await _client.get('/admin/products/review-queue', query: {'limit': 20, 'cursor': ?cursor});
    return PageResult(nextCursor: res.nextCursor, items: [
      for (final p in res.list.cast<Map<String, dynamic>>())
        ReviewProduct(id: p['id'] as String, title: p['title'] as String, description: p['description'] as String, minPriceMinor: p['minPriceMinor'] as int, imageCount: (p['media'] as List<dynamic>).length, variantCount: (p['variants'] as List<dynamic>).length),
    ]);
  }

  @override
  Future<void> approveProduct(String id) => _post('/admin/products/$id/approve');
  @override
  Future<void> rejectProduct(String id, String reason) => _post('/admin/products/$id/reject', {'reason': reason});

  @override
  Future<PageResult<PaymentException>> paymentExceptions({String? cursor}) async {
    final res = await _client.get('/admin/payments/reconciliation', query: {'limit': 20, 'cursor': ?cursor});
    return PageResult(nextCursor: res.nextCursor, items: [
      for (final p in res.list.cast<Map<String, dynamic>>())
        PaymentException(id: p['id'] as String, orderId: p['orderId'] as String, reference: p['merchantReference'] as String, status: p['status'] as String, amountMinor: p['amountMinor'] as int, reason: p['failureReason'] as String?),
    ]);
  }

  @override
  Future<void> reconcile(String paymentId) => _post('/admin/payments/$paymentId/reconcile');

  @override
  Future<PageResult<RefundRequest>> refunds({String status = 'requested', String? cursor}) async {
    final res = await _client.get('/admin/refunds', query: {'limit': 20, 'status': status, 'cursor': ?cursor});
    return PageResult(nextCursor: res.nextCursor, items: [
      for (final r in res.list.cast<Map<String, dynamic>>())
        RefundRequest(id: r['id'] as String, orderId: r['orderId'] as String, amountMinor: r['amountMinor'] as int, reason: r['reason'] as String, status: r['status'] as String, system: r['system'] == true, failureReason: r['failureReason'] as String?),
    ]);
  }

  @override
  Future<void> approveRefund(String id) => _post('/admin/refunds/$id/approve');
  @override
  Future<void> rejectRefund(String id, String reason) => _post('/admin/refunds/$id/reject', {'reason': reason});

  @override
  Future<PageResult<PayoutRequest>> payouts({String status = 'requested', String? cursor}) async {
    final res = await _client.get('/admin/payouts', query: {'limit': 20, 'status': status, 'cursor': ?cursor});
    return PageResult(nextCursor: res.nextCursor, items: [
      for (final p in res.list.cast<Map<String, dynamic>>())
        PayoutRequest(
          id: p['id'] as String,
          amountMinor: p['amountMinor'] as int,
          status: p['status'] as String,
          method: (p['destination'] as Map<String, dynamic>)['method'] as String,
          accountName: (p['destination'] as Map<String, dynamic>)['accountName'] as String,
          maskedRef: _mask((p['destination'] as Map<String, dynamic>)['accountRef'] as String),
          createdAt: DateTime.parse(p['createdAt'] as String),
        ),
    ]);
  }

  // The API returns the full reference to admins; the phone never needs to show it in full.
  String _mask(String ref) => ref.length <= 4 ? '****' : '${'*' * (ref.length - 4)}${ref.substring(ref.length - 4)}';

  @override
  Future<void> approvePayout(String id) => _post('/admin/payouts/$id/approve');
  @override
  Future<void> rejectPayout(String id, String reason) => _post('/admin/payouts/$id/reject', {'reason': reason});

  @override
  Future<PageResult<OrderRow>> orders({String? orderNumber, String? cursor}) async {
    final res = await _client.get('/admin/orders', query: {'limit': 20, 'orderNumber': ?orderNumber, 'cursor': ?cursor});
    return PageResult(nextCursor: res.nextCursor, items: [for (final o in res.list.cast<Map<String, dynamic>>()) parseOrderRow(o)]);
  }

  @override
  Future<OrderSupportView> order(String id) async {
    final j = (await _client.get('/admin/orders/$id')).map;
    final buyer = j['buyer'] as Map<String, dynamic>?;
    return OrderSupportView(
      row: parseOrderRow(j),
      buyerName: buyer?['name'] as String?,
      buyerEmail: buyer?['email'] as String?,
      sellerOrders: [
        for (final v in (j['vendorOrders'] as List<dynamic>).cast<Map<String, dynamic>>())
          (vendor: v['vendorName'] as String, status: v['status'] as String, totalMinor: (v['totals'] as Map<String, dynamic>)['totalMinor'] as int, commissionMinor: (v['commission'] as Map<String, dynamic>)['amountMinor'] as int, netMinor: (v['commission'] as Map<String, dynamic>)['vendorNetMinor'] as int),
      ],
      payments: [for (final p in (j['payments'] as List<dynamic>).cast<Map<String, dynamic>>()) (reference: p['merchantReference'] as String, status: p['status'] as String, amountMinor: p['amountMinor'] as int, refundedMinor: p['refundedMinor'] as int)],
      refunds: [for (final r in (j['refunds'] as List<dynamic>).cast<Map<String, dynamic>>()) (status: r['status'] as String, amountMinor: r['amountMinor'] as int, reason: r['reason'] as String)],
    );
  }
}
