import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class SplashPage extends StatelessWidget {
  const SplashPage({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(body: Center(child: Semantics(label: 'Loading', child: const CircularProgressIndicator())));
}

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
          action: BfButton(label: 'Try again', loading: _busy, onPressed: () async {
            setState(() => _busy = true);
            await widget.onRetry();
            if (mounted) setState(() => _busy = false);
          }),
        ),
      );
}

class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;
  @override
  Widget build(BuildContext context) => Scaffold(
        body: shell,
        bottomNavigationBar: NavigationBar(
          selectedIndex: shell.currentIndex,
          onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.monitor_heart_outlined), selectedIcon: Icon(Icons.monitor_heart), label: 'Overview'),
            NavigationDestination(icon: Icon(Icons.checklist_outlined), selectedIcon: Icon(Icons.checklist), label: 'Queues'),
            NavigationDestination(icon: Icon(Icons.search), label: 'Orders'),
            NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Account'),
          ],
        ),
      );
}
