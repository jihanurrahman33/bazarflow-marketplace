import 'package:equatable/equatable.dart';

class CartLine extends Equatable {
  const CartLine({required this.itemId, required this.productSlug, required this.title, required this.variantLabel, required this.unitPriceMinor, required this.quantity, required this.lineTotalMinor, required this.available, this.imageUrl});
  final String itemId;
  final String productSlug;
  final String title;
  final String variantLabel;
  final String? imageUrl;
  final int unitPriceMinor;
  final int quantity;
  final int lineTotalMinor;
  final int available;
  @override
  List<Object?> get props => [itemId, productSlug, title, variantLabel, imageUrl, unitPriceMinor, quantity, lineTotalMinor, available];
}

class CartGroup extends Equatable {
  const CartGroup({required this.vendorName, required this.vendorSlug, required this.lines, required this.subtotalMinor, required this.shippingMinor, required this.totalMinor});
  final String vendorName;
  final String vendorSlug;
  final List<CartLine> lines;
  final int subtotalMinor;
  final int shippingMinor;
  final int totalMinor;
  @override
  List<Object?> get props => [vendorName, vendorSlug, lines, subtotalMinor, shippingMinor, totalMinor];
}

class CartIssue extends Equatable {
  const CartIssue({required this.itemId, required this.code, this.availableQuantity});
  final String itemId;
  final String code;
  final int? availableQuantity;
  @override
  List<Object?> get props => [itemId, code, availableQuantity];
}

/// Server-computed view of a cart (or checkout quote). Prices here are advisory until the order is placed.
class Quote extends Equatable {
  const Quote({required this.groups, required this.issues, required this.subtotalMinor, required this.shippingMinor, required this.totalMinor, required this.itemCount, this.paymentMethods = const []});
  final List<CartGroup> groups;
  final List<CartIssue> issues;
  final int subtotalMinor;
  final int shippingMinor;
  final int totalMinor;
  final int itemCount;
  final List<String> paymentMethods;

  bool get isEmpty => groups.isEmpty && issues.isEmpty;
  bool get hasIssues => issues.isNotEmpty;
  CartIssue? issueFor(String itemId) {
    for (final i in issues) {
      if (i.itemId == itemId) return i;
    }
    return null;
  }

  @override
  List<Object?> get props => [groups, issues, subtotalMinor, shippingMinor, totalMinor, itemCount, paymentMethods];
}
