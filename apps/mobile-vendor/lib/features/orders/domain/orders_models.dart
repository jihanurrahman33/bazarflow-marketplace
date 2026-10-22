import 'package:equatable/equatable.dart';

class OrderLine extends Equatable {
  const OrderLine({
    required this.title,
    required this.sku,
    required this.variantLabel,
    required this.quantity,
    required this.unitPriceMinor,
    required this.lineTotalMinor,
  });
  final String title;
  final String sku;
  final String variantLabel;
  final int quantity;
  final int unitPriceMinor;
  final int lineTotalMinor;
  @override
  List<Object?> get props => [
    title,
    sku,
    variantLabel,
    quantity,
    unitPriceMinor,
    lineTotalMinor,
  ];
}

class VendorOrder extends Equatable {
  const VendorOrder({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.paymentMethod,
    required this.collectOnDeliveryMinor,
    required this.items,
    required this.subtotalMinor,
    required this.shippingMinor,
    required this.totalMinor,
    required this.commissionMinor,
    required this.netMinor,
    required this.commissionBps,
    required this.recipient,
    required this.phone,
    required this.address,
    required this.createdAt,
    this.carrier,
    this.trackingNumber,
    this.timeline = const [],
  });
  final String id;
  final String orderNumber;
  final String status;
  final String? paymentMethod;
  final int collectOnDeliveryMinor;
  final List<OrderLine> items;
  final int subtotalMinor;
  final int shippingMinor;
  final int totalMinor;
  final int commissionMinor;
  final int netMinor;
  final int commissionBps;
  final String recipient;
  final String phone;
  final String address;
  final DateTime createdAt;
  final String? carrier;
  final String? trackingNumber;
  final List<({String status, DateTime at, String? note})> timeline;

  bool get canAccept => status == 'new';
  bool get canShip => status == 'accepted';
  bool get canDeliver => status == 'shipped';
  bool get canCancel => status == 'new' || status == 'accepted';
  bool get returnPending => status == 'return_requested';
  int get itemCount => items.fold(0, (a, i) => a + i.quantity);

  @override
  List<Object?> get props => [
    id,
    orderNumber,
    status,
    paymentMethod,
    collectOnDeliveryMinor,
    items,
    subtotalMinor,
    shippingMinor,
    totalMinor,
    commissionMinor,
    netMinor,
    commissionBps,
    recipient,
    phone,
    address,
    createdAt,
    carrier,
    trackingNumber,
    timeline,
  ];
}
