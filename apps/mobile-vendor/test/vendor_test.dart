import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:app_core/testing.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vendor_app/app/app.dart';
import 'package:vendor_app/app/deps.dart';
import 'package:vendor_app/app/router.dart';
import 'package:vendor_app/features/orders/presentation/order_detail_cubit.dart';
import 'package:vendor_app/features/orders/presentation/order_pages.dart';

import 'fakes.dart';

Future<AppDependencies> makeDeps(WidgetTester t, {required Responder api, bool signedIn = false, FakeOrdersRepo? orders}) async => (await t.runAsync(() => buildFakeDeps(api: api, signedIn: signedIn, orders: orders)))!;

Future<void> settle(WidgetTester t) async {
  for (var i = 0; i < 6; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  group('router', () {
    final u = Uri.parse;
    const vendor = SessionUser(id: 'u', email: 'e@x.co', name: 'N', role: 'vendor');
    test('everything needs a session; signed-in vendors skip the sign-in screen', () {
      expect(redirectFor(const SessionBooting(), u('/orders')), '/splash');
      expect(redirectFor(const SessionUnavailable(), u('/')), '/unavailable');
      for (final p in ['/', '/orders', '/orders/abc', '/earnings', '/inventory']) {
        expect(redirectFor(const SignedOut(), u(p)), '/login', reason: p);
      }
      expect(redirectFor(const SignedOut(), u('/login')), isNull);
      expect(redirectFor(const SignedIn(vendor), u('/login')), '/');
      expect(redirectFor(const SignedIn(vendor), u('/orders/abc')), isNull);
    });

    test('notification links are allow-listed and mapped to app routes', () {
      expect(appRouteFor('/vendor/orders/0123456789abcdef01234567'), '/orders/0123456789abcdef01234567');
      expect(appRouteFor('/vendor/payouts'), '/payouts');
      for (final bad in [null, '', 'https://evil.example', '/admin/users', '/vendor/orders/../x', '/orders/0123456789abcdef01234567']) {
        expect(appRouteFor(bad), isNull, reason: '$bad');
      }
    });
  });

  group('OrderDetailCubit', () {
    test('runs an action once, disables further actions while in flight, and applies the new state', () async {
      final repo = FakeOrdersRepo()..gate = Completer<void>();
      final cubit = OrderDetailCubit(repo, 'o1');
      repo.gate!.complete();
      await cubit.load();
      repo.gate = Completer<void>();
      final first = cubit.accept();
      expect((cubit.state as OrderDetailLoaded).acting, isTrue); // emitted synchronously, before any await
      await cubit.accept(); // ignored: already acting
      await cubit.cancel('changed my mind'); // ignored too
      repo.gate!.complete();
      await first;
      expect(repo.actions, ['accept']);
      expect((cubit.state as OrderDetailLoaded).order.status, 'accepted');
      expect((cubit.state as OrderDetailLoaded).notice, 'Order accepted');
    });

    test('a conflict (changed elsewhere) reports the error and reloads the truth', () async {
      final repo = FakeOrdersRepo();
      final cubit = OrderDetailCubit(repo, 'o1');
      await cubit.load();
      repo.fail = const ApiException(status: 409, code: 'INVALID_STATE_TRANSITION', message: 'x');
      repo.current = order(status: 'cancelled');
      await cubit.accept();
      expect((cubit.state as OrderDetailLoaded).order.status, 'cancelled'); // reloaded
    });

    test('network failures keep the order on screen with the error', () async {
      final repo = FakeOrdersRepo();
      final cubit = OrderDetailCubit(repo, 'o1');
      await cubit.load();
      repo.fail = apiDown;
      await cubit.deliver();
      final s = cubit.state as OrderDetailLoaded;
      expect(s.actionError, apiDown);
      expect(s.order.status, 'new');
      expect(s.acting, isFalse);
    });

    test('first-load failure is a failure state', () async {
      final repo = FakeOrdersRepo()..fail = apiDown;
      final cubit = OrderDetailCubit(repo, 'o1');
      await cubit.load();
      expect(cubit.state, isA<OrderDetailFailure>());
    });
  });

  group('screens', () {
    testWidgets('only seller accounts can sign in; customers are refused with a clear message', (t) async {
      final deps = await makeDeps(t, api: authOk(role: 'customer'));
      await t.pumpWidget(VendorApp(deps: deps));
      await settle(t);
      expect(find.text('Manage your store'), findsOneWidget);
      await t.enterText(find.widgetWithText(TextFormField, 'Email'), 's@shop.co');
      await t.enterText(find.widgetWithText(TextFormField, 'Password'), 'password-1234');
      await t.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await settle(t);
      expect(deps.session.state, isNot(isA<SignedIn>()));
      expect(find.text('This account cannot be used in this app.'), findsOneWidget);
    });

    testWidgets('a seller signs in and sees the overview with balances and waiting orders', (t) async {
      final deps = await makeDeps(t, api: authOk());
      await t.pumpWidget(VendorApp(deps: deps));
      await settle(t);
      await t.enterText(find.widgetWithText(TextFormField, 'Email'), 's@shop.co');
      await t.enterText(find.widgetWithText(TextFormField, 'Password'), 'password-1234');
      await t.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await settle(t);
      expect(find.text('Orders waiting for you'), findsOneWidget);
      expect(find.text('৳3,600.00'), findsOneWidget); // available
      expect(find.text('BF-o1'), findsOneWidget);
    });

    Future<void> openOrder(WidgetTester t, FakeOrdersRepo repo) async {
      final deps = await makeDeps(t, api: authOk(), signedIn: true, orders: repo);
      await t.pumpWidget(RepositoryProvider<AppDependencies>.value(value: deps, child: MaterialApp(theme: BfTheme.light(), home: const OrderDetailPage(id: 'o1'))));
      await settle(t);
    }

    testWidgets('a new order offers accept/reject only; COD shows what to collect; earnings are net of commission', (t) async {
      final repo = FakeOrdersRepo()..current = order(method: 'cod');
      await openOrder(t, repo);
      expect(find.text('Accept order'), findsOneWidget);
      expect(find.text('Reject'), findsOneWidget);
      expect(find.text('Mark as shipped'), findsNothing);
      expect(find.text('Cash on delivery'), findsOneWidget);
      expect(find.textContaining('Collect ৳1,000.00'), findsOneWidget);
      expect(find.text('৳900.00'), findsOneWidget); // your earnings
      await t.tap(find.text('Accept order'));
      await settle(t);
      expect(repo.actions, ['accept']);
      expect(find.text('Mark as shipped'), findsOneWidget);
      expect(find.text('Accept order'), findsNothing);
    });

    testWidgets('shipping needs carrier and tracking number; rejecting needs a reason', (t) async {
      final repo = FakeOrdersRepo()..current = order(status: 'accepted');
      await openOrder(t, repo);
      await t.tap(find.text('Mark as shipped'));
      await settle(t);
      expect(t.widget<FilledButton>(find.descendant(of: find.byType(AlertDialog), matching: find.widgetWithText(FilledButton, 'Mark as shipped'))).onPressed, isNull); // empty details: cannot submit
      expect(repo.actions, isEmpty);
      await t.enterText(find.widgetWithText(TextField, 'Carrier (e.g. Pathao)'), 'Pathao');
      await t.enterText(find.widgetWithText(TextField, 'Tracking number'), 'PT-1001');
      await settle(t);
      final btn = find.descendant(of: find.byType(AlertDialog), matching: find.widgetWithText(FilledButton, 'Mark as shipped'));
      expect(t.widget<FilledButton>(btn).onPressed, isNotNull); // both fields filled: enabled
      await t.tap(btn);
      await settle(t);
      expect(repo.actions, ['ship:Pathao:PT-1001']);
      expect(find.text('Mark as delivered'), findsOneWidget);
    });

    testWidgets('cancelling asks for a reason first', (t) async {
      final repo = FakeOrdersRepo();
      await openOrder(t, repo);
      await t.tap(find.text('Reject'));
      await settle(t);
      expect(t.widget<FilledButton>(find.widgetWithText(FilledButton, 'Cancel order')).onPressed, isNull);
      await t.enterText(find.byType(TextField), 'Out of stock');
      await t.pump();
      await t.tap(find.widgetWithText(FilledButton, 'Cancel order'));
      await settle(t);
      expect(repo.actions, ['cancel:Out of stock']);
    });

    testWidgets('an unreachable server shows a retryable error', (t) async {
      final repo = FakeOrdersRepo()..fail = apiDown;
      await openOrder(t, repo);
      expect(find.text('Try again'), findsOneWidget);
    });
  });
}
