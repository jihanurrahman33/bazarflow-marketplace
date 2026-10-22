import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../features/cart/presentation/cart_bloc.dart';

class SplashPage extends StatelessWidget {
  const SplashPage({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(body: Center(child: Semantics(label: 'Loading', child: const CircularProgressIndicator())));
}

/// Shown when a stored session exists but the server could not be reached. Never silently signs the user out.
class UnavailablePage extends StatefulWidget {
  const UnavailablePage({super.key, required this.onRetry});
  final Future<void> Function() onRetry;
  @override
  State<UnavailablePage> createState() => _UnavailablePageState();
}

class _UnavailablePageState extends State<UnavailablePage> {
  bool _busy = false;
  @override
  Widget build(BuildContext context) => Scaffold(
        body: BfEmptyState(
          icon: Icons.wifi_off,
          title: "We can't reach BazarFlow",
          message: 'Check your connection. You are still signed in.',
          action: BfButton(
            label: 'Try again',
            loading: _busy,
            onPressed: () async {
              setState(() => _busy = true);
              await widget.onRetry();
              if (mounted) setState(() => _busy = false);
            },
          ),
        ),
      );
}

class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
        destinations: [
          const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          const NavigationDestination(icon: Icon(Icons.search), label: 'Search'),
          NavigationDestination(
            icon: BlocBuilder<CartBadgeCubit, int>(
              builder: (_, n) => Badge(isLabelVisible: n > 0, label: Text('$n'), child: const Icon(Icons.shopping_cart_outlined)),
            ),
            label: 'Cart',
          ),
          const NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Orders'),
          const NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Account'),
        ],
      ),
    );
  }
}
