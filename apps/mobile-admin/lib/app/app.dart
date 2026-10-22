import 'dart:async';

import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import 'deps.dart';
import 'router.dart';

class AdminApp extends StatefulWidget {
  const AdminApp({super.key, required this.deps});
  final AppDependencies deps;
  @override
  State<AdminApp> createState() => _AdminAppState();
}

class _AdminAppState extends State<AdminApp> {
  final _navKey = GlobalKey<NavigatorState>();
  late final GoRouter _router = buildRouter(widget.deps, _navKey);

  @override
  void initState() {
    super.initState();
    final deps = widget.deps;
    // Step-up authentication: when the server demands it, ask for the password in a dialog over whatever is on screen.
    deps.session.requestPassword = () {
      final ctx = _navKey.currentContext;
      return ctx == null ? Future.value(null) : promptPassword(ctx);
    };
    unawaited(deps.session.bootstrap());
  }

  @override
  Widget build(BuildContext context) => RepositoryProvider.value(
        value: widget.deps,
        child: MaterialApp.router(title: 'BazarFlow Admin', debugShowCheckedModeBanner: false, theme: BfTheme.light(), darkTheme: BfTheme.dark(), routerConfig: _router),
      );
}
