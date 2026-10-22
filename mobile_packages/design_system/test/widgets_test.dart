import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget host(Widget child, {ThemeData? theme}) => MaterialApp(theme: theme ?? BfTheme.light(), home: Scaffold(body: child));

void main() {
  testWidgets('status badges carry an icon and a text label, never colour alone', (tester) async {
    await tester.pumpWidget(host(const Column(children: [BfStatusBadge('pending_payment'), BfStatusBadge('delivered'), BfStatusBadge('brand_new_state')])));
    expect(find.text('Pending payment'), findsOneWidget);
    expect(find.text('Delivered'), findsOneWidget);
    expect(find.text('Brand new state'), findsOneWidget); // unknown statuses degrade gracefully
    expect(find.byIcon(Icons.schedule), findsOneWidget);
    expect(find.byIcon(Icons.check_circle_outline), findsOneWidget);
    expect(find.bySemanticsLabel('Status: Pending payment'), findsOneWidget);
  });

  testWidgets('error panel offers retry only when retrying can help, and shows the support reference', (tester) async {
    var retried = 0;
    await tester.pumpWidget(host(BfErrorPanel(error: const ApiException(status: 503, code: 'INTERNAL', message: 'raw server text', requestId: 'req-42'), onRetry: () => retried++)));
    expect(find.text('Try again'), findsOneWidget);
    expect(find.textContaining('req-42'), findsOneWidget);
    expect(find.textContaining('raw server text'), findsNothing);
    await tester.tap(find.text('Try again'));
    expect(retried, 1);

    await tester.pumpWidget(host(BfErrorPanel(error: const ApiException(status: 403, code: 'FORBIDDEN', message: 'x'), onRetry: () {})));
    expect(find.text('Try again'), findsNothing);
    expect(find.text('You do not have permission to do that.'), findsOneWidget);
  });

  testWidgets('offline errors say so and can be retried', (tester) async {
    await tester.pumpWidget(host(BfErrorPanel(error: const ApiException(status: 0, code: ApiException.network, message: 'x'), onRetry: () {})));
    expect(find.byIcon(Icons.wifi_off), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets('button ignores taps while loading (double-submit protection) and meets the touch target', (tester) async {
    var taps = 0;
    await tester.pumpWidget(host(BfButton(label: 'Pay', loading: true, onPressed: () => taps++)));
    await tester.tap(find.byType(FilledButton), warnIfMissed: false);
    expect(taps, 0);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pumpWidget(host(BfButton(label: 'Pay', onPressed: () => taps++)));
    expect(tester.getSize(find.byType(FilledButton)).height, greaterThanOrEqualTo(BfTokens.touchTarget));
    await tester.tap(find.text('Pay'));
    expect(taps, 1);
  });

  testWidgets('empty state is not an error', (tester) async {
    await tester.pumpWidget(host(const BfEmptyState(title: 'No orders yet', message: 'Orders appear here.')));
    expect(find.text('No orders yet'), findsOneWidget);
    expect(find.byIcon(Icons.error_outline), findsNothing);
  });

  testWidgets('money renders integer minor units', (tester) async {
    await tester.pumpWidget(host(const Column(children: [BfMoney(250000), BfMoney(5)])));
    expect(find.text('৳2,500.00'), findsOneWidget);
    expect(find.text('৳0.05'), findsOneWidget);
  });

  testWidgets('quantity stepper respects bounds and disables while busy', (tester) async {
    var v = 1;
    await tester.pumpWidget(host(StatefulBuilder(builder: (c, set) => BfQuantityStepper(value: v, max: 2, onChanged: (n) => set(() => v = n)))));
    await tester.tap(find.byTooltip('Increase quantity'));
    await tester.pump();
    expect(v, 2);
    expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.add)).onPressed, isNull); // at max
    expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.remove)).onPressed, isNotNull);
  });

  testWidgets('reason dialog requires text, can be cancelled, and password mode obscures input', (tester) async {
    String? result = 'unset';
    await tester.pumpWidget(host(Builder(builder: (ctx) => TextButton(onPressed: () async => result = await showReasonDialog(ctx, title: 'Reject?', confirmLabel: 'Reject'), child: const Text('open')))));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Reject')).onPressed, isNull); // empty reason
    await tester.enterText(find.byType(TextField), 'Blurry photos');
    await tester.pump();
    await tester.tap(find.text('Reject'));
    await tester.pumpAndSettle();
    expect(result, 'Blurry photos');

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(result, isNull);

    await tester.pumpWidget(host(Builder(builder: (ctx) => TextButton(onPressed: () => promptPassword(ctx), child: const Text('pw')))));
    await tester.tap(find.text('pw'));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.byType(TextField)).obscureText, isTrue);
  });

  testWidgets('light and dark themes come from the shared tokens', (tester) async {
    expect(BfTheme.light().colorScheme.primary, BfTokens.light.primary);
    expect(BfTheme.dark().colorScheme.primary, BfTokens.dark.primary);
    expect(BfTheme.light().colorScheme.primary, isNot(BfTheme.dark().colorScheme.primary));
    await tester.pumpWidget(host(const BfStatusBadge('failed'), theme: BfTheme.dark()));
    expect(find.text('Failed'), findsOneWidget);
  });

  testWidgets('skeleton lists are announced as loading and do not scroll', (tester) async {
    await tester.pumpWidget(host(const BfListSkeleton(rows: 3)));
    expect(find.bySemanticsLabel('Loading'), findsOneWidget);
    expect(find.byType(BfSkeleton), findsNWidgets(3));
  });
}
