import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../features/account/presentation/account_pages.dart';
import '../features/auth/presentation/auth_pages.dart';
import '../features/cart/presentation/cart_page.dart';
import '../features/catalog/presentation/catalog_pages.dart';
import '../features/checkout/presentation/checkout_page.dart';
import '../features/notifications/presentation/notifications_page.dart';
import '../features/orders/presentation/order_pages.dart';
import 'deps.dart';
import 'shell.dart';

/// Re-evaluates the router's redirects whenever the session changes.
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

const _protectedPrefixes = ['/cart', '/checkout', '/orders', '/account', '/notifications'];

/// Pure redirect logic (unit-tested): who may see which path given the session.
String? redirectFor(SessionState state, Uri location) {
  final path = location.path;
  if (state is SessionBooting) return path == '/splash' ? null : '/splash';
  if (state is SessionUnavailable) return path == '/unavailable' ? null : '/unavailable';
  if (state is SignedOut) {
    final isProtected = _protectedPrefixes.any((p) => path == p || path.startsWith('$p/'));
    if (isProtected) return '/login?next=${Uri.encodeComponent(location.toString())}';
    if (path == '/splash' || path == '/unavailable') return '/';
    return null;
  }
  if (state is SignedIn) {
    if (path == '/login' || path == '/register' || path == '/splash' || path == '/unavailable') {
      final next = location.queryParameters['next'];
      return next != null && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    }
  }
  return null;
}

GoRouter buildRouter(AppDependencies deps, {String initialLocation = '/splash'}) {
  final refresh = SessionRefresh(deps.session.states);
  return GoRouter(
    initialLocation: initialLocation,
    refreshListenable: refresh,
    redirect: (context, state) => redirectFor(deps.session.state, state.uri),
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashPage()),
      GoRoute(path: '/unavailable', builder: (_, _) => UnavailablePage(onRetry: deps.session.bootstrap)),
      GoRoute(path: '/login', builder: (_, s) => LoginPage(next: s.uri.queryParameters['next'])),
      GoRoute(path: '/register', builder: (_, s) => RegisterPage(next: s.uri.queryParameters['next'])),
      GoRoute(path: '/verify-email', builder: (_, _) => const VerifyEmailPage()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/', builder: (_, _) => const HomePage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/search', builder: (_, s) => SearchPage(initialQuery: s.uri.queryParameters['q'], category: s.uri.queryParameters['category']))]),
          StatefulShellBranch(routes: [GoRoute(path: '/cart', builder: (_, _) => const CartPage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/orders', builder: (_, _) => const OrdersPage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/account', builder: (_, _) => const AccountPage())]),
        ],
      ),
      GoRoute(path: '/products/:slug', builder: (_, s) => ProductPage(slug: s.pathParameters['slug']!)),
      GoRoute(path: '/checkout', builder: (_, _) => const CheckoutPage()),
      GoRoute(path: '/orders/:id', builder: (_, s) => OrderPage(orderId: s.pathParameters['id']!, returnedFromPayment: s.uri.queryParameters['returned'] == '1')),
      GoRoute(path: '/notifications', builder: (_, _) => const NotificationsPage()),
      GoRoute(path: '/account/addresses', builder: (_, _) => const AddressesPage()),
      GoRoute(path: '/account/devices', builder: (_, _) => const DevicesPage()),
    ],
    errorBuilder: (context, state) => Scaffold(appBar: AppBar(), body: const Center(child: Text('Page not found'))),
  );
}
