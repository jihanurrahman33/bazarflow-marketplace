import 'package:app_core/app_core.dart';
import 'package:observability/observability.dart';

import '../features/queues/data/admin_repository.dart';

class AppDependencies {
  AppDependencies({required this.config, required this.client, required this.session, required this.store, required this.admin, required this.obs});
  final AppConfig config;
  final ApiClient client;
  final SessionManager session;
  final TokenStore store;
  final AdminRepository admin;
  final ObservabilityBundle obs;

  factory AppDependencies.build({required AppConfig config, required TokenStore store, required ObservabilityBundle obs, ApiClient? client}) {
    final api = client ?? ApiClient(config);
    return AppDependencies(
      config: config,
      client: api,
      // Staff only. A customer or seller account signing in here is refused and its session closed.
      session: SessionManager(client: api, store: store, config: config, allowedRoles: const {'admin'}),
      store: store,
      admin: ApiAdminRepository(api),
      obs: obs,
    );
  }
}
