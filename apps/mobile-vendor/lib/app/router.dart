import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../features/account/presentation/account_pages.dart';
import '../features/inventory/presentation/inventory_pages.dart';
import '../features/money/presentation/money_pages.dart';
import '../features/notifications/presentation/notifications_page.dart';
import '../features/orders/presentation/order_pages.dart';
import 'deps.dart';
import 'shell.dart';

class SessionRefresh extends ChangeNotifier {
  SessionRefresh(Stream<SessionState> states) {
    _sub = states.listen((_) => notifyListeners());
  }
  late final StreamSubscription<SessionState> _sub;
  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}

/// Everything except the sign-in screen needs a vendor session.
String? redirectFor(SessionState state, Uri location) {
  final path = location.path;
  if (state is SessionBooting) return path == '/splash' ? null : '/splash';
  if (state is SessionUnavailable) {
    return path == '/unavailable' ? null : '/unavailable';
  }
  if (state is SignedOut) return path == '/login' ? null : '/login';
  if (state is SignedIn &&
      (path == '/login' || path == '/splash' || path == '/unavailable')) {
    return '/';
  }
  return null;
}

GoRouter buildRouter(AppDependencies deps) {
  final refresh = SessionRefresh(deps.session.states);
  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) => redirectFor(deps.session.state, state.uri),
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashPage()),
      GoRoute(
        path: '/unavailable',
        builder: (_, _) => UnavailablePage(onRetry: deps.session.bootstrap),
      ),
      GoRoute(path: '/login', builder: (_, _) => const LoginPage()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/', builder: (_, _) => const OverviewPage()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/orders',
                builder: (_, s) =>
                    OrdersPage(initialStatus: s.uri.queryParameters['status']),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/products',
                builder: (_, _) => const ProductsPage(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/earnings',
                builder: (_, _) => const EarningsPage(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/account', builder: (_, _) => const AccountPage()),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/orders/:id',
        builder: (_, s) => OrderDetailPage(id: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/products/:id',
        builder: (_, s) => ProductDetailPage(id: s.pathParameters['id']!),
      ),
      GoRoute(path: '/payouts', builder: (_, _) => const EarningsPage()),
      GoRoute(path: '/inventory', builder: (_, _) => const InventoryPage()),
      GoRoute(
        path: '/notifications',
        builder: (_, _) => const NotificationsPage(),
      ),
    ],
  );
}
