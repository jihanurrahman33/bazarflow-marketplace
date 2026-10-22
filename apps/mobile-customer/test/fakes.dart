import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:app_core/testing.dart';
import 'package:customer_app/app/deps.dart';
import 'package:customer_app/features/account/data/account_repository.dart';
import 'package:customer_app/features/cart/presentation/cart_bloc.dart';
import 'package:customer_app/features/catalog/data/catalog_repository.dart';
import 'package:customer_app/features/catalog/domain/catalog_models.dart';
import 'package:customer_app/features/notifications/data/notifications_repository.dart';
import 'package:observability/observability.dart';
import 'package:customer_app/features/cart/data/cart_repository.dart';
import 'package:customer_app/features/cart/domain/cart_models.dart';
import 'package:customer_app/features/checkout/data/checkout_repository.dart';
import 'package:customer_app/features/checkout/domain/checkout_models.dart';
import 'package:customer_app/features/orders/data/orders_repository.dart';
import 'package:customer_app/features/orders/domain/order_models.dart';

const apiDown = ApiException(status: 0, code: ApiException.network, message: 'offline');

Quote sampleQuote({int total = 100000, int items = 1, List<CartIssue> issues = const [], List<String> methods = const ['online', 'cod']}) => Quote(
      groups: items == 0
          ? const []
          : [
              CartGroup(vendorName: 'Shop', vendorSlug: 'shop', subtotalMinor: total - 6000, shippingMinor: 6000, totalMinor: total, lines: [
                CartLine(itemId: 'p1.v1', productSlug: 'lamp', title: 'Lamp', variantLabel: 'Default', unitPriceMinor: total - 6000, quantity: items, lineTotalMinor: total - 6000, available: 5),
              ]),
            ],
      issues: issues,
      subtotalMinor: total - 6000,
      shippingMinor: 6000,
      totalMinor: total,
      itemCount: items,
      paymentMethods: methods,
    );

const home = Address(id: 'a1', label: 'Home', recipient: 'Rahim', phone: '+8801700000000', line1: 'House 1', city: 'Dhaka', district: 'Dhaka', postalCode: '1212', isDefault: true);

class FakeCartRepo implements CartRepository {
  Quote current = sampleQuote();
  Object? failWith;
  final calls = <String>[];
  Completer<void>? gate;

  Future<Quote> _do(String name) async {
    calls.add(name);
    if (gate != null) await gate!.future;
    if (failWith != null) throw failWith!;
    return current;
  }

  @override
  Future<Quote> get() => _do('get');
  @override
  Future<Quote> add({required String productId, required String variantId, required int quantity}) => _do('add');
  @override
  Future<Quote> setQuantity(String itemId, int quantity) => _do('set:$itemId:$quantity');
  @override
  Future<Quote> remove(String itemId) => _do('remove:$itemId');
}

class FakeCheckoutRepo implements CheckoutRepository {
  List<Address> addressList = [home];
  Quote nextQuote = sampleQuote();
  final placeKeys = <String>[];
  final placeCalls = <({String addressId, PaymentMethod method, int total})>[];
  final List<Object> placeFailures = [];
  PlacedOrder placed = const PlacedOrder(orderId: 'o1', orderNumber: 'BF-1', status: 'pending_payment', payment: PaymentView(id: 'pay1', status: 'requires_action', canRetry: false, redirectUrl: 'https://pay.example/x'));

  @override
  Future<List<Address>> addresses() async => addressList;
  @override
  Future<Address> createAddress(AddressInput input) async => Address(id: 'a-new', label: input.label, recipient: input.recipient, phone: input.phone, line1: input.line1, city: input.city, district: input.district, postalCode: input.postalCode, isDefault: false);
  @override
  Future<Quote> quote(String addressId) async => nextQuote;
  @override
  Future<PlacedOrder> placeOrder({required String addressId, required PaymentMethod method, required int expectedTotalMinor, required String idempotencyKey}) async {
    placeKeys.add(idempotencyKey);
    placeCalls.add((addressId: addressId, method: method, total: expectedTotalMinor));
    if (placeFailures.isNotEmpty) throw placeFailures.removeAt(0);
    return placed;
  }
}

OrderDetail order({String status = 'pending_payment', String paymentStatus = 'pending', String method = 'online', String vo = 'awaiting_payment'}) => OrderDetail(
      id: 'o1', orderNumber: 'BF-1', status: status, paymentStatus: paymentStatus, paymentMethod: method, subtotalMinor: 94000, shippingMinor: 6000, totalMinor: 100000, createdAt: DateTime(2026, 10, 22), address: 'Rahim, House 1',
      vendorOrders: [VendorOrderView(id: 'vo1', vendorName: 'Shop', status: vo, totalMinor: 100000, timeline: const [], items: const [OrderItem(productSlug: 'lamp', title: 'Lamp', variantLabel: 'Default', quantity: 1, unitPriceMinor: 94000, lineTotalMinor: 94000)])],
    );

class FakeOrdersRepo implements OrdersRepository {
  OrderDetail current = order();
  PaymentView? currentPayment = const PaymentView(id: 'pay1', status: 'pending', canRetry: false);
  final refreshCalls = <int>[];
  int refreshes = 0;
  OrderDetail? afterRefresh;
  PaymentView? paymentAfterRefresh;
  Object? failGet;
  Object? failAction;
  final actions = <String>[];

  @override
  Future<PageResult<OrderSummary>> list({String? cursor, int limit = 15}) async => const PageResult(items: []);
  @override
  Future<OrderDetail> get(String id) async {
    if (failGet != null) throw failGet!;
    return current;
  }

