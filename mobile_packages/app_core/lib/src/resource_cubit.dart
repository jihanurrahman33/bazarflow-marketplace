import 'package:bloc/bloc.dart';
import 'package:equatable/equatable.dart';

import 'errors.dart';
import 'paging.dart';

// ---------------------------------------------------------------------------------------------------------------
// ResourceCubit: one value loaded from the API (detail screens, dashboards).
// Phases are explicit, so a screen can never be "loading and failed" at once.
// ---------------------------------------------------------------------------------------------------------------

sealed class ResourceState<T> extends Equatable {
  const ResourceState();
  @override
  List<Object?> get props => [];
}

class ResourceInitial<T> extends ResourceState<T> {
  const ResourceInitial();
}

/// First load: nothing to show yet, so show a skeleton.
class ResourceLoading<T> extends ResourceState<T> {
  const ResourceLoading();
}

/// [refreshing] is true while re-fetching with data already on screen (no flicker back to a skeleton).
/// [refreshError] is a failed refresh: keep showing the (stale) data and tell the user.
class ResourceLoaded<T> extends ResourceState<T> {
  const ResourceLoaded(this.data, {this.refreshing = false, this.refreshError});
  final T data;
  final bool refreshing;
  final ApiException? refreshError;
  @override
  List<Object?> get props => [data, refreshing, refreshError];
}

class ResourceFailure<T> extends ResourceState<T> {
  const ResourceFailure(this.error);
  final ApiException error;
  @override
  List<Object?> get props => [error];
}

class ResourceCubit<T> extends Cubit<ResourceState<T>> {
  ResourceCubit(this._fetch) : super(ResourceInitial<T>());
  final Future<T> Function() _fetch;
  int _seq = 0;

  Future<void> load() async {
    final current = state;
    if (current is ResourceLoaded<T>) return refresh();
    emit(ResourceLoading<T>());
    await _run();
  }

  Future<void> refresh() async {
    final current = state;
    if (current is ResourceLoaded<T>) {
      emit(ResourceLoaded(current.data, refreshing: true));
    } else {
      emit(ResourceLoading<T>());
    }
    await _run();
  }

  /// Replace the value after a mutation returned fresh data (no extra round trip).
  void set(T value) => emit(ResourceLoaded(value));

  Future<void> _run() async {
    final mine = ++_seq;
    try {
      final data = await _fetch();
      if (mine == _seq && !isClosed) emit(ResourceLoaded(data));
    } on ApiException catch (e) {
      if (mine != _seq || isClosed) return; // a newer request owns the screen now
      final current = state;
      if (current is ResourceLoaded<T>) {
        emit(ResourceLoaded(current.data, refreshError: e));
      } else {
        emit(ResourceFailure(e));
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// PagedCubit: cursor-paginated lists.
// ---------------------------------------------------------------------------------------------------------------

sealed class PagedState<T> extends Equatable {
  const PagedState();
  @override
  List<Object?> get props => [];
}

class PagedInitial<T> extends PagedState<T> {
  const PagedInitial();
}

class PagedLoading<T> extends PagedState<T> {
  const PagedLoading();
}

/// The query returned nothing. Distinct from a failure.
class PagedEmpty<T> extends PagedState<T> {
  const PagedEmpty();
}

class PagedLoaded<T> extends PagedState<T> {
  const PagedLoaded(this.items, {this.nextCursor, this.loadingMore = false, this.refreshing = false, this.error});
  final List<T> items;
  final String? nextCursor;
  final bool loadingMore;
  final bool refreshing;

  /// A failed "load more" or refresh: the list stays, the error is surfaced inline.
  final ApiException? error;
  bool get hasMore => nextCursor != null;
  @override
  List<Object?> get props => [items, nextCursor, loadingMore, refreshing, error];
}

class PagedFailure<T> extends PagedState<T> {
  const PagedFailure(this.error);
  final ApiException error;
  @override
  List<Object?> get props => [error];
}

typedef PageFetcher<T> = Future<PageResult<T>> Function(String? cursor);

class PagedCubit<T> extends Cubit<PagedState<T>> {
  PagedCubit(this._fetch) : super(PagedInitial<T>());
  PageFetcher<T> _fetch;
  int _seq = 0;

  /// Swap the query (filters, search text). Always restarts from the first page; older in-flight responses are ignored.
  Future<void> reload([PageFetcher<T>? fetcher]) async {
    if (fetcher != null) _fetch = fetcher;
    emit(PagedLoading<T>());
    await _first();
  }

  Future<void> load() => state is PagedInitial<T> ? reload() : refresh();

  Future<void> refresh() async {
    final s = state;
    if (s is PagedLoaded<T>) {
      emit(PagedLoaded(s.items, nextCursor: s.nextCursor, refreshing: true));
    } else {
      emit(PagedLoading<T>());
    }
    await _first();
  }

  Future<void> _first() async {
    final mine = ++_seq;
    try {
      final page = await _fetch(null);
      if (mine != _seq || isClosed) return;
      emit(page.items.isEmpty ? PagedEmpty<T>() : PagedLoaded(page.items, nextCursor: page.nextCursor));
    } on ApiException catch (e) {
      if (mine != _seq || isClosed) return;
      final s = state;
      emit(s is PagedLoaded<T> ? PagedLoaded(s.items, nextCursor: s.nextCursor, error: e) : PagedFailure(e));
    }
  }

  /// Scroll-triggered calls stop after a failure (so a broken server isn't hammered); the user's explicit
  /// "Retry" passes [retry] = true.
  Future<void> loadMore({bool retry = false}) async {
    final s = state;
    if (s is! PagedLoaded<T> || !s.hasMore || s.loadingMore || s.refreshing) return;
    if (s.error != null && !retry) return;
    final mine = _seq; // a reload/refresh during this call invalidates it
    emit(PagedLoaded(s.items, nextCursor: s.nextCursor, loadingMore: true));
    try {
      final page = await _fetch(s.nextCursor);
      if (mine != _seq || isClosed) return;
      emit(PagedLoaded([...s.items, ...page.items], nextCursor: page.nextCursor));
    } on ApiException catch (e) {
      if (mine != _seq || isClosed) return;
      emit(PagedLoaded(s.items, nextCursor: s.nextCursor, error: e));
    }
  }

  /// Locally replace/remove an item after a successful mutation.
  void patchItems(List<T> Function(List<T> items) change) {
    final s = state;
    if (s is PagedLoaded<T>) {
      final next = change(s.items);
      emit(next.isEmpty && !s.hasMore ? PagedEmpty<T>() : PagedLoaded(next, nextCursor: s.nextCursor));
    }
  }
}
