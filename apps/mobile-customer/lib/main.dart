import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:flutter/material.dart';
import 'package:observability/observability.dart';

import 'app/app.dart';
import 'app/deps.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final obs = await initObservability(); // safe no-ops when Firebase is not configured for this build
  await runZonedGuarded(() async {
    final config = AppConfig.fromEnvironment(appId: 'com.bazarflow.customer');
    final deps = AppDependencies.build(config: config, store: SecureTokenStore(namespace: 'bazarflow.customer'), obs: obs);
    runApp(CustomerApp(deps: deps));
  }, (error, stack) => obs.crash.recordError(error, stack, fatal: true));
}
