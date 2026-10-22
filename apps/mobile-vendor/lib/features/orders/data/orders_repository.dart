import 'package:app_core/app_core.dart';

import '../domain/orders_models.dart';

VendorOrder parseVendorOrder(Map<String, dynamic> j) {
  final totals = j['totals'] as Map<String, dynamic>;
  final c = j['commission'] as Map<String, dynamic>;
  final a = j['shippingAddress'] as Map<String, dynamic>;
  final shipment = j['shipment'] as Map<String, dynamic>?;
  return VendorOrder(
    id: j['id'] as String,
    orderNumber: j['orderNumber'] as String,
    status: j['status'] as String,
    paymentMethod: j['paymentMethod'] as String?,
    collectOnDeliveryMinor: (j['collectOnDeliveryMinor'] as num?)?.toInt() ?? 0,
    subtotalMinor: totals['subtotalMinor'] as int,
    shippingMinor: totals['shippingMinor'] as int,
    totalMinor: totals['totalMinor'] as int,
    commissionMinor: c['amountMinor'] as int,
    netMinor: c['vendorNetMinor'] as int,
    commissionBps: c['bps'] as int,
    recipient: a['recipient'] as String,
    phone: a['phone'] as String,
    address:
        '${a['line1']}${a['line2'] == null ? '' : ', ${a['line2']}'}, ${a['city']}, ${a['district']} ${a['postalCode']}',
    createdAt: DateTime.parse(j['createdAt'] as String),
    carrier: shipment?['carrier'] as String?,
    trackingNumber: shipment?['trackingNumber'] as String?,
    items: [
      for (final i
          in (j['items'] as List<dynamic>).cast<Map<String, dynamic>>())
        OrderLine(
          title: i['title'] as String,
          sku: i['sku'] as String,
          variantLabel: i['variantLabel'] as String? ?? 'Default',
          quantity: i['quantity'] as int,
          unitPriceMinor: i['unitPriceMinor'] as int,
          lineTotalMinor: i['lineTotalMinor'] as int,
        ),
    ],
    timeline: [
      for (final t
          in (j['timeline'] as List<dynamic>? ?? const [])
              .cast<Map<String, dynamic>>())
        (
          status: t['status'] as String,
          at: DateTime.parse(t['at'] as String),
          note: t['note'] as String?,
        ),
    ],
  );
}

abstract interface class OrdersRepository {
  Future<PageResult<VendorOrder>> list({String? status, String? cursor});
  Future<VendorOrder> get(String id);
  Future<VendorOrder> accept(String id);
  Future<VendorOrder> ship(
    String id, {
    required String carrier,
    required String trackingNumber,
  });
  Future<VendorOrder> deliver(String id);
  Future<VendorOrder> cancel(String id, String reason);
  Future<VendorOrder> approveReturn(String id);
  Future<VendorOrder> rejectReturn(String id, String reason);
}

class ApiOrdersRepository implements OrdersRepository {
  ApiOrdersRepository(this._client);
  final ApiClient _client;

  Future<VendorOrder> _post(String path, [Object? body]) async =>
      parseVendorOrder((await _client.post(path, body: body)).map);

  @override
  Future<PageResult<VendorOrder>> list({String? status, String? cursor}) async {
    final res = await _client.get(
      '/vendor/orders',
      query: {'limit': 20, 'status': ?status, 'cursor': ?cursor},
    );
    return PageResult(
      items: [
        for (final o in res.list.cast<Map<String, dynamic>>())
          parseVendorOrder(o),
      ],
      nextCursor: res.nextCursor,
    );
  }

  @override
  Future<VendorOrder> get(String id) async =>
      parseVendorOrder((await _client.get('/vendor/orders/$id')).map);
  @override
  Future<VendorOrder> accept(String id) => _post('/vendor/orders/$id/accept');
  @override
  Future<VendorOrder> ship(
    String id, {
    required String carrier,
    required String trackingNumber,
  }) => _post('/vendor/orders/$id/ship', {
    'carrier': carrier,
    'trackingNumber': trackingNumber,
  });
  @override
  Future<VendorOrder> deliver(String id) => _post('/vendor/orders/$id/deliver');
  @override
  Future<VendorOrder> cancel(String id, String reason) =>
      _post('/vendor/orders/$id/cancel', {'reason': reason});
  @override
  Future<VendorOrder> approveReturn(String id) =>
      _post('/vendor/orders/$id/return/approve');
  @override
  Future<VendorOrder> rejectReturn(String id, String reason) =>
      _post('/vendor/orders/$id/return/reject', {'reason': reason});
}
