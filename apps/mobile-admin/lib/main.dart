import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:flutter/material.dart';
import 'package:observability/observability.dart';

import 'app/app.dart';
import 'app/deps.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final obs = await initObservability();
  await runZonedGuarded(() async {
    final config = AppConfig.fromEnvironment(appId: 'com.bazarflow.admin');
    final deps = AppDependencies.build(config: config, store: SecureTokenStore(namespace: 'bazarflow.admin'), obs: obs);
    runApp(AdminApp(deps: deps));
  }, (error, stack) => obs.crash.recordError(error, stack, fatal: true));
}
