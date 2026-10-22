import 'package:equatable/equatable.dart';

class ProductSummary extends Equatable {
  const ProductSummary({required this.id, required this.slug, required this.title, required this.minPriceMinor, required this.currency, required this.inStock, this.image, this.vendorName});
  final String id;
  final String slug;
  final String title;
  final String? image;
  final int minPriceMinor;
  final String currency;
  final bool inStock;
  final String? vendorName;
  @override
  List<Object?> get props => [id, slug, title, image, minPriceMinor, currency, inStock, vendorName];
}

class CategoryNode extends Equatable {
  const CategoryNode({required this.id, required this.name, required this.slug, this.children = const []});
  final String id;
  final String name;
  final String slug;
  final List<CategoryNode> children;
  @override
  List<Object?> get props => [id, name, slug, children];
}

class ProductVariant extends Equatable {
  const ProductVariant({required this.variantId, required this.label, required this.optionValues, required this.priceMinor, required this.inStock, this.compareAtMinor, this.lowStock});
  final String variantId;
  final String label;
  final Map<String, String> optionValues;
  final int priceMinor;
  final int? compareAtMinor;
  final bool inStock;
  final int? lowStock;
  @override
  List<Object?> get props => [variantId, label, optionValues, priceMinor, compareAtMinor, inStock, lowStock];
}

class ProductOption extends Equatable {
  const ProductOption(this.name, this.values);
  final String name;
  final List<String> values;
  @override
  List<Object?> get props => [name, values];
}

class ProductDetail extends Equatable {
  const ProductDetail({
    required this.id,
    required this.slug,
    required this.title,
    required this.description,
    required this.currency,
    required this.minPriceMinor,
    required this.options,
    required this.variants,
    required this.images,
    this.vendorName,
    this.vendorSlug,
  });
  final String id;
  final String slug;
  final String title;
  final String description;
  final String currency;
  final int minPriceMinor;
  final List<ProductOption> options;
  final List<ProductVariant> variants;
  final List<String> images;
  final String? vendorName;
  final String? vendorSlug;

  /// The variant matching every chosen option, if all options are chosen.
  ProductVariant? variantFor(Map<String, String> chosen) {
    for (final v in variants) {
      if (options.every((o) => v.optionValues[o.name] == chosen[o.name])) return v;
    }
    return null;
  }

  /// An option value is selectable if some in-stock variant matches it plus the other current choices.
  bool valueAvailable(String option, String value, Map<String, String> chosen) => variants.any(
        (v) => v.inStock && v.optionValues[option] == value && options.every((o) => o.name == option || (chosen[o.name] ?? '').isEmpty || v.optionValues[o.name] == chosen[o.name]),
      );

  @override
  List<Object?> get props => [id, slug, title, description, currency, minPriceMinor, options, variants, images, vendorName, vendorSlug];
}

class Review extends Equatable {
  const Review({required this.id, required this.rating, required this.body, required this.author, this.title});
  final String id;
  final int rating;
  final String? title;
  final String body;
  final String author;
  @override
  List<Object?> get props => [id, rating, title, body, author];
}

class ReviewSummary extends Equatable {
  const ReviewSummary({required this.reviews, required this.count, this.average});
  final List<Review> reviews;
  final int count;
  final double? average;
  @override
  List<Object?> get props => [reviews, count, average];
}

class ProductQuery extends Equatable {
  const ProductQuery({this.text, this.category, this.vendor, this.sort = 'newest', this.minPriceMinor, this.maxPriceMinor});
  final String? text;
  final String? category;
  final String? vendor;
  final String sort;
  final int? minPriceMinor;
  final int? maxPriceMinor;
  ProductQuery copyWith({String? text, String? category, String? sort}) => ProductQuery(text: text ?? this.text, category: category ?? this.category, vendor: vendor, sort: sort ?? this.sort, minPriceMinor: minPriceMinor, maxPriceMinor: maxPriceMinor);
  @override
  List<Object?> get props => [text, category, vendor, sort, minPriceMinor, maxPriceMinor];
}
