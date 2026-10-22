import 'package:equatable/equatable.dart';

class OrderSummary extends Equatable {
  const OrderSummary({required this.id, required this.orderNumber, required this.status, required this.paymentStatus, required this.totalMinor, required this.createdAt});
  final String id;
  final String orderNumber;
  final String status;
  final String paymentStatus;
  final int totalMinor;
  final DateTime createdAt;
  @override
  List<Object?> get props => [id, orderNumber, status, paymentStatus, totalMinor, createdAt];
}

class OrderItem extends Equatable {
  const OrderItem({required this.productSlug, required this.title, required this.variantLabel, required this.quantity, required this.unitPriceMinor, required this.lineTotalMinor});
  final String productSlug;
  final String title;
  final String variantLabel;
  final int quantity;
  final int unitPriceMinor;
  final int lineTotalMinor;
  @override
  List<Object?> get props => [productSlug, title, variantLabel, quantity, unitPriceMinor, lineTotalMinor];
}

class TimelineEntry extends Equatable {
  const TimelineEntry(this.status, this.at, this.note);
  final String status;
  final DateTime at;
  final String? note;
  @override
  List<Object?> get props => [status, at, note];
}

class VendorOrderView extends Equatable {
  const VendorOrderView({required this.id, required this.vendorName, required this.status, required this.items, required this.totalMinor, required this.timeline, this.carrier, this.trackingNumber});
  final String id;
  final String vendorName;
  final String status;
  final List<OrderItem> items;
  final int totalMinor;
  final List<TimelineEntry> timeline;
  final String? carrier;
  final String? trackingNumber;
  @override
  List<Object?> get props => [id, vendorName, status, items, totalMinor, timeline, carrier, trackingNumber];
}

class OrderDetail extends Equatable {
  const OrderDetail({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.paymentStatus,
    required this.paymentMethod,
    required this.subtotalMinor,
    required this.shippingMinor,
    required this.totalMinor,
    required this.vendorOrders,
    required this.createdAt,
    required this.address,
    this.cancellationReason,
  });
  final String id;
  final String orderNumber;
  final String status;
  final String paymentStatus;
  final String paymentMethod;
  final int subtotalMinor;
  final int shippingMinor;
  final int totalMinor;
  final List<VendorOrderView> vendorOrders;
  final DateTime createdAt;
  final String address;
  final String? cancellationReason;

  bool get awaitingPayment => status == 'pending_payment';

  /// Before any seller starts work an order can still be cancelled.
  bool get cancellable => (status == 'pending_payment' || status == 'confirmed') && vendorOrders.every((v) => v.status == 'awaiting_payment' || v.status == 'new');
  @override
  List<Object?> get props => [id, orderNumber, status, paymentStatus, paymentMethod, subtotalMinor, shippingMinor, totalMinor, vendorOrders, createdAt, address, cancellationReason];
}