  @override
  Future<PaymentView?> payment(String orderId) async => currentPayment;
  @override
  Future<PaymentView?> refreshPayment(String orderId) async {
    refreshes++;
    if (afterRefresh != null && refreshes >= 2) {
      current = afterRefresh!;
      currentPayment = paymentAfterRefresh;
    }
    return currentPayment;
  }

  @override
  Future<PaymentView> startPayment(String orderId) async {
    actions.add('startPayment');
    if (failAction != null) throw failAction!;
    currentPayment = const PaymentView(id: 'pay2', status: 'requires_action', canRetry: false, redirectUrl: 'https://pay.example/retry');
    return currentPayment!;
  }

  @override
  Future<OrderDetail> cancel(String orderId, {String? reason}) async {
    actions.add('cancel');
    if (failAction != null) throw failAction!;
    current = order(status: 'cancelled', paymentStatus: 'failed', vo: 'cancelled');
    return current;
  }

  @override
  Future<void> requestReturn(String vendorOrderId, String reason) async {
    actions.add('return:$vendorOrderId');
    if (failAction != null) throw failAction!;
  }

  @override
  Future<void> review({required String productSlug, required int rating, required String body}) async {
    actions.add('review:$productSlug:$rating');
    if (failAction != null) throw failAction!;
  }
}

// ---------- app-level fakes ----------
class FakeCatalogRepo implements CatalogRepository {
  List<ProductSummary> items = const [ProductSummary(id: 'p1', slug: 'lamp-ab12', title: 'Desk Lamp', minPriceMinor: 250000, currency: 'BDT', inStock: true, vendorName: 'Smoke Store')];
  ProductDetail detail = const ProductDetail(
    id: 'p1', slug: 'lamp-ab12', title: 'Desk Lamp', description: 'A very bright lamp.', currency: 'BDT', minPriceMinor: 250000, vendorName: 'Smoke Store', vendorSlug: 'smoke-store', images: [],
    options: [ProductOption('Colour', ['Red', 'Blue'])],
    variants: [
      ProductVariant(variantId: 'v-red', label: 'Red', optionValues: {'Colour': 'Red'}, priceMinor: 250000, inStock: true),
      ProductVariant(variantId: 'v-blue', label: 'Blue', optionValues: {'Colour': 'Blue'}, priceMinor: 270000, inStock: false),
    ],
  );
  Object? fail;
  final queries = <ProductQuery>[];

  @override
  Future<List<CategoryNode>> categories() async => const [CategoryNode(id: 'c1', name: 'Gadgets', slug: 'gadgets')];
  @override
  Future<PageResult<ProductSummary>> products(ProductQuery query, {String? cursor, int limit = 20}) async {
    queries.add(query);
    if (fail != null) throw fail!;
    final q = query.text?.toLowerCase();
    return PageResult(items: q == null ? items : items.where((p) => p.title.toLowerCase().contains(q)).toList());
  }

  @override
  Future<ProductDetail> product(String slug) async => detail;
  @override
  Future<ReviewSummary> reviews(String slug) async => const ReviewSummary(reviews: [], count: 0);
}

Future<AppDependencies> buildFakeDeps({required Responder api, bool signedIn = false, FakeCartRepo? cart, FakeCheckoutRepo? checkout, FakeOrdersRepo? orders, FakeCatalogRepo? catalog}) async {
  final rig = TestRig(api, allowedRoles: {'customer'});
  if (signedIn) await rig.session.login('a@b.co', 'password-1234');
  final obs = await initObservability(enableFirebase: false);
  return AppDependencies(
    config: rig.config,
    client: rig.client,
    session: rig.session,
    store: rig.store,
    catalog: catalog ?? FakeCatalogRepo(),
    cart: cart ?? FakeCartRepo(),
    checkout: checkout ?? FakeCheckoutRepo(),
    orders: orders ?? FakeOrdersRepo(),
    notifications: _NoNotifications(),
    account: _NoAccount(),
    badge: CartBadgeCubit(),
    registrar: DeviceRegistrar(client: rig.client, store: rig.store, appId: 'com.test.app', platform: 'android'),
    obs: obs,
  );
}

Responder loginOk({String role = 'customer'}) => (req) => req.path == '/auth/login'
    ? FakeReply.ok({'user': userJson(role: role), 'tokens': {'accessToken': 'at', 'refreshToken': 'rt'}})
    : req.path == '/auth/refresh'
        ? FakeReply.ok({'accessToken': 'at2', 'refreshToken': 'rt2'})
        : req.path == '/me'
            ? FakeReply.ok(userJson(role: role))
            : FakeReply.ok({});

class _NoNotifications implements NotificationsRepository {
  @override
  Future<PageResult<AppNotification>> list({String? cursor}) async => const PageResult(items: []);
  @override
  Future<void> markRead(String id) async {}
}

class _NoAccount implements AccountRepository {
  @override
  Future<SessionUser> updateName(String name) async => throw UnimplementedError();
  @override
  Future<void> changePassword(String current, String next) async {}
  @override
  Future<void> verifyEmail(String code) async {}
  @override
  Future<void> resendVerification() async {}
  @override
  Future<List<DeviceSession>> sessions() async => const [];
  @override
  Future<void> revokeSession(String id) async {}
  @override
  Future<List<Address>> addresses() async => const [];
  @override
  Future<Address> addAddress(AddressInput input) async => home;
  @override
  Future<void> deleteAddress(String id) async {}
}
