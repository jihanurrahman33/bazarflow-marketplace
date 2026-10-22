import 'package:admin_app/app/app.dart';
import 'package:admin_app/app/deps.dart';
import 'package:admin_app/app/router.dart';
import 'package:admin_app/features/queues/data/admin_repository.dart';
import 'package:app_core/app_core.dart';
import 'package:app_core/testing.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:observability/observability.dart';

Map<String, dynamic> adminJson(List<String> perms, {String role = 'admin'}) => {...userJson(role: role), 'permissions': perms};

const allPerms = ['refund.approve', 'payout.approve', 'vendor.review', 'catalog.moderate', 'payment.reconcile', 'order.read_all', 'report.read'];

/// Scripted server for the admin API, including the step-up (password re-entry) contract.
class Api {
  Api({this.permissions = allPerms, this.role = 'admin'});
  final List<String> permissions;
  final String role;
  bool steppedUp = false;
  bool requireStepUp = true;
  final calls = <String>[];

  Map<String, dynamic> refund(String id, [String status = 'requested']) => {'id': id, 'orderId': 'o1', 'amountMinor': 25000, 'reason': 'damaged item', 'status': status, 'system': false};

  FakeReply handle(RecordedRequest r) {
    calls.add('${r.method} ${r.path}');
    switch ((r.method, r.path)) {
      case ('POST', '/auth/login'):
        return FakeReply.ok({'user': adminJson(permissions, role: role), 'tokens': {'accessToken': 'at', 'refreshToken': 'rt'}});
      case ('POST', '/auth/refresh'):
        return FakeReply.ok({'accessToken': 'at2', 'refreshToken': 'rt2'});
      case ('GET', '/me'):
        return FakeReply.ok(adminJson(permissions, role: role));
      case ('POST', '/auth/step-up'):
        if (r.body!.contains('right-password')) {
          steppedUp = true;
          return FakeReply.ok({'expiresInSeconds': 300});
        }
        return FakeReply.error(401, 'INVALID_CREDENTIALS');
      case ('GET', '/admin/refunds'):
        return FakeReply.ok([refund('r1')], meta: {'hasMore': false, 'nextCursor': null});
      case ('POST', '/admin/refunds/r1/approve'):
        return requireStepUp && !steppedUp ? FakeReply.error(403, 'STEP_UP_REQUIRED') : FakeReply.ok(refund('r1', 'succeeded'));
      case ('POST', '/admin/refunds/r1/reject'):
        return FakeReply.ok(refund('r1', 'rejected'));
      case ('GET', '/admin/vendor-applications'):
        return FakeReply.ok([
          {'id': 'a1', 'status': 'submitted', 'business': {'name': 'Gadget Hub', 'slug': 'gadget-hub', 'phone': '+8801711111111', 'address': 'Dhaka'}, 'createdAt': '2026-10-22T00:00:00.000Z'}
        ], meta: {'hasMore': false, 'nextCursor': null});
      case ('POST', '/admin/vendor-applications/a1/reject'):
        return FakeReply.ok({});
      case ('GET', '/admin/ops/health'):
        return FakeReply.ok({
          'outbox': {'pending': 2, 'dead': 1, 'oldestPendingAgeSeconds': 12},
          'payments': {'unknown': 0, 'stuckLive': 0},
          'refunds': {'processing': 0, 'failed': 0},
          'payouts': {'requested': 3, 'approved': 1},
          'reservations': {'expiredActive': 0},
        });
      case ('GET', '/admin/reports/sales'):
        return FakeReply.ok({'paidOrders': 5, 'grossMerchandiseMinor': 1250000, 'platformCommissionMinor': 125000, 'refunds': {'count': 1, 'totalMinor': 25000}});
      default:
        return FakeReply.ok({});
    }
  }
}

