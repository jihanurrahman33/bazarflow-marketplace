import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:app_core/testing.dart';
import 'package:observability/observability.dart';
import 'package:vendor_app/app/deps.dart';
import 'package:vendor_app/features/inventory/data/catalog_ops_repository.dart';
import 'package:vendor_app/features/money/data/money_repository.dart';
import 'package:vendor_app/features/notifications/data/notifications_repository.dart';
import 'package:vendor_app/features/orders/data/orders_repository.dart';
import 'package:vendor_app/features/orders/domain/orders_models.dart';

const apiDown = ApiException(status: 0, code: ApiException.network, message: 'offline');

VendorOrder order({String status = 'new', String method = 'online', String id = 'o1'}) => VendorOrder(
      id: id, orderNumber: 'BF-$id', status: status, paymentMethod: method, collectOnDeliveryMinor: method == 'cod' ? 100000 : 0,
      items: const [OrderLine(title: 'Desk Lamp', sku: 'LAMP-1', variantLabel: 'Default', quantity: 2, unitPriceMinor: 50000, lineTotalMinor: 100000)],
      subtotalMinor: 100000, shippingMinor: 0, totalMinor: 100000, commissionMinor: 10000, netMinor: 90000, commissionBps: 1000,
      recipient: 'Rahim', phone: '+8801700000000', address: 'House 1, Dhaka', createdAt: DateTime(2026, 10, 22),
    );

class FakeOrdersRepo implements OrdersRepository {
  VendorOrder current = order();
  final actions = <String>[];
  Object? fail;
  Completer<void>? gate;
  List<VendorOrder> listed = [order()];

  Future<VendorOrder> _act(String name, String next) async {
    actions.add(name);
    if (gate != null) await gate!.future;
    if (fail != null) throw fail!;
    current = order(status: next);
    return current;
  }

  @override
  Future<PageResult<VendorOrder>> list({String? status, String? cursor}) async => PageResult(items: status == null ? listed : listed.where((o) => o.status == status).toList());
  @override
  Future<VendorOrder> get(String id) async {
    if (fail != null && actions.isEmpty) throw fail!;
    return current;
  }

  @override
  Future<VendorOrder> accept(String id) => _act('accept', 'accepted');
  @override
  Future<VendorOrder> ship(String id, {required String carrier, required String trackingNumber}) => _act('ship:$carrier:$trackingNumber', 'shipped');
  @override
  Future<VendorOrder> deliver(String id) => _act('deliver', 'delivered');
  @override
  Future<VendorOrder> cancel(String id, String reason) => _act('cancel:$reason', 'cancelled');
  @override
  Future<VendorOrder> approveReturn(String id) => _act('approveReturn', 'returned');
  @override
  Future<VendorOrder> rejectReturn(String id, String reason) => _act('rejectReturn:$reason', 'delivered');
}

class _FakeCatalog implements CatalogOpsRepository {
  @override
  Future<PageResult<VendorProduct>> products({String? status, String? cursor}) async => const PageResult(items: []);
  @override
  Future<VendorProduct> product(String id) async => throw UnimplementedError();
  @override
  Future<VendorProduct> updateVariant(String productId, String variantId, {int? priceMinor, bool? active}) async => throw UnimplementedError();
  @override
  Future<PageResult<StockItem>> inventory({int? lowStock, String? cursor}) async => const PageResult(items: []);
  @override
  Future<StockItem> adjustStock(String itemId, {required int set, required String reason}) async => throw UnimplementedError();
}

class _FakeMoney implements MoneyRepository {
  @override
  Future<Balance> balance() async => const Balance(availableMinor: 360000, pendingMinor: 90000, lifetimeSalesMinor: 500000);
  @override
  Future<PageResult<LedgerEntry>> ledger({String? cursor}) async => const PageResult(items: []);
  @override
  Future<PageResult<Payout>> payouts({String? cursor}) async => const PageResult(items: []);
  @override
  Future<void> requestPayout(int amountMinor) async {}
  @override
  Future<void> cancelPayout(String id) async {}
}

class _FakeNotifications implements NotificationsRepository {
  @override
  Future<PageResult<AppNotification>> list({String? cursor}) async => const PageResult(items: []);
  @override
  Future<void> markRead(String id) async {}
}

Future<AppDependencies> buildFakeDeps({required Responder api, bool signedIn = false, FakeOrdersRepo? orders}) async {
  final rig = TestRig(api, allowedRoles: {'vendor'});
  if (signedIn) await rig.session.login('s@shop.co', 'password-1234');
  final obs = await initObservability(enableFirebase: false);
  return AppDependencies(
    config: rig.config, client: rig.client, session: rig.session, store: rig.store, orders: orders ?? FakeOrdersRepo(), catalog: _FakeCatalog(), money: _FakeMoney(),
    notifications: _FakeNotifications(), registrar: DeviceRegistrar(client: rig.client, store: rig.store, appId: 'com.test.vendor', platform: 'android'), obs: obs,
  );
}

Responder authOk({String role = 'vendor'}) => (req) => switch (req.path) {
      '/auth/login' => FakeReply.ok({'user': userJson(role: role), 'tokens': {'accessToken': 'at', 'refreshToken': 'rt'}}),
      '/auth/refresh' => FakeReply.ok({'accessToken': 'at2', 'refreshToken': 'rt2'}),
      '/me' => FakeReply.ok(userJson(role: role)),
      _ => FakeReply.ok({}),
    };
