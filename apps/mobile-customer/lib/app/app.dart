import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:observability/observability.dart';

import 'deps.dart';
import 'router.dart';

class CustomerApp extends StatefulWidget {
  const CustomerApp({super.key, required this.deps, this.router});
  final AppDependencies deps;
  final GoRouter? router;
  @override
  State<CustomerApp> createState() => _CustomerAppState();
}

class _CustomerAppState extends State<CustomerApp> {
  late final GoRouter _router = widget.router ?? buildRouter(widget.deps);
  final _subs = <StreamSubscription<Object?>>[];

  @override
  void initState() {
    super.initState();
    final deps = widget.deps;
    deps.session.requestPassword = null; // customers never need step-up
    _subs
      // Keep the server's device registry in step with this install after sign-in.
      ..add(deps.session.states.listen((s) async {
        if (s is SignedIn) {
          unawaited(deps.obs.crash.setUserId(s.user.id));
          unawaited(deps.obs.analytics.setUserRole(s.user.role));
          if (await deps.obs.push.requestPermission()) {
            final token = await deps.obs.push.token();
            if (token != null) unawaited(deps.registrar.register(token).catchError((_) {}));
          }
        } else if (s is SignedOut) {
          unawaited(deps.obs.crash.setUserId(null));
        }
      }))
      ..add(deps.obs.push.onTokenRefresh.listen((t) {
        if (deps.session.state is SignedIn) unawaited(deps.registrar.register(t).catchError((_) {}));
      }))
      // A tapped notification (background or cold start): only allow-listed in-app routes are opened.
      ..add(deps.obs.push.onOpenedLink.listen((raw) {
        final link = safeDeepLink(raw, customerDeepLinks);
        if (link != null) {
          unawaited(deps.obs.analytics.log(AnalyticsEvents.notificationOpened));
          _router.push(link.route);
        }
      }));
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
  Widget build(BuildContext context) {
    return RepositoryProvider.value(
      value: widget.deps,
      child: BlocProvider.value(
        value: widget.deps.badge,
        child: MaterialApp.router(
          title: 'BazarFlow',
          debugShowCheckedModeBanner: false,
          theme: BfTheme.light(),
          darkTheme: BfTheme.dark(),
          routerConfig: _router,
        ),
      ),
    );
  }
}

