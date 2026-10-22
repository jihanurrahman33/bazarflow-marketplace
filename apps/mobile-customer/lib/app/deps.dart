import 'package:app_core/app_core.dart';
import 'package:observability/observability.dart';

import '../features/account/data/account_repository.dart';
import '../features/cart/data/cart_repository.dart';
import '../features/cart/presentation/cart_bloc.dart';
import '../features/catalog/data/catalog_repository.dart';
import '../features/checkout/data/checkout_repository.dart';
import '../features/notifications/data/notifications_repository.dart';
import '../features/orders/data/orders_repository.dart';

/// Allow-listed in-app routes a push notification may open.
final customerDeepLinks = <RegExp>[RegExp(r'^/orders/[0-9a-f]{24}$'), RegExp(r'^/products/[a-z0-9-]{1,120}$')];

/// Composition root: every collaborator is constructed here and injected; features never reach for globals.
class AppDependencies {
  AppDependencies({
    required this.config,
    required this.client,
    required this.session,
    required this.store,
    required this.catalog,
    required this.cart,
    required this.checkout,
    required this.orders,
    required this.notifications,
    required this.account,
    required this.badge,
    required this.registrar,
    required this.obs,
  });

  final AppConfig config;
  final ApiClient client;
  final SessionManager session;
  final TokenStore store;
  final CatalogRepository catalog;
  final CartRepository cart;
  final CheckoutRepository checkout;
  final OrdersRepository orders;
  final NotificationsRepository notifications;
  final AccountRepository account;
  final CartBadgeCubit badge;
  final DeviceRegistrar registrar;
  final ObservabilityBundle obs;

  factory AppDependencies.build({required AppConfig config, required TokenStore store, required ObservabilityBundle obs, ApiClient? client}) {
    final api = client ?? ApiClient(config);
    final session = SessionManager(client: api, store: store, config: config, allowedRoles: const {'customer'});
    return AppDependencies(
      config: config,
      client: api,
      session: session,
      store: store,
      catalog: ApiCatalogRepository(api),
      cart: ApiCartRepository(api),
      checkout: ApiCheckoutRepository(api),
      orders: ApiOrdersRepository(api),
      notifications: ApiNotificationsRepository(api),
      account: ApiAccountRepository(api),
      badge: CartBadgeCubit(),
      registrar: DeviceRegistrar(client: api, store: store, appId: config.appId, platform: config.platform),
      obs: obs,
    );
  }
}
