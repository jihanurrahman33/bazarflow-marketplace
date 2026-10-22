import 'package:app_core/app_core.dart';

import '../domain/cart_models.dart';

Quote parseQuote(Map<String, dynamic> j) {
  final totals = j['totals'] as Map<String, dynamic>;
  return Quote(
    itemCount: (j['itemCount'] as num?)?.toInt() ?? 0,
    subtotalMinor: totals['subtotalMinor'] as int,
    shippingMinor: totals['shippingMinor'] as int,
    totalMinor: totals['totalMinor'] as int,
    paymentMethods: [for (final m in (j['paymentMethods'] as List<dynamic>? ?? const [])) m as String],
    issues: [
      for (final i in (j['issues'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>())
        CartIssue(itemId: i['itemId'] as String, code: i['code'] as String, availableQuantity: (i['availableQuantity'] as num?)?.toInt()),
    ],
    groups: [
      for (final g in (j['groups'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>())
        CartGroup(
          vendorName: (g['vendor'] as Map<String, dynamic>)['name'] as String,
          vendorSlug: (g['vendor'] as Map<String, dynamic>)['slug'] as String,
          subtotalMinor: g['subtotalMinor'] as int,
          shippingMinor: g['shippingMinor'] as int,
          totalMinor: g['totalMinor'] as int,
          lines: [
            for (final l in (g['lines'] as List<dynamic>).cast<Map<String, dynamic>>())
              CartLine(
                itemId: l['itemId'] as String,
                productSlug: l['productSlug'] as String,
                title: l['title'] as String,
                variantLabel: l['variantLabel'] as String? ?? 'Default',
                imageUrl: l['imageUrl'] as String?,
                unitPriceMinor: l['unitPriceMinor'] as int,
                quantity: l['quantity'] as int,
                lineTotalMinor: l['lineTotalMinor'] as int,
                available: (l['available'] as num?)?.toInt() ?? 0,
              ),
          ],
        ),
    ],
  );
}

abstract interface class CartRepository {
  Future<Quote> get();
  Future<Quote> add({required String productId, required String variantId, required int quantity});
  Future<Quote> setQuantity(String itemId, int quantity);
  Future<Quote> remove(String itemId);
}

class ApiCartRepository implements CartRepository {
  ApiCartRepository(this._client);
  final ApiClient _client;

  @override
  Future<Quote> get() async => parseQuote((await _client.get('/cart')).map);
  @override
  Future<Quote> add({required String productId, required String variantId, required int quantity}) async =>
      parseQuote((await _client.post('/cart/items', body: {'productId': productId, 'variantId': variantId, 'quantity': quantity})).map);
  @override
  Future<Quote> setQuantity(String itemId, int quantity) async => parseQuote((await _client.patch('/cart/items/${Uri.encodeComponent(itemId)}', body: {'quantity': quantity})).map);
  @override
  Future<Quote> remove(String itemId) async => parseQuote((await _client.delete('/cart/items/${Uri.encodeComponent(itemId)}')).map);
}
