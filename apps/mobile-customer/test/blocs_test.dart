import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:app_core/testing.dart';
import 'package:customer_app/features/auth/presentation/auth_cubits.dart';
import 'package:customer_app/features/cart/domain/cart_models.dart';
import 'package:customer_app/features/cart/presentation/cart_bloc.dart';
import 'package:customer_app/features/checkout/domain/checkout_models.dart';
import 'package:customer_app/features/checkout/presentation/checkout_bloc.dart';
import 'package:customer_app/features/orders/presentation/order_cubit.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fakes.dart';

const priceChanged = ApiException(status: 409, code: 'PRICE_CHANGED', message: 'x');

void main() {
  group('CartBloc', () {
    test('loads the cart, updates the badge and reports server issues', () async {
      final repo = FakeCartRepo()..current = sampleQuote(items: 2, issues: const [CartIssue(itemId: 'p1.v1', code: 'INSUFFICIENT_STOCK', availableQuantity: 1)]);
      final badge = CartBadgeCubit();
      final bloc = CartBloc(repo, badge)..add(const CartStarted());
      await bloc.stream.firstWhere((s) => s is CartLoaded);
      expect((bloc.state as CartLoaded).quote.issueFor('p1.v1')?.availableQuantity, 1);
      expect(badge.state, 2);
    });

    test('first-load failure is a failure state; retry works', () async {
      final repo = FakeCartRepo()..failWith = apiDown;
      final bloc = CartBloc(repo, CartBadgeCubit())..add(const CartStarted());
      await bloc.stream.firstWhere((s) => s is CartFailure);
      repo.failWith = null;
      bloc.add(const CartStarted());
      await bloc.stream.firstWhere((s) => s is CartLoaded);
    });

    test('a quantity change disables that line while in flight and ignores rapid second taps', () async {
      final repo = FakeCartRepo()..gate = Completer<void>();
      final bloc = CartBloc(repo, CartBadgeCubit());
      repo.gate!.complete();
      bloc.add(const CartStarted());
      await bloc.stream.firstWhere((s) => s is CartLoaded);
      repo.gate = Completer<void>();
      repo.current = sampleQuote(items: 2);
      bloc.add(const CartQuantityChanged('p1.v1', 2));
      await bloc.stream.firstWhere((s) => s is CartLoaded && s.busyItemId == 'p1.v1');
      bloc.add(const CartQuantityChanged('p1.v1', 3)); // dropped
      bloc.add(const CartItemRemoved('p1.v1')); // dropped
      await Future<void>.delayed(const Duration(milliseconds: 5)); // both extra taps are delivered while the first is still in flight
      repo.gate!.complete();
      await bloc.stream.firstWhere((s) => s is CartLoaded && s.busyItemId == null);
      expect(repo.calls.where((c) => c.startsWith('set') || c.startsWith('remove')), ['set:p1.v1:2']);
    });

    test('a failed mutation keeps the cart and reports the error', () async {
      final repo = FakeCartRepo();
      final bloc = CartBloc(repo, CartBadgeCubit())..add(const CartStarted());
      await bloc.stream.firstWhere((s) => s is CartLoaded);
      repo.failWith = const ApiException(status: 409, code: 'INVENTORY_UNAVAILABLE', message: 'x');
      bloc.add(const CartQuantityChanged('p1.v1', 9));
      final s = await bloc.stream.firstWhere((s) => s is CartLoaded && s.actionError != null) as CartLoaded;
      expect(s.quote, sampleQuote());
    });
  });

  group('CheckoutBloc', () {
    CheckoutBloc make(FakeCheckoutRepo repo) {
      var n = 0;
      return CheckoutBloc(repo, keyFactory: () => 'key-${++n}');
    }

    Future<CheckoutBloc> ready(FakeCheckoutRepo repo) async {
      final bloc = make(repo)..add(const CheckoutStarted());
      await bloc.stream.firstWhere((s) => s.phase == CheckoutPhase.ready && s.quote != null && !s.quoting);
      return bloc;
    }

    test('selects the default address, loads the quote and is placeable', () async {
      final bloc = await ready(FakeCheckoutRepo());
      expect(bloc.state.selectedAddressId, 'a1');
      expect(bloc.state.canPlace, isTrue);
    });

    test('no addresses: cannot place until one is added; adding one selects it and re-quotes', () async {
      final repo = FakeCheckoutRepo()..addressList = [];
      final bloc = make(repo)..add(const CheckoutStarted());
      await bloc.stream.firstWhere((s) => s.phase == CheckoutPhase.ready);
      expect(bloc.state.canPlace, isFalse);
      bloc.add(const CheckoutAddressAdded(AddressInput(label: 'Home', recipient: 'R R', phone: '+8801700000000', line1: 'House 1', city: 'Dhaka', district: 'Dhaka', postalCode: '1212')));
      await bloc.stream.firstWhere((s) => s.selectedAddressId == 'a-new' && s.quote != null && !s.quoting);
      expect(bloc.state.canPlace, isTrue);
    });

    test('items with issues block placing', () async {
      final repo = FakeCheckoutRepo()..nextQuote = sampleQuote(issues: const [CartIssue(itemId: 'p1.v1', code: 'INSUFFICIENT_STOCK')]);
      final bloc = await ready(repo);
      expect(bloc.state.canPlace, isFalse);
      bloc.add(const CheckoutPlaceOrderPressed());
      await Future<void>.delayed(Duration.zero);
      expect(repo.placeCalls, isEmpty);
    });

    test('places the order once with the expected total and surfaces the payment redirect', () async {
      final repo = FakeCheckoutRepo();
      final bloc = await ready(repo);
      bloc.add(const CheckoutPlaceOrderPressed());
      await bloc.stream.firstWhere((s) => s.phase == CheckoutPhase.placed);
      expect(repo.placeCalls.single.total, 100000);
      expect(bloc.state.placed!.payment!.redirectUrl, 'https://pay.example/x');
    });

    test('a network failure keeps the idempotency key so retrying cannot create a second order', () async {
      final repo = FakeCheckoutRepo()..placeFailures.add(apiDown);
      final bloc = await ready(repo);
      bloc.add(const CheckoutPlaceOrderPressed());
      await bloc.stream.firstWhere((s) => s.phase == CheckoutPhase.ready && s.error != null);
      bloc.add(const CheckoutPlaceOrderPressed());
      await bloc.stream.firstWhere((s) => s.phase == CheckoutPhase.placed);
      expect(repo.placeKeys, ['key-1', 'key-1']);
    });

    test('changing inputs between attempts uses a NEW key', () async {
      final repo = FakeCheckoutRepo()..placeFailures.add(apiDown);
      final bloc = await ready(repo);
      bloc.add(const CheckoutPlaceOrderPressed());
      await bloc.stream.firstWhere((s) => s.error != null);
      bloc.add(const CheckoutMethodSelected(PaymentMethod.cod));
      bloc.add(const CheckoutPlaceOrderPressed());
      await bloc.stream.firstWhere((s) => s.phase == CheckoutPhase.placed);
      expect(repo.placeKeys, ['key-1', 'key-2']);
    });

    test('PRICE_CHANGED refreshes the summary, flags it stale, and the next attempt gets a fresh key', () async {
      final repo = FakeCheckoutRepo()..placeFailures.add(priceChanged);
      final bloc = await ready(repo);
      repo.nextQuote = sampleQuote(total: 120000);
      bloc.add(const CheckoutPlaceOrderPressed());
      await bloc.stream.firstWhere((s) => s.stale && s.quote?.totalMinor == 120000 && !s.quoting);
      expect(bloc.state.canPlace, isTrue);
      bloc.add(const CheckoutPlaceOrderPressed());
      await bloc.stream.firstWhere((s) => s.phase == CheckoutPhase.placed);
      expect(repo.placeCalls.last.total, 120000);
      expect(repo.placeKeys, ['key-1', 'key-2']);
    });

    test('double press while placing creates one order', () async {
      final repo = FakeCheckoutRepo();
      final bloc = await ready(repo);
      bloc..add(const CheckoutPlaceOrderPressed())..add(const CheckoutPlaceOrderPressed());
      await bloc.stream.firstWhere((s) => s.phase == CheckoutPhase.placed);
      await Future<void>.delayed(Duration.zero);
      expect(repo.placeCalls.length, 1);
    });

    test('COD is only kept when the server offers it', () async {
      final repo = FakeCheckoutRepo()..nextQuote = sampleQuote(methods: const ['online']);
      final bloc = await ready(repo);
      bloc.add(const CheckoutMethodSelected(PaymentMethod.cod));
      bloc.add(const CheckoutAddressSelected('a1'));
      await bloc.stream.firstWhere((s) => s.quote != null && !s.quoting && s.method == PaymentMethod.online);
    });
  });

  group('OrderCubit', () {
    OrderCubit make(FakeOrdersRepo repo, {bool fromPayment = false, int maxPolls = 5}) => OrderCubit(repo, 'o1', pollInterval: Duration.zero, maxPolls: maxPolls, cameFromPayment: fromPayment);

    test('loads the order and payment; a pending payment is "verifying" and never invites paying again', () async {
      final repo = FakeOrdersRepo()..afterRefresh = order(status: 'confirmed', paymentStatus: 'paid', vo: 'new');
      repo.paymentAfterRefresh = const PaymentView(id: 'pay1', status: 'succeeded', canRetry: false);
      final cubit = make(repo)..load();
      final first = await cubit.stream.firstWhere((s) => s is OrderLoaded && s.verifying) as OrderLoaded;
      expect(first.canPayAgain, isFalse);
      await cubit.stream.firstWhere((s) => s is OrderLoaded && s.order.status == 'confirmed');
      expect((cubit.state as OrderLoaded).verifying, isFalse);
    });

    test('polling is bounded, then hands control back to the user', () async {
      final repo = FakeOrdersRepo(); // payment stays pending forever
      final cubit = make(repo, maxPolls: 3)..load();
      await cubit.stream.firstWhere((s) => s is OrderLoaded && s.pollsLeft == 0 && !s.polling && repo.refreshes >= 3);
      expect(repo.refreshes, 3);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(repo.refreshes, 3); // stopped
      expect((cubit.state as OrderLoaded).verifying, isTrue); // still unresolved: the UI shows "Check status"
    });

    test('returning from the provider triggers verification even if the payment still looks like requires_action', () async {
      final repo = FakeOrdersRepo()..currentPayment = const PaymentView(id: 'pay1', status: 'requires_action', canRetry: false, redirectUrl: 'https://pay.example/x');
      final cubit = make(repo, fromPayment: true, maxPolls: 2)..load();
      await cubit.stream.firstWhere((s) => s is OrderLoaded && repo.refreshes >= 1);
    });

    test('a failed payment offers a retry that returns the new hosted-payment URL', () async {
      final repo = FakeOrdersRepo()..currentPayment = const PaymentView(id: 'pay1', status: 'failed', canRetry: true);
      final cubit = make(repo);
      await cubit.load();
      expect((cubit.state as OrderLoaded).canPayAgain, isTrue);
      expect(await cubit.payAgain(), 'https://pay.example/retry');
      expect(repo.actions, ['startPayment']);
    });

    test('cancel updates the order; failures are reported without losing the order', () async {
      final repo = FakeOrdersRepo()..currentPayment = const PaymentView(id: 'pay1', status: 'failed', canRetry: true);
      final cubit = make(repo);
      await cubit.load();
      repo.failAction = apiDown;
      await cubit.cancel();
      expect((cubit.state as OrderLoaded).actionError, apiDown);
      expect((cubit.state as OrderLoaded).order.status, 'pending_payment');
      repo.failAction = null;
      await cubit.cancel();
      expect((cubit.state as OrderLoaded).order.status, 'cancelled');
    });

    test('load failure is a failure state; a failed refresh keeps the order on screen', () async {
      final repo = FakeOrdersRepo()..failGet = apiDown;
      final cubit = make(repo);
      await cubit.load();
      expect(cubit.state, isA<OrderFailure>());
      repo.failGet = null;
      await cubit.load();
      expect(cubit.state, isA<OrderLoaded>());
      repo.failGet = apiDown;
      await cubit.load();
      expect((cubit.state as OrderLoaded).refreshError, apiDown);
    });

    test('closing the screen stops polling', () async {
      final repo = FakeOrdersRepo();
      final cubit = OrderCubit(repo, 'o1', pollInterval: const Duration(milliseconds: 5), maxPolls: 100)..load();
      await cubit.stream.firstWhere((s) => s is OrderLoaded && repo.refreshes >= 1);
      await cubit.close();
      final n = repo.refreshes;
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(repo.refreshes, n);
    });
  });

  group('auth cubits', () {
    test('login success and failure', () async {
      final ok = TestRig((_) => FakeReply.ok({'user': userJson(), 'tokens': {'accessToken': 'a', 'refreshToken': 'r'}}));
      final login = LoginCubit(ok.session);
      await login.submit(' A@b.co ', 'password-1234');
      expect(login.state, const AuthFormDone());
      expect(ok.adapter.requests.single.body, contains('"email":"A@b.co"')); // trimmed

      final bad = TestRig((_) => FakeReply.error(401, 'INVALID_CREDENTIALS'));
      final l2 = LoginCubit(bad.session);
      await l2.submit('a@b.co', 'wrong-password');
      expect((l2.state as AuthFormFailed).error.code, 'INVALID_CREDENTIALS');
    });

    test('a second submit while one is running is ignored', () async {
      final gate = Completer<void>();
      final rig = TestRig((_) async {
        await gate.future;
        return FakeReply.ok({'user': userJson(), 'tokens': {'accessToken': 'a', 'refreshToken': 'r'}});
      });
      final cubit = LoginCubit(rig.session);
      final first = cubit.submit('a@b.co', 'password-1234');
      await cubit.submit('a@b.co', 'password-1234');
      gate.complete();
      await first;
      expect(rig.adapter.requests.length, 1);
    });

    test('email pattern', () {
      expect(emailPattern.hasMatch('a@b.co'), isTrue);
      expect(emailPattern.hasMatch('a b@c.d'), isFalse);
      expect(emailPattern.hasMatch('nope'), isFalse);
    });
  });
}
