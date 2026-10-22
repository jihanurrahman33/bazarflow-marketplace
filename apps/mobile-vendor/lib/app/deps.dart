import 'package:app_core/app_core.dart';
import 'package:observability/observability.dart';

import '../features/inventory/data/catalog_ops_repository.dart';
import '../features/money/data/money_repository.dart';
import '../features/notifications/data/notifications_repository.dart';
import '../features/orders/data/orders_repository.dart';

/// Allow-listed in-app routes a push notification may open.
final vendorDeepLinks = <RegExp>[
  RegExp(r'^/vendor/orders/[0-9a-f]{24}$'),
  RegExp(r'^/vendor/products/[0-9a-f]{24}$'),
  RegExp(r'^/vendor/payouts$'),
];

/// Server deep links are prefixed `/vendor/…`; the app's own routes drop that prefix.
String? appRouteFor(String? serverLink) {
  final link = safeDeepLink(serverLink, vendorDeepLinks);
  if (link == null) return null;
  return link.route.replaceFirst('/vendor', '');
}

class AppDependencies {
  AppDependencies({
    required this.config,
    required this.client,
    required this.session,
    required this.store,
    required this.orders,
    required this.catalog,
    required this.money,
    required this.notifications,
    required this.registrar,
    required this.obs,
  });
  final AppConfig config;
  final ApiClient client;
  final SessionManager session;
  final TokenStore store;
  final OrdersRepository orders;
  final CatalogOpsRepository catalog;
  final MoneyRepository money;
  final NotificationsRepository notifications;
  final DeviceRegistrar registrar;
  final ObservabilityBundle obs;

  factory AppDependencies.build({
    required AppConfig config,
    required TokenStore store,
    required ObservabilityBundle obs,
    ApiClient? client,
  }) {
    final api = client ?? ApiClient(config);
    return AppDependencies(
      config: config,
      client: api,
      session: SessionManager(
        client: api,
        store: store,
        config: config,
        allowedRoles: const {'vendor'},
      ),
      store: store,
      orders: ApiOrdersRepository(api),
      catalog: ApiCatalogOpsRepository(api),
      money: ApiMoneyRepository(api),
      notifications: ApiNotificationsRepository(api),
      registrar: DeviceRegistrar(
        client: api,
        store: store,
        appId: config.appId,
        platform: config.platform,
      ),
      obs: obs,
    );
  }
}
