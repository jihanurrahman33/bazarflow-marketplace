import 'package:app_core/app_core.dart';
import 'package:equatable/equatable.dart';

class StockItem extends Equatable {
  const StockItem({
    required this.id,
    required this.sku,
    required this.productTitle,
    required this.onHand,
    required this.reserved,
    required this.available,
  });
  final String id;
  final String sku;
  final String productTitle;
  final int onHand;
  final int reserved;
  final int available;
  @override
  List<Object?> get props => [
    id,
    sku,
    productTitle,
    onHand,
    reserved,
    available,
  ];
}

class ProductVariantRow extends Equatable {
  const ProductVariantRow({
    required this.variantId,
    required this.sku,
    required this.label,
    required this.priceMinor,
    required this.active,
    this.onHand,
    this.reserved,
  });
  final String variantId;
  final String sku;
  final String label;
  final int priceMinor;
  final bool active;
  final int? onHand;
  final int? reserved;
  @override
  List<Object?> get props => [
    variantId,
    sku,
    label,
    priceMinor,
    active,
    onHand,
    reserved,
  ];
}

class VendorProduct extends Equatable {
  const VendorProduct({
    required this.id,
    required this.title,
    required this.status,
    required this.minPriceMinor,
    required this.variants,
    this.moderationReason,
  });
  final String id;
  final String title;
  final String status;
  final int minPriceMinor;
  final List<ProductVariantRow> variants;
  final String? moderationReason;
  @override
  List<Object?> get props => [
    id,
    title,
    status,
    minPriceMinor,
    variants,
    moderationReason,
  ];
}

VendorProduct parseProduct(Map<String, dynamic> j) => VendorProduct(
  id: j['id'] as String,
  title: j['title'] as String,
  status: j['status'] as String,
  minPriceMinor: j['minPriceMinor'] as int,
  moderationReason:
      (j['moderation'] as Map<String, dynamic>?)?['reason'] as String?,
  variants: [
    for (final v
        in (j['variants'] as List<dynamic>? ?? const [])
            .cast<Map<String, dynamic>>())
      ProductVariantRow(
        variantId: v['variantId'] as String,
        sku: v['sku'] as String,
        label:
            (v['optionValues'] as Map<String, dynamic>? ?? const {}).values
                .join(' / ')
                .isEmpty
            ? 'Default'
            : (v['optionValues'] as Map<String, dynamic>).values.join(' / '),
        priceMinor: v['priceMinor'] as int,
        active: v['active'] == true,
        onHand: (v['stock'] as Map<String, dynamic>?)?['onHand'] as int?,
        reserved: (v['stock'] as Map<String, dynamic>?)?['reserved'] as int?,
      ),
  ],
);

abstract interface class CatalogOpsRepository {
  Future<PageResult<VendorProduct>> products({String? status, String? cursor});
  Future<VendorProduct> product(String id);
  Future<VendorProduct> updateVariant(
    String productId,
    String variantId, {
    int? priceMinor,
    bool? active,
  });
  Future<PageResult<StockItem>> inventory({int? lowStock, String? cursor});
  Future<StockItem> adjustStock(
    String itemId, {
    required int set,
    required String reason,
  });
}

class ApiCatalogOpsRepository implements CatalogOpsRepository {
  ApiCatalogOpsRepository(this._client);
  final ApiClient _client;

  @override
  Future<PageResult<VendorProduct>> products({
    String? status,
    String? cursor,
  }) async {
    final res = await _client.get(
      '/vendor/products',
      query: {'limit': 20, 'status': ?status, 'cursor': ?cursor},
    );
    return PageResult(
      items: [
        for (final p in res.list.cast<Map<String, dynamic>>()) parseProduct(p),
      ],
      nextCursor: res.nextCursor,
    );
  }

  @override
  Future<VendorProduct> product(String id) async =>
      parseProduct((await _client.get('/vendor/products/$id')).map);

  @override
  Future<VendorProduct> updateVariant(
    String productId,
    String variantId, {
    int? priceMinor,
    bool? active,
  }) async {
    await _client.patch(
      '/vendor/products/$productId/variants/$variantId',
      body: {'priceMinor': ?priceMinor, 'active': ?active},
    );
    return product(productId);
  }

  StockItem _stock(Map<String, dynamic> i) => StockItem(
    id: i['id'] as String,
    sku: i['sku'] as String,
    productTitle: (i['productTitle'] as String?) ?? '',
    onHand: i['onHand'] as int,
    reserved: i['reserved'] as int,
    available: i['available'] as int,
  );

  @override
  Future<PageResult<StockItem>> inventory({
    int? lowStock,
    String? cursor,
  }) async {
    final res = await _client.get(
      '/vendor/inventory',
      query: {'limit': 25, 'lowStock': ?lowStock, 'cursor': ?cursor},
    );
    return PageResult(
      items: [for (final i in res.list.cast<Map<String, dynamic>>()) _stock(i)],
      nextCursor: res.nextCursor,
    );
  }

  @override
  Future<StockItem> adjustStock(
    String itemId, {
    required int set,
    required String reason,
  }) async => _stock(
    (await _client.patch(
      '/vendor/inventory/$itemId',
      body: {'set': set, 'reason': reason},
    )).map,
  );
}
