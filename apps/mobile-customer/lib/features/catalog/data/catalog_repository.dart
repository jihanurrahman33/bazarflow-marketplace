import 'package:app_core/app_core.dart';

import '../domain/catalog_models.dart';

abstract interface class CatalogRepository {
  Future<List<CategoryNode>> categories();
  Future<PageResult<ProductSummary>> products(ProductQuery query, {String? cursor, int limit = 20});
  Future<ProductDetail> product(String slug);
  Future<ReviewSummary> reviews(String slug);
}

class ApiCatalogRepository implements CatalogRepository {
  ApiCatalogRepository(this._client);
  final ApiClient _client;

  @override
  Future<List<CategoryNode>> categories() async {
    final res = await _client.get('/categories', authenticated: false);
    CategoryNode node(Map<String, dynamic> j) => CategoryNode(
          id: j['id'] as String,
          name: j['name'] as String,
          slug: j['slug'] as String,
          children: [for (final c in (j['children'] as List<dynamic>? ?? const [])) node(c as Map<String, dynamic>)],
        );
    return [for (final c in res.list) node(c as Map<String, dynamic>)];
  }

  @override
  Future<PageResult<ProductSummary>> products(ProductQuery q, {String? cursor, int limit = 20}) async {
    final text = q.text?.trim();
    final res = await _client.get('/products', authenticated: false, query: {
      'limit': limit,
      'sort': text != null && text.length >= 2 ? 'relevance' : q.sort,
      if (text != null && text.length >= 2) 'q': text,
      'category': ?q.category,
      'vendor': ?q.vendor,
      if (q.minPriceMinor != null) 'minPrice': q.minPriceMinor! ~/ 100,
      if (q.maxPriceMinor != null) 'maxPrice': q.maxPriceMinor! ~/ 100,
      'cursor': ?cursor,
    });
    return PageResult(
      nextCursor: res.nextCursor,
      items: [
        for (final p in res.list.cast<Map<String, dynamic>>())
          ProductSummary(
            id: p['id'] as String,
            slug: p['slug'] as String,
            title: p['title'] as String,
            image: p['image'] as String?,
            minPriceMinor: p['minPriceMinor'] as int,
            currency: p['currency'] as String? ?? 'BDT',
            inStock: p['inStock'] == true,
            vendorName: (p['vendor'] as Map<String, dynamic>?)?['name'] as String?,
          ),
      ],
    );
  }

  @override
  Future<ProductDetail> product(String slug) async {
    final p = (await _client.get('/products/$slug', authenticated: false)).map;
    return ProductDetail(
      id: p['id'] as String,
      slug: p['slug'] as String,
      title: p['title'] as String,
      description: p['description'] as String,
      currency: p['currency'] as String? ?? 'BDT',
      minPriceMinor: p['minPriceMinor'] as int,
      options: [for (final o in (p['options'] as List<dynamic>? ?? const [])) ProductOption((o as Map<String, dynamic>)['name'] as String, [for (final v in o['values'] as List<dynamic>) v as String])],
      variants: [
        for (final v in (p['variants'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>())
          ProductVariant(
            variantId: v['variantId'] as String,
            label: v['label'] as String? ?? 'Default',
            optionValues: {for (final e in (v['optionValues'] as Map<String, dynamic>? ?? const {}).entries) e.key: e.value as String},
            priceMinor: v['priceMinor'] as int,
            compareAtMinor: v['compareAtMinor'] as int?,
            inStock: v['inStock'] == true,
            lowStock: v['lowStock'] as int?,
          ),
      ],
      images: [for (final m in (p['media'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>()) m['url'] as String],
      vendorName: (p['vendor'] as Map<String, dynamic>?)?['name'] as String?,
      vendorSlug: (p['vendor'] as Map<String, dynamic>?)?['slug'] as String?,
    );
  }

  @override
  Future<ReviewSummary> reviews(String slug) async {
    final res = await _client.get('/products/$slug/reviews', authenticated: false, query: {'limit': 5});
    final summary = (res.meta['summary'] as Map<String, dynamic>?) ?? const {};
    return ReviewSummary(
      count: (summary['count'] as num?)?.toInt() ?? 0,
      average: (summary['average'] as num?)?.toDouble(),
      reviews: [
        for (final r in res.list.cast<Map<String, dynamic>>())
          Review(id: r['id'] as String, rating: r['rating'] as int, title: r['title'] as String?, body: r['body'] as String, author: r['author'] as String? ?? 'Customer'),
      ],
    );
  }
}
