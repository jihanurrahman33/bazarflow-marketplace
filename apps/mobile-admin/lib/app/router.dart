import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../features/account/presentation/account_pages.dart';
import '../features/ops/presentation/overview_page.dart';
import '../features/orders/presentation/order_pages.dart';
import '../features/queues/presentation/queue_pages.dart';
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

String? redirectFor(SessionState state, Uri location) {
  final path = location.path;
  if (state is SessionBooting) return path == '/splash' ? null : '/splash';
  if (state is SessionUnavailable) return path == '/unavailable' ? null : '/unavailable';
  if (state is SignedOut) return path == '/login' ? null : '/login';
  if (state is SignedIn && (path == '/login' || path == '/splash' || path == '/unavailable')) return '/';
  return null;
}

GoRouter buildRouter(AppDependencies deps, GlobalKey<NavigatorState> navigatorKey) {
  final refresh = SessionRefresh(deps.session.states);
  return GoRouter(
    navigatorKey: navigatorKey,
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) => redirectFor(deps.session.state, state.uri),
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashPage()),
      GoRoute(path: '/unavailable', builder: (_, _) => UnavailablePage(onRetry: deps.session.bootstrap)),
      GoRoute(path: '/login', builder: (_, _) => const LoginPage()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/', builder: (_, _) => const OverviewPage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/queues', builder: (_, _) => const QueuesHomePage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/orders', builder: (_, _) => const OrderSearchPage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/account', builder: (_, _) => const AccountPage())]),
        ],
      ),
      GoRoute(path: '/queues/applications', builder: (_, _) => const ApplicationsQueue()),
      GoRoute(path: '/queues/products', builder: (_, _) => const ProductsQueue()),
      GoRoute(path: '/queues/payments', builder: (_, _) => const PaymentsQueue()),
      GoRoute(path: '/queues/refunds', builder: (_, _) => const RefundsQueue()),
      GoRoute(path: '/queues/payouts', builder: (_, _) => const PayoutsQueue()),
      GoRoute(path: '/orders/:id', builder: (_, s) => OrderSupportPage(id: s.pathParameters['id']!)),
    ],
  );
}
