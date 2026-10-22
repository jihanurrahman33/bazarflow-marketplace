import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';

const boom = ApiException(status: 503, code: 'INTERNAL', message: 'x');

void main() {
  group('ResourceCubit', () {
    blocTest<ResourceCubit<int>, ResourceState<int>>(
      'loading -> loaded',
      build: () => ResourceCubit(() async => 7),
      act: (c) => c.load(),
      expect: () => [const ResourceLoading<int>(), const ResourceLoaded<int>(7)],
    );

    blocTest<ResourceCubit<int>, ResourceState<int>>(
      'first-load failure -> failure (retry works)',
      build: () {
        var n = 0;
        return ResourceCubit(() async => ++n == 1 ? throw boom : 9);
      },
      act: (c) async {
        await c.load();
        await c.load();
      },
      expect: () => [const ResourceLoading<int>(), const ResourceFailure<int>(boom), const ResourceLoading<int>(), const ResourceLoaded<int>(9)],
    );

    blocTest<ResourceCubit<int>, ResourceState<int>>(
      'refresh keeps data on screen (no skeleton flicker) and a failed refresh keeps stale data with an error',
      build: () {
        var n = 0;
        return ResourceCubit(() async => ++n == 2 ? throw boom : n);
      },
      act: (c) async {
        await c.load();
        await c.refresh();
      },
      expect: () => [
        const ResourceLoading<int>(),
        const ResourceLoaded<int>(1),
        const ResourceLoaded<int>(1, refreshing: true),
        const ResourceLoaded<int>(1, refreshError: boom),
      ],
    );

    test('a slow older response never overwrites a newer one (stale response race)', () async {
      final completers = <Completer<int>>[];
      final cubit = ResourceCubit<int>(() {
        final c = Completer<int>();
        completers.add(c);
        return c.future;
      });
      final first = cubit.load();
      final second = cubit.refresh();
      completers[1].complete(2);
      await second;
      completers[0].complete(1); // the old request lands last
      await first;
      expect(cubit.state, const ResourceLoaded<int>(2));
    });
  });

  group('PagedCubit', () {
    PageFetcher<int> pages() => (cursor) async {
          final start = cursor == null ? 0 : int.parse(cursor);
          return PageResult(items: [start, start + 1], nextCursor: start + 2 < 6 ? '${start + 2}' : null);
        };

    blocTest<PagedCubit<int>, PagedState<int>>(
      'first page then load more until exhausted',
      build: () => PagedCubit(pages()),
      act: (c) async {
        await c.load();
        await c.loadMore();
        await c.loadMore();
        await c.loadMore(); // no more pages: ignored
      },
      expect: () => [
        const PagedLoading<int>(),
        const PagedLoaded<int>([0, 1], nextCursor: '2'),
        const PagedLoaded<int>([0, 1], nextCursor: '2', loadingMore: true),
        const PagedLoaded<int>([0, 1, 2, 3], nextCursor: '4'),
        const PagedLoaded<int>([0, 1, 2, 3], nextCursor: '4', loadingMore: true),
        const PagedLoaded<int>([0, 1, 2, 3, 4, 5]),
      ],
    );

    blocTest<PagedCubit<int>, PagedState<int>>(
      'empty result is its own state, not a failure',
      build: () => PagedCubit((_) async => const PageResult<int>(items: [])),
      act: (c) => c.load(),
      expect: () => [const PagedLoading<int>(), const PagedEmpty<int>()],
    );

    blocTest<PagedCubit<int>, PagedState<int>>(
      'load-more failure keeps the list and reports the error inline',
      build: () {
        var n = 0;
        return PagedCubit((cursor) async => ++n == 2 ? throw boom : PageResult(items: [n], nextCursor: 'c'));
      },
      act: (c) async {
        await c.load();
        await c.loadMore();
      },
      expect: () => [
        const PagedLoading<int>(),
        const PagedLoaded<int>([1], nextCursor: 'c'),
        const PagedLoaded<int>([1], nextCursor: 'c', loadingMore: true),
        const PagedLoaded<int>([1], nextCursor: 'c', error: boom),
      ],
    );

    test('changing the query ignores responses to the previous query (stale search results)', () async {
      final completers = <String, Completer<PageResult<String>>>{};
      PageFetcher<String> forQuery(String q) => (_) {
            final c = Completer<PageResult<String>>();
            completers[q] = c;
            return c.future;
          };
      final cubit = PagedCubit<String>(forQuery('a'));
      final a = cubit.reload();
      final ab = cubit.reload(forQuery('ab'));
      completers['ab']!.complete(const PageResult(items: ['ab-result']));
      await ab;
      completers['a']!.complete(const PageResult(items: ['a-result'])); // slow, older query lands last
      await a;
      expect(cubit.state, const PagedLoaded<String>(['ab-result']));
    });

    test('loadMore is ignored while refreshing and cannot append to a reloaded list', () async {
      final gate = Completer<PageResult<int>>();
      var call = 0;
      final cubit = PagedCubit<int>((cursor) {
        call++;
        if (call == 2) return gate.future; // the loadMore call hangs
        return Future.value(PageResult(items: [call], nextCursor: 'next'));
      });
      await cubit.load();
      final more = cubit.loadMore();
      await cubit.reload(); // user pulls to refresh / changes filter meanwhile
      gate.complete(const PageResult(items: [99]));
      await more;
      expect((cubit.state as PagedLoaded<int>).items, [3]); // 99 was discarded
    });

    test('after a failed load-more, scroll-triggered loads stop until the user taps retry', () async {
      var calls = 0;
      final cubit = PagedCubit<int>((cursor) async => ++calls == 2 ? throw boom : PageResult(items: [calls], nextCursor: 'c'));
      await cubit.load();
      await cubit.loadMore();
      await cubit.loadMore();
      await cubit.loadMore();
      expect(calls, 2);
      await cubit.loadMore(retry: true);
      expect(calls, 3);
      expect((cubit.state as PagedLoaded<int>).items, [1, 3]);
    });

    test('patchItems edits locally and empties the list when the last item is removed', () async {
      final cubit = PagedCubit<int>((_) async => const PageResult(items: [1]));
      await cubit.load();
      cubit.patchItems((i) => []);
      expect(cubit.state, const PagedEmpty<int>());
    });
  });
}
