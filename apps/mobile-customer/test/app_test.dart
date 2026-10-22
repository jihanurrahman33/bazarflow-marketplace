import 'package:app_core/app_core.dart';
import 'package:app_core/testing.dart';
import 'package:customer_app/app/app.dart';
import 'package:customer_app/app/router.dart';
import 'package:customer_app/features/cart/domain/cart_models.dart';
import 'package:customer_app/features/orders/presentation/order_pages.dart';
import 'package:customer_app/features/checkout/domain/checkout_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/app/deps.dart';
import 'package:design_system/design_system.dart';

import 'fakes.dart';

/// Dio and secure storage need the real event loop; the widget tree itself runs under fake async.
Future<AppDependencies> makeDeps(WidgetTester t, {required Responder api, bool signedIn = false, FakeCartRepo? cart, FakeCheckoutRepo? checkout, FakeOrdersRepo? orders, FakeCatalogRepo? catalog}) async =>
    (await t.runAsync(() => buildFakeDeps(api: api, signedIn: signedIn, cart: cart, checkout: checkout, orders: orders, catalog: catalog)))!;

Future<void> settle(WidgetTester t) async {
  for (var i = 0; i < 6; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

Future<void> pumpApp(WidgetTester t, AppDependencies deps) async {
  await t.pumpWidget(CustomerApp(deps: deps));
  await settle(t);
}

void main() {
  group('router redirects', () {
    final u = Uri.parse;
    const user = SessionUser(id: 'u', email: 'e@x.co', name: 'N', role: 'customer');

    test('booting and unavailable sessions are held on their own screens', () {
      expect(redirectFor(const SessionBooting(), u('/orders')), '/splash');
      expect(redirectFor(const SessionBooting(), u('/splash')), isNull);
      expect(redirectFor(const SessionUnavailable(), u('/cart')), '/unavailable');
    });

    test('guests can browse, but cart/checkout/orders/account send them to sign in and then back', () {
      expect(redirectFor(const SignedOut(), u('/')), isNull);
      expect(redirectFor(const SignedOut(), u('/products/lamp')), isNull);
      expect(redirectFor(const SignedOut(), u('/search?q=x')), isNull);
      for (final p in ['/cart', '/checkout', '/orders', '/orders/abc', '/account', '/account/addresses', '/notifications']) {
        expect(redirectFor(const SignedOut(), u(p)), '/login?next=${Uri.encodeComponent(p)}', reason: p);
      }
      expect(redirectFor(const SignedOut(reason: 'expired'), u('/splash')), '/');
    });

    test('signed-in users are bounced off auth screens, honouring only same-app "next" targets', () {
      expect(redirectFor(const SignedIn(user), u('/login')), '/');
      expect(redirectFor(const SignedIn(user), u('/login?next=%2Forders')), '/orders');
      expect(redirectFor(const SignedIn(user), u('/login?next=https%3A%2F%2Fevil.example')), '/');
      expect(redirectFor(const SignedIn(user), u('/login?next=%2F%2Fevil.example')), '/');
      expect(redirectFor(const SignedIn(user), u('/cart')), isNull);
    });
  });

  group('login', () {
    testWidgets('validates locally, then signs in and lands on home', (t) async {
      final deps = await makeDeps(t, api: (req) => req.path == '/auth/login' ? FakeReply.ok({'user': userJson(), 'tokens': {'accessToken': 'at', 'refreshToken': 'rt'}}) : FakeReply.ok({}));
      await pumpApp(t, deps);
      expect(find.text('New arrivals'), findsOneWidget); // guest lands on home after bootstrap (no stored session)

      await t.tap(find.byTooltip('Notifications'));
      await settle(t);
      await t.pageBack();
      await settle(t);
      // go to a protected tab -> sign-in
      await t.tap(find.text('Account'));
      await settle(t);
      expect(find.text('Welcome back'), findsOneWidget);

      await t.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await settle(t);
      expect(find.text('Enter a valid email address'), findsOneWidget);
      expect(find.text('Required'), findsOneWidget);

      await t.enterText(find.widgetWithText(TextFormField, 'Email'), 'a@b.co');
      await t.enterText(find.widgetWithText(TextFormField, 'Password'), 'password-1234');
      await t.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await settle(t);
      expect(deps.session.state, isA<SignedIn>());
      expect(find.text('Welcome back'), findsNothing);
    });

    testWidgets('a wrong password shows the server error inline and keeps the form', (t) async {
      final deps = await makeDeps(t, api: (req) => req.path == '/auth/login' ? FakeReply.error(401, 'INVALID_CREDENTIALS') : FakeReply.ok({}));
      await pumpApp(t, deps);
      await t.tap(find.text('Account'));
      await settle(t);
      await t.enterText(find.widgetWithText(TextFormField, 'Email'), 'a@b.co');
      await t.enterText(find.widgetWithText(TextFormField, 'Password'), 'wrong-password');
      await t.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await settle(t);
      expect(find.text('Email or password is incorrect.'), findsOneWidget);
      expect(find.widgetWithText(TextFormField, 'Email'), findsOneWidget);
    });

    testWidgets('an admin account is refused by the customer app', (t) async {
      final deps = await makeDeps(t, api: loginOk(role: 'admin'));
      await pumpApp(t, deps);
      await t.tap(find.text('Account'));
      await settle(t);
      await t.enterText(find.widgetWithText(TextFormField, 'Email'), 'a@b.co');
      await t.enterText(find.widgetWithText(TextFormField, 'Password'), 'password-1234');
      await t.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await settle(t);
      expect(deps.session.state, isNot(isA<SignedIn>()));
      expect(find.text('This account cannot be used in this app.'), findsOneWidget);
    });
  });

  group('catalogue', () {
    testWidgets('home lists products from the API; failure shows a retryable error', (t) async {
      final catalog = FakeCatalogRepo();
      final deps = await makeDeps(t, api: loginOk(), catalog: catalog);
      await pumpApp(t, deps);
      expect(find.text('Desk Lamp'), findsOneWidget);
      expect(find.text('৳2,500.00'), findsOneWidget);
    });

    testWidgets('offline home shows an error panel, and Try again recovers', (t) async {
      final catalog = FakeCatalogRepo()..fail = apiDown;
      final deps = await makeDeps(t, api: loginOk(), catalog: catalog);
      await pumpApp(t, deps);
      expect(find.text('Try again'), findsOneWidget);
      expect(find.byIcon(Icons.wifi_off), findsOneWidget);
      catalog.fail = null;
      await t.tap(find.text('Try again'));
      await settle(t);
      expect(find.text('Desk Lamp'), findsOneWidget);
    });

    testWidgets('search debounces and shows an empty state distinct from errors', (t) async {
      final catalog = FakeCatalogRepo();
      final deps = await makeDeps(t, api: loginOk(), catalog: catalog);
      await pumpApp(t, deps);
      await t.tap(find.text('Search').last);
      await settle(t);
      final before = catalog.queries.length;
      await t.enterText(find.byType(TextField).first, 'zzz');
      await t.pump(const Duration(milliseconds: 100));
      expect(catalog.queries.length, before); // debounced: not fired yet
      await t.pump(const Duration(milliseconds: 500));
      await settle(t);
      expect(catalog.queries.last.text, 'zzz');
      expect(find.text('No results for “zzz”'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsNothing);
    });

    testWidgets('product page: options gate the buy button, out-of-stock options are disabled, guests are sent to sign in', (t) async {
      final deps = await makeDeps(t, api: loginOk());
      await pumpApp(t, deps);
      await t.tap(find.text('Desk Lamp'));
      await settle(t);
      expect(find.text('Select options'), findsOneWidget);
      expect(tester(t, 'Blue').onSelected, isNull); // sold out: not selectable
      await t.tap(find.text('Red'));
      await settle(t);
      expect(find.text('Add to cart'), findsOneWidget);
      await t.scrollUntilVisible(find.text('Add to cart'), 100, scrollable: find.byType(Scrollable).first);
      await t.tap(find.text('Add to cart'));
      await settle(t);
      expect(find.text('Welcome back'), findsOneWidget); // guest -> login
    });

    testWidgets('signed-in shopper adds to cart: badge updates and a snackbar confirms', (t) async {
      final cart = FakeCartRepo()..current = quote2();
      final deps = await makeDeps(t, api: loginOk(), signedIn: true, cart: cart);
      await pumpApp(t, deps);
      await t.tap(find.text('Desk Lamp'));
      await settle(t);
      await t.tap(find.text('Red'));
      await settle(t);
      await t.scrollUntilVisible(find.text('Add to cart'), 100, scrollable: find.byType(Scrollable).first);
      await t.tap(find.text('Add to cart'));
      await settle(t);
      expect(find.text('Added to cart'), findsOneWidget);
      expect(deps.badge.state, 2);
      expect(cart.calls, contains('add'));
    });
  });

  group('cart', () {
    testWidgets('shows seller groups, flags stock problems and blocks checkout until fixed', (t) async {
      final cart = FakeCartRepo()..current = sampleQuote(items: 3, issues: const [CartIssue(itemId: 'p1.v1', code: 'INSUFFICIENT_STOCK', availableQuantity: 1)]);
      final deps = await makeDeps(t, api: loginOk(), signedIn: true, cart: cart);
      await pumpApp(t, deps);
      await t.tap(find.text('Cart').last);
      await settle(t);
      expect(find.text('Sold by Shop'), findsOneWidget);
      expect(find.textContaining('Not enough stock (1 left)'), findsOneWidget);
      expect(find.text('Some items need attention'), findsOneWidget);
      expect(t.widget<FilledButton>(find.widgetWithText(FilledButton, 'Checkout')).onPressed, isNull);
    });

    testWidgets('empty cart has its own state with a way back', (t) async {
      final cart = FakeCartRepo()..current = sampleQuote(items: 0);
      final deps = await makeDeps(t, api: loginOk(), signedIn: true, cart: cart);
      await pumpApp(t, deps);
      await t.tap(find.text('Cart').last);
      await settle(t);
      expect(find.text('Your cart is empty'), findsOneWidget);
      expect(find.text('Start shopping'), findsOneWidget);
    });
  });

  group('order page', () {
    Future<void> openOrder(WidgetTester t, FakeOrdersRepo orders, {bool returned = false}) async {
      final deps = await makeDeps(t, api: loginOk(), signedIn: true, orders: orders);
      await t.pumpWidget(RepositoryProvider<AppDependencies>.value(value: deps, child: MaterialApp(theme: BfTheme.light(), home: OrderPage(orderId: 'o1', returnedFromPayment: returned))));
      await settle(t);
    }

    testWidgets('while the provider is still confirming, the shopper is told NOT to pay again', (t) async {
      await openOrder(t, FakeOrdersRepo());
      expect(find.text('Waiting for payment confirmation'), findsOneWidget);
      expect(find.textContaining("Please don't pay again"), findsOneWidget);
      expect(find.text('Try payment again'), findsNothing);
      expect(find.text('Pay now'), findsNothing);
    });

    testWidgets('an unknown payment outcome is surfaced honestly, with no retry', (t) async {
      final repo = FakeOrdersRepo()..currentPayment = const PaymentView(id: 'p', status: 'unknown', canRetry: false, message: 'We are confirming this payment with the provider.');
      await openOrder(t, repo);
      expect(find.text('We are confirming your payment'), findsOneWidget);
      expect(find.text('Try payment again'), findsNothing);
    });

    testWidgets('a failed payment offers a retry; a paid COD order shows tracking and no payment banners', (t) async {
      final failed = FakeOrdersRepo()..currentPayment = const PaymentView(id: 'p', status: 'failed', canRetry: true);
      await openOrder(t, failed);
      expect(find.text('Try payment again'), findsOneWidget);
      expect(find.text('Waiting for payment confirmation'), findsNothing);
    });

    testWidgets('cancel asks for confirmation first', (t) async {
      final repo = FakeOrdersRepo()..currentPayment = const PaymentView(id: 'p', status: 'failed', canRetry: true);
      await openOrder(t, repo);
      await t.scrollUntilVisible(find.text('Cancel order'), 100, scrollable: find.byType(Scrollable).first);
      await t.tap(find.text('Cancel order'));
      await settle(t);
      expect(find.text('Cancel this order?'), findsOneWidget);
      await t.tap(find.text('Cancel').last);
      await settle(t);
      expect(repo.actions, isNot(contains('cancel')));
      await t.tap(find.text('Cancel order'));
      await settle(t);
      await t.tap(find.text('Yes, cancel order'));
      await settle(t);
      expect(repo.actions, contains('cancel'));
    });

    testWidgets('an unreachable server shows a retryable error, not a blank screen', (t) async {
      final repo = FakeOrdersRepo()..failGet = apiDown;
      await openOrder(t, repo);
      expect(find.text('Try again'), findsOneWidget);
    });
  });
}

Quote quote2() => sampleQuote(items: 2);

ChoiceChip tester(WidgetTester t, String label) => t.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, label));
