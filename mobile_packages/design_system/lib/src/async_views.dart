import 'package:app_core/app_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'theme.dart';
import 'tokens.g.dart';
import 'widgets.dart';

/// Renders a [ResourceCubit] with the full state contract: skeleton, loaded, refreshing (no flicker), stale-with-error, failure.
class BfResourceView<T> extends StatelessWidget {
  const BfResourceView({super.key, required this.builder, this.skeleton, this.scrollable = true, this.onRefresh});
  final Widget Function(BuildContext context, T data) builder;
  final Widget? skeleton;

  /// Wrap the content in a pull-to-refresh scroll view.
  final bool scrollable;
  final Future<void> Function()? onRefresh;

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<ResourceCubit<T>>();
    return BlocBuilder<ResourceCubit<T>, ResourceState<T>>(
      builder: (context, state) => switch (state) {
        ResourceInitial<T>() || ResourceLoading<T>() => skeleton ?? const BfListSkeleton(),
        ResourceFailure<T>(:final error) => BfErrorPanel(error: error, onRetry: cubit.load),
        ResourceLoaded<T>(:final data, :final refreshing, :final refreshError) => Column(children: [
            if (refreshing) const LinearProgressIndicator(minHeight: 2),
            if (refreshError != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(BfTokens.spaceLg, BfTokens.spaceSm, BfTokens.spaceLg, 0),
                child: BfNotice(text: refreshError.isNetwork ? "You're offline. Showing the last loaded data." : refreshError.userMessage, tone: StatusTone.warning, action: TextButton(onPressed: cubit.refresh, child: const Text('Retry'))),
              ),
            Expanded(
              child: scrollable
                  ? RefreshIndicator(onRefresh: onRefresh ?? cubit.refresh, child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: pagePadding, children: [builder(context, data)]))
                  : builder(context, data),
            ),
          ]),
      },
    );
  }
}

/// Renders a [PagedCubit] as an infinite-scroll list with pull-to-refresh and inline load-more errors.
class BfPagedView<T> extends StatefulWidget {
  const BfPagedView({super.key, required this.itemBuilder, this.emptyTitle = 'Nothing here yet', this.emptyMessage, this.emptyIcon = Icons.inbox_outlined, this.emptyAction, this.header, this.separator = true});
  final Widget Function(BuildContext context, T item) itemBuilder;
  final String emptyTitle;
  final String? emptyMessage;
  final IconData emptyIcon;
  final Widget? emptyAction;
  final Widget? header;
  final bool separator;

  @override
  State<BfPagedView<T>> createState() => _BfPagedViewState<T>();
}

class _BfPagedViewState<T> extends State<BfPagedView<T>> {
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.hasClients && _scroll.position.pixels > _scroll.position.maxScrollExtent - 320) context.read<PagedCubit<T>>().loadMore();
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<PagedCubit<T>>();
    return BlocBuilder<PagedCubit<T>, PagedState<T>>(
      builder: (context, state) => switch (state) {
        PagedInitial<T>() || PagedLoading<T>() => const BfListSkeleton(),
        PagedFailure<T>(:final error) => BfErrorPanel(error: error, onRetry: cubit.reload),
        PagedEmpty<T>() => RefreshIndicator(
            onRefresh: cubit.refresh,
            child: ListView(physics: const AlwaysScrollableScrollPhysics(), children: [
              if (widget.header != null) widget.header!,
              SizedBox(height: 360, child: BfEmptyState(title: widget.emptyTitle, message: widget.emptyMessage, icon: widget.emptyIcon, action: widget.emptyAction)),
            ]),
          ),
        PagedLoaded<T>() => Column(children: [
            if (state.refreshing) const LinearProgressIndicator(minHeight: 2),
            Expanded(
              child: RefreshIndicator(
                onRefresh: cubit.refresh,
                child: ListView.separated(
                  controller: _scroll,
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: pagePadding,
                  itemCount: state.items.length + 1 + (widget.header == null ? 0 : 1),
                  separatorBuilder: (_, _) => widget.separator ? gapMd : const SizedBox.shrink(),
                  itemBuilder: (context, i) {
                    if (widget.header != null) {
                      if (i == 0) return widget.header!;
                      i -= 1;
                    }
                    if (i < state.items.length) return widget.itemBuilder(context, state.items[i]);
                    // footer: spinner, inline error, or end of list
                    if (state.loadingMore) return const Padding(padding: EdgeInsets.all(BfTokens.spaceLg), child: Center(child: CircularProgressIndicator()));
                    if (state.error != null) return BfNotice(text: state.error!.userMessage, tone: StatusTone.warning, action: TextButton(onPressed: () => cubit.loadMore(retry: true), child: const Text('Retry')));
                    return const SizedBox(height: BfTokens.spaceXl);
                  },
                ),
              ),
            ),
          ]),
      },
    );
  }
}
