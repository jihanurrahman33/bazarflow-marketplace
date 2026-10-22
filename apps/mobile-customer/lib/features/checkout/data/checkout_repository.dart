import 'package:app_core/app_core.dart';

import '../../cart/data/cart_repository.dart';
import '../../cart/domain/cart_models.dart';
import '../domain/checkout_models.dart';

PaymentView parsePayment(Map<String, dynamic> j) => PaymentView(
      id: (j['id'] as String?) ?? '',
      status: j['status'] as String,
      canRetry: j['canRetry'] == true,
      redirectUrl: j['redirectUrl'] as String?,
      message: j['message'] as String?,
    );

Address parseAddress(Map<String, dynamic> j) => Address(
      id: j['id'] as String,
      label: j['label'] as String,
      recipient: j['recipient'] as String,
      phone: j['phone'] as String,
      line1: j['line1'] as String,
      line2: j['line2'] as String?,
      city: j['city'] as String,
      district: j['district'] as String,
      postalCode: j['postalCode'] as String,
      isDefault: j['isDefault'] == true,
    );

class PlacedOrder {
  const PlacedOrder({required this.orderId, required this.orderNumber, required this.status, this.payment});
  final String orderId;
  final String orderNumber;
  final String status;
  final PaymentView? payment;
}

abstract interface class CheckoutRepository {
  Future<List<Address>> addresses();
  Future<Address> createAddress(AddressInput input);
  Future<Quote> quote(String addressId);
  Future<PlacedOrder> placeOrder({required String addressId, required PaymentMethod method, required int expectedTotalMinor, required String idempotencyKey});
}

class ApiCheckoutRepository implements CheckoutRepository {
  ApiCheckoutRepository(this._client);
  final ApiClient _client;

  @override
  Future<List<Address>> addresses() async => [for (final a in (await _client.get('/addresses')).list) parseAddress(a as Map<String, dynamic>)];

  @override
  Future<Address> createAddress(AddressInput input) async => parseAddress((await _client.post('/addresses', body: input.toJson())).map);

  @override
  Future<Quote> quote(String addressId) async => parseQuote((await _client.post('/checkout/quote', body: {'addressId': addressId})).map);

  @override
  Future<PlacedOrder> placeOrder({required String addressId, required PaymentMethod method, required int expectedTotalMinor, required String idempotencyKey}) async {
    final res = await _client.post(
      '/checkout',
      idempotencyKey: idempotencyKey,
      body: {'addressId': addressId, 'paymentMethod': method.name, 'expectedTotalMinor': expectedTotalMinor},
    );
    final j = res.map;
    return PlacedOrder(
      orderId: j['id'] as String,
      orderNumber: j['orderNumber'] as String,
      status: j['status'] as String,
      payment: j['payment'] is Map<String, dynamic> ? parsePayment(j['payment'] as Map<String, dynamic>) : null,
    );
  }
}
