import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

Widget host(Widget child) => MaterialApp(theme: BfTheme.light(), home: Scaffold(body: child));
const boom = ApiException(status: 503, code: 'INTERNAL', message: 'x', requestId: 'req-1');

void main() {
  group('BfPagedView', () {
    Widget view(PagedCubit<String> cubit) => host(BlocProvider.value(value: cubit, child: BfPagedView<String>(itemBuilder: (_, s) => ListTile(title: Text(s)), emptyTitle: 'No items')));

    testWidgets('skeleton -> items; empty and failure are distinct; retry reloads', (tester) async {
      var fail = true;
      final gate = Completer<void>();
      final cubit = PagedCubit<String>((_) async {
        await gate.future;
        return fail ? throw boom : const PageResult(items: ['alpha', 'beta']);
      });
      final f = cubit.load();
      await tester.pumpWidget(view(cubit));
      expect(find.bySemanticsLabel('Loading'), findsOneWidget);
      gate.complete();
      await f;
      await tester.pump();
      expect(find.text('Try again'), findsOneWidget);
      expect(find.textContaining('req-1'), findsOneWidget);
      fail = false;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('alpha'), findsOneWidget);
      expect(find.text('beta'), findsOneWidget);
    });

    testWidgets('empty state shows the configured copy', (tester) async {
      final cubit = PagedCubit<String>((_) async => const PageResult(items: []));
      await cubit.load();
      await tester.pumpWidget(view(cubit));
      expect(find.text('No items'), findsOneWidget);
    });

    testWidgets('scrolling near the end loads the next page; a failed page shows an inline retry and keeps the list', (tester) async {
      var calls = 0;
      final cubit = PagedCubit<String>((cursor) async {
        calls++;
        if (calls == 2) throw boom;
        final base = cursor == null ? 0 : int.parse(cursor);
        return PageResult(items: [for (var i = 0; i < 12; i++) 'item ${base + i}'], nextCursor: base == 0 ? '12' : null);
      });
      await cubit.load();
      await tester.pumpWidget(view(cubit));
      await tester.drag(find.byType(ListView), const Offset(0, -3000));
      await tester.pumpAndSettle();
      expect(calls, 2);
      await tester.drag(find.byType(ListView), const Offset(0, -500)); // scrolling again must NOT hammer the failing server
      await tester.pumpAndSettle();
      expect(calls, 2);
      expect(find.text('Retry'), findsOneWidget); // inline, list still there
      expect(find.byType(ListTile), findsWidgets);
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      expect(calls, 3);
      expect((cubit.state as PagedLoaded<String>).items.length, 24);
    });
  });

  group('BfResourceView', () {
    Widget view(ResourceCubit<int> cubit) => host(BlocProvider.value(value: cubit, child: BfResourceView<int>(builder: (_, v) => Text('value $v'))));

    testWidgets('refresh keeps the data visible and a failed refresh shows an offline notice with the stale value', (tester) async {
      var n = 0;
      final gate = Completer<int>();
      final cubit = ResourceCubit<int>(() {
        n++;
        if (n == 1) return Future.value(1);
        if (n == 2) return gate.future;
        throw const ApiException(status: 0, code: ApiException.network, message: 'x');
      });
      await cubit.load();
      await tester.pumpWidget(view(cubit));
      expect(find.text('value 1'), findsOneWidget);
      final refresh = cubit.refresh();
      await tester.pump();
      expect(find.text('value 1'), findsOneWidget); // no skeleton flicker
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      gate.complete(2);
      await refresh;
      await tester.pump();
      expect(find.text('value 2'), findsOneWidget);
      await cubit.refresh();
      await tester.pump();
      expect(find.text('value 2'), findsOneWidget); // stale data stays
      expect(find.textContaining("You're offline"), findsOneWidget);
    });

    testWidgets('first-load failure shows the error panel', (tester) async {
      final cubit = ResourceCubit<int>(() async => throw boom);
      await cubit.load();
      await tester.pumpWidget(view(cubit));
      expect(find.text("We couldn't load this"), findsOneWidget);
    });
  });
}
