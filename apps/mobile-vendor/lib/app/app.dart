import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:observability/observability.dart';

import 'deps.dart';
import 'router.dart';

class VendorApp extends StatefulWidget {
  const VendorApp({super.key, required this.deps, this.router});
  final AppDependencies deps;
  final GoRouter? router;
  @override
  State<VendorApp> createState() => _VendorAppState();
}

class _VendorAppState extends State<VendorApp> {
  late final GoRouter _router = widget.router ?? buildRouter(widget.deps);
  final _subs = <StreamSubscription<Object?>>[];

  @override
  void initState() {
    super.initState();
    final deps = widget.deps;
    _subs
      ..add(
        deps.session.states.listen((s) async {
          if (s is SignedIn) {
            unawaited(deps.obs.crash.setUserId(s.user.id));
            unawaited(deps.obs.analytics.setUserRole(s.user.role));
            if (await deps.obs.push.requestPermission()) {
              final token = await deps.obs.push.token();
              if (token != null) {
                unawaited(deps.registrar.register(token).catchError((_) {}));
              }
            }
          }
        }),
      )
      ..add(
        deps.obs.push.onTokenRefresh.listen((t) {
          if (deps.session.state is SignedIn) {
            unawaited(deps.registrar.register(t).catchError((_) {}));
          }
        }),
      )
      ..add(
        deps.obs.push.onOpenedLink.listen((raw) {
          final route = appRouteFor(raw);
          if (route != null) {
            unawaited(
              deps.obs.analytics.log(AnalyticsEvents.notificationOpened),
            );
            _router.push(route);
          }
        }),
      );
    unawaited(deps.session.bootstrap());
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => RepositoryProvider.value(
    value: widget.deps,
    child: MaterialApp.router(
      title: 'BazarFlow Seller',
      debugShowCheckedModeBanner: false,
      theme: BfTheme.light(),
      darkTheme: BfTheme.dark(),
      routerConfig: _router,
    ),
  );
}
