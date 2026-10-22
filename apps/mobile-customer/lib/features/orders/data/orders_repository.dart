import 'package:app_core/app_core.dart';

import '../../checkout/data/checkout_repository.dart';
import '../../checkout/domain/checkout_models.dart';
import '../domain/order_models.dart';

OrderDetail parseOrder(Map<String, dynamic> j) {
  final totals = j['totals'] as Map<String, dynamic>;
  final a = j['shippingAddress'] as Map<String, dynamic>? ?? const {};
  return OrderDetail(
    id: j['id'] as String,
    orderNumber: j['orderNumber'] as String,
    status: j['status'] as String,
    paymentStatus: j['paymentStatus'] as String,
    paymentMethod: j['paymentMethod'] as String,
    subtotalMinor: totals['subtotalMinor'] as int,
    shippingMinor: totals['shippingMinor'] as int,
    totalMinor: totals['totalMinor'] as int,
    createdAt: DateTime.parse(j['createdAt'] as String),
    cancellationReason: j['cancellationReason'] as String?,
    address: a.isEmpty ? '' : '${a['recipient']}, ${a['line1']}, ${a['city']}, ${a['district']} ${a['postalCode']}',
    vendorOrders: [
      for (final v in (j['vendorOrders'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>())
        VendorOrderView(
          id: v['id'] as String,
          vendorName: (v['vendor'] as Map<String, dynamic>)['name'] as String,
          status: v['status'] as String,
          totalMinor: (v['totals'] as Map<String, dynamic>)['totalMinor'] as int,
          carrier: (v['shipment'] as Map<String, dynamic>?)?['carrier'] as String?,
          trackingNumber: (v['shipment'] as Map<String, dynamic>?)?['trackingNumber'] as String?,
          items: [
            for (final i in (v['items'] as List<dynamic>).cast<Map<String, dynamic>>())
              OrderItem(
                productSlug: i['productSlug'] as String? ?? '',
                title: i['title'] as String,
                variantLabel: i['variantLabel'] as String? ?? 'Default',
                quantity: i['quantity'] as int,
                unitPriceMinor: i['unitPriceMinor'] as int,
                lineTotalMinor: i['lineTotalMinor'] as int,
              ),
          ],
          timeline: [for (final t in (v['timeline'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>()) TimelineEntry(t['status'] as String, DateTime.parse(t['at'] as String), t['note'] as String?)],
        ),
    ],
  );
}

abstract interface class OrdersRepository {
  Future<PageResult<OrderSummary>> list({String? cursor, int limit = 15});
  Future<OrderDetail> get(String id);
  Future<PaymentView?> payment(String orderId);
  Future<PaymentView?> refreshPayment(String orderId);
  Future<PaymentView> startPayment(String orderId);
  Future<OrderDetail> cancel(String orderId, {String? reason});
  Future<void> requestReturn(String vendorOrderId, String reason);
  Future<void> review({required String productSlug, required int rating, required String body});
}

class ApiOrdersRepository implements OrdersRepository {
  ApiOrdersRepository(this._client);
  final ApiClient _client;

  @override
  Future<PageResult<OrderSummary>> list({String? cursor, int limit = 15}) async {
    final res = await _client.get('/orders', query: {'limit': limit, 'cursor': ?cursor});
    return PageResult(
      nextCursor: res.nextCursor,
      items: [
        for (final o in res.list.cast<Map<String, dynamic>>())
          OrderSummary(
            id: o['id'] as String,
            orderNumber: o['orderNumber'] as String,
            status: o['status'] as String,
            paymentStatus: o['paymentStatus'] as String,
            totalMinor: (o['totals'] as Map<String, dynamic>)['totalMinor'] as int,
            createdAt: DateTime.parse(o['createdAt'] as String),
          ),
      ],
    );
  }

  @override
  Future<OrderDetail> get(String id) async => parseOrder((await _client.get('/orders/$id')).map);

  @override
  Future<PaymentView?> payment(String orderId) async {
    final d = (await _client.get('/orders/$orderId/payment')).data;
    return d is Map<String, dynamic> ? parsePayment(d) : null;
  }

  @override
  Future<PaymentView?> refreshPayment(String orderId) async {
    final d = (await _client.post('/orders/$orderId/payments/refresh')).data;
    return d is Map<String, dynamic> ? parsePayment(d) : null;
  }

  @override
  Future<PaymentView> startPayment(String orderId) async => parsePayment((await _client.post('/orders/$orderId/payments')).map);

  @override
  Future<OrderDetail> cancel(String orderId, {String? reason}) async => parseOrder((await _client.post('/orders/$orderId/cancel', body: {if (reason != null && reason.isNotEmpty) 'reason': reason})).map);

  @override
  Future<void> requestReturn(String vendorOrderId, String reason) async {
    await _client.post('/vendor-orders/$vendorOrderId/return-requests', body: {'reason': reason});
  }

  @override
  Future<void> review({required String productSlug, required int rating, required String body}) async {
    await _client.post('/products/$productSlug/reviews', body: {'rating': rating, 'body': body});
  }
}