Future<AppDependencies> makeDeps(WidgetTester t, Api api, {bool signedIn = true}) async => (await t.runAsync(() async {
      final rig = TestRig(api.handle, allowedRoles: {'admin'});
      if (signedIn) await rig.session.login('admin@x.co', 'right-password');
      final obs = await initObservability(enableFirebase: false);
      return AppDependencies(config: rig.config, client: rig.client, session: rig.session, store: rig.store, admin: ApiAdminRepository(rig.client), obs: obs);
    }))!;

Future<void> settle(WidgetTester t) async {
  for (var i = 0; i < 6; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

Future<void> openQueues(WidgetTester t, AppDependencies deps) async {
  await t.pumpWidget(AdminApp(deps: deps));
  await settle(t);
  await t.tap(find.text('Queues'));
  await settle(t);
}

void main() {
  group('router', () {
    final u = Uri.parse;
    const admin = SessionUser(id: 'u', email: 'e@x.co', name: 'N', role: 'admin');
    test('every screen needs a staff session', () {
      expect(redirectFor(const SessionBooting(), u('/queues')), '/splash');
      expect(redirectFor(const SessionUnavailable(), u('/')), '/unavailable');
      for (final p in ['/', '/queues', '/queues/refunds', '/orders/abc', '/account']) {
        expect(redirectFor(const SignedOut(), u(p)), '/login', reason: p);
      }
      expect(redirectFor(const SignedIn(admin), u('/login')), '/');
      expect(redirectFor(const SignedIn(admin), u('/queues/refunds')), isNull);
    });
  });

  group('sign in', () {
    for (final role in ['customer', 'vendor']) {
      testWidgets('a $role account is refused and nothing is kept', (t) async {
        final api = Api(role: role, permissions: const []);
        final deps = await makeDeps(t, api, signedIn: false);
        await t.pumpWidget(AdminApp(deps: deps));
        await settle(t);
        await t.enterText(find.widgetWithText(TextFormField, 'Work email'), 'a@b.co');
        await t.enterText(find.widgetWithText(TextFormField, 'Password'), 'right-password');
        await t.tap(find.widgetWithText(FilledButton, 'Sign in'));
        await settle(t);
        expect(deps.session.state, isNot(isA<SignedIn>()));
        expect(find.text('This account cannot be used in this app.'), findsOneWidget);
        expect(await deps.store.readRefreshToken(), isNull);
      });
    }

    testWidgets('an admin signs in and sees system health and the sales summary', (t) async {
      final deps = await makeDeps(t, Api(), signedIn: false);
      await t.pumpWidget(AdminApp(deps: deps));
      await settle(t);
      await t.enterText(find.widgetWithText(TextFormField, 'Work email'), 'admin@x.co');
      await t.enterText(find.widgetWithText(TextFormField, 'Password'), 'right-password');
      await t.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await settle(t);
      expect(find.text('System health'), findsOneWidget);
      expect(find.text('Something needs attention.'), findsOneWidget); // one dead background event
      expect(find.text('৳12,500.00'), findsOneWidget); // gross
    });
  });

  group('permissions shape the UI (the API still decides)', () {
    testWidgets('queue tiles appear only for permissions the admin holds', (t) async {
      final deps = await makeDeps(t, Api(permissions: const ['refund.approve']));
      await openQueues(t, deps);
      expect(find.text('Refunds'), findsOneWidget);
      expect(find.text('Seller applications'), findsNothing);
      expect(find.text('Payouts'), findsNothing);
    });

    testWidgets('an admin with no permissions sees an explanation, not an empty screen', (t) async {
      final deps = await makeDeps(t, Api(permissions: const []));
      await openQueues(t, deps);
      expect(find.text('No queues for your role'), findsOneWidget);
    });
  });

  group('step-up authentication on refund approval', () {
    Future<void> openRefunds(WidgetTester t, AppDependencies deps) async {
      await openQueues(t, deps);
      await t.tap(find.text('Refunds'));
      await settle(t);
      expect(find.text('damaged item'), findsOneWidget);
    }

    testWidgets('the server asks for the password, the app prompts once, then the SAME approval succeeds', (t) async {
      final api = Api();
      final deps = await makeDeps(t, api);
      await openRefunds(t, deps);
      await t.tap(find.widgetWithText(FilledButton, 'Approve'));
      await settle(t);
      expect(find.text('Approve this refund?'), findsOneWidget);
      await t.tap(find.widgetWithText(FilledButton, 'Approve').last); // confirm the intent
      await settle(t);
      expect(find.text('Confirm your password'), findsOneWidget); // step-up prompt
      expect(t.widget<TextField>(find.byType(TextField).last).obscureText, isTrue);
      await t.enterText(find.byType(TextField).last, 'right-password');
      await t.pump();
      await t.tap(find.widgetWithText(FilledButton, 'Confirm'));
      await settle(t);
      expect(find.text('Refund approved'), findsOneWidget);
      expect(api.calls.where((c) => c == 'POST /admin/refunds/r1/approve').length, 2); // rejected once, replayed once
      expect(api.calls.where((c) => c == 'POST /auth/step-up').length, 1);
    });

    testWidgets('a wrong password does not approve anything and says so', (t) async {
      final api = Api();
      final deps = await makeDeps(t, api);
      await openRefunds(t, deps);
      await t.tap(find.widgetWithText(FilledButton, 'Approve'));
      await settle(t);
      await t.tap(find.widgetWithText(FilledButton, 'Approve').last);
      await settle(t);
      await t.enterText(find.byType(TextField).last, 'nope-nope');
      await t.pump();
      await t.tap(find.widgetWithText(FilledButton, 'Confirm'));
      await settle(t);
      expect(find.text('Email or password is incorrect.'), findsOneWidget);
      expect(api.steppedUp, isFalse);
      expect(api.calls.where((c) => c == 'POST /admin/refunds/r1/approve').length, 1); // never replayed
    });

    testWidgets('cancelling the password prompt leaves the refund untouched', (t) async {
      final api = Api();
      final deps = await makeDeps(t, api);
      await openRefunds(t, deps);
      await t.tap(find.widgetWithText(FilledButton, 'Approve'));
      await settle(t);
      await t.tap(find.widgetWithText(FilledButton, 'Approve').last);
      await settle(t);
      await t.tap(find.text('Cancel').last);
      await settle(t);
      expect(find.text('Password confirmation was cancelled.'), findsOneWidget);
      expect(api.steppedUp, isFalse);
    });

    testWidgets('already stepped-up sessions are not prompted again', (t) async {
      final api = Api()..steppedUp = true;
      final deps = await makeDeps(t, api);
      await openRefunds(t, deps);
      await t.tap(find.widgetWithText(FilledButton, 'Approve'));
      await settle(t);
      await t.tap(find.widgetWithText(FilledButton, 'Approve').last);
      await settle(t);
      expect(find.text('Confirm your password'), findsNothing);
      expect(find.text('Refund approved'), findsOneWidget);
    });
  });

  group('moderation actions need a reason', () {
    testWidgets('rejecting a seller application sends the reason the admin typed', (t) async {
      final api = Api();
      final deps = await makeDeps(t, api);
      await openQueues(t, deps);
      await t.tap(find.text('Seller applications'));
      await settle(t);
      expect(find.text('Gadget Hub'), findsOneWidget);
      await t.tap(find.widgetWithText(FilledButton, 'Reject'));
      await settle(t);
      expect(t.widget<FilledButton>(find.widgetWithText(FilledButton, 'Reject').last).onPressed, isNull); // empty reason
      await t.enterText(find.byType(TextField).last, 'Licence missing');
      await t.pump();
      await t.tap(find.widgetWithText(FilledButton, 'Reject').last);
      await settle(t);
      expect(api.calls, contains('POST /admin/vendor-applications/a1/reject'));
      expect(find.text('Rejected'), findsOneWidget);
    });
  });
}
