import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:observability/observability.dart';

import '../../../app/deps.dart';
import '../domain/catalog_models.dart';

class ProductTile extends StatelessWidget {
  const ProductTile({super.key, required this.product});
  final ProductSummary product;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Semantics(
      button: true,
      label: '${product.title}, ${formatMoney(product.minPriceMinor, currency: product.currency)}${product.inStock ? '' : ', out of stock'}',
      excludeSemantics: true,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => context.push('/products/${product.slug}'),
          child: Row(children: [
            SizedBox(
              width: 96,
              height: 96,
              child: product.image == null
                  ? ColoredBox(color: t.colorScheme.surfaceContainerHighest, child: const Icon(Icons.image_outlined))
                  : Image.network(product.image!, fit: BoxFit.cover, errorBuilder: (_, _, _) => ColoredBox(color: t.colorScheme.surfaceContainerHighest, child: const Icon(Icons.broken_image_outlined))),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(BfTokens.spaceMd),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(product.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: t.textTheme.titleMedium),
                  gapXs,
                  BfMoney(product.minPriceMinor, currency: product.currency, style: t.textTheme.titleMedium?.copyWith(color: t.colorScheme.primary)),
                  if (product.vendorName != null) Text(product.vendorName!, style: t.textTheme.bodySmall),
                  if (!product.inStock) const Padding(padding: EdgeInsets.only(top: 4), child: BfStatusBadge('cancelled')),
                ]),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return MultiBlocProvider(
      providers: [
        BlocProvider(create: (_) => ResourceCubit<List<CategoryNode>>(deps.catalog.categories)..load()),
        BlocProvider(create: (_) => PagedCubit<ProductSummary>((c) => deps.catalog.products(const ProductQuery(), cursor: c))..load()),
      ],
      child: Scaffold(
        appBar: AppBar(title: const Text('BazarFlow'), actions: [IconButton(tooltip: 'Notifications', icon: const Icon(Icons.notifications_none), onPressed: () => context.push('/notifications'))]),
        body: BfPagedView<ProductSummary>(
          itemBuilder: (_, p) => ProductTile(product: p),
          emptyTitle: 'No products yet',
          emptyMessage: 'Sellers are setting up their stores. Check back soon.',
          header: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Semantics(
              button: true,
              label: 'Search products',
              excludeSemantics: true,
              child: InkWell(
                borderRadius: BorderRadius.circular(BfTokens.radiusMd),
                onTap: () => context.go('/search'),
                child: InputDecorator(decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search products'), child: Text('Search products', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant))),
              ),
            ),
            gapLg,
            BlocBuilder<ResourceCubit<List<CategoryNode>>, ResourceState<List<CategoryNode>>>(
              builder: (context, s) => s is ResourceLoaded<List<CategoryNode>> && s.data.isNotEmpty
                  ? SizedBox(
                      height: 44,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: s.data.length,
                        separatorBuilder: (_, _) => gapSm,
                        itemBuilder: (_, i) => ActionChip(label: Text(s.data[i].name), onPressed: () => context.go('/search?category=${s.data[i].slug}')),
                      ),
                    )
                  : const SizedBox.shrink(),
            ),
            gapLg,
            Text('New arrivals', style: Theme.of(context).textTheme.titleLarge),
          ]),
        ),
      ),
    );
  }
}

class SearchPage extends StatefulWidget {
  const SearchPage({super.key, this.initialQuery, this.category});
  final String? initialQuery;
  final String? category;
  @override
  State<SearchPage> createState() => _SearchPageState();
}

class _SearchPageState extends State<SearchPage> {
  late final TextEditingController _text = TextEditingController(text: widget.initialQuery);
  late final PagedCubit<ProductSummary> _cubit;
  Timer? _debounce;
  String _sort = 'newest';
  late ProductQuery _query = ProductQuery(text: widget.initialQuery, category: widget.category);

  @override
  void initState() {
    super.initState();
    final deps = context.read<AppDependencies>();
    _cubit = PagedCubit<ProductSummary>((c) => deps.catalog.products(_query, cursor: c))..load();
  }

  @override
  void didUpdateWidget(SearchPage old) {
    super.didUpdateWidget(old);
    if (old.category != widget.category) _apply(_query.copyWith(category: widget.category));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _text.dispose();
    _cubit.close();
    super.dispose();
  }

  void _apply(ProductQuery q) {
    setState(() => _query = q);
    final deps = context.read<AppDependencies>();
    // New fetcher closes over the new query; the cubit discards any in-flight response for the old one.
    _cubit.reload((c) => deps.catalog.products(q, cursor: c));
    unawaited(deps.obs.analytics.log(AnalyticsEvents.searchPerformed, {'has_query': (q.text ?? '').isNotEmpty, 'sort': q.sort}));
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(
          title: TextField(
            controller: _text,
            textInputAction: TextInputAction.search,
            decoration: const InputDecoration(hintText: 'Search products', border: InputBorder.none, filled: false),
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 400), () => _apply(ProductQuery(text: v.trim().isEmpty ? null : v.trim(), category: _query.category, sort: _sort)));
            },
          ),
          actions: [
            PopupMenuButton<String>(
              tooltip: 'Sort',
              icon: const Icon(Icons.sort),
              initialValue: _sort,
              onSelected: (v) {
                setState(() => _sort = v);
                _apply(ProductQuery(text: _query.text, category: _query.category, sort: v));
              },
              itemBuilder: (_) => const [PopupMenuItem(value: 'newest', child: Text('Newest')), PopupMenuItem(value: 'price_asc', child: Text('Price: low to high')), PopupMenuItem(value: 'price_desc', child: Text('Price: high to low'))],
            ),
          ],
        ),
        body: BfPagedView<ProductSummary>(
          itemBuilder: (_, p) => ProductTile(product: p),
          emptyTitle: _query.text != null ? 'No results for “${_query.text}”' : 'No products found',
          emptyMessage: 'Try a different search or remove filters.',
          emptyIcon: Icons.search_off,
        ),
      ),
    );
  }
}

class ProductPage extends StatelessWidget {
  const ProductPage({super.key, required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return MultiBlocProvider(
      providers: [
        BlocProvider(create: (_) => ResourceCubit<ProductDetail>(() => deps.catalog.product(slug))..load()),
        BlocProvider(create: (_) => ResourceCubit<ReviewSummary>(() => deps.catalog.reviews(slug))..load()),
      ],
      child: Scaffold(
        appBar: AppBar(),
        body: BfResourceView<ProductDetail>(
          builder: (context, p) {
            unawaited(deps.obs.analytics.log(AnalyticsEvents.productViewed, {'screen': 'product'}));
            return _ProductBody(product: p);
          },
        ),
      ),
    );
  }
}

class _ProductBody extends StatefulWidget {
  const _ProductBody({required this.product});
  final ProductDetail product;
  @override
  State<_ProductBody> createState() => _ProductBodyState();
}

class _ProductBodyState extends State<_ProductBody> {
  late Map<String, String> _chosen = {for (final o in widget.product.options) o.name: ''};
  int _qty = 1;
  bool _adding = false;
  int _image = 0;

  Future<void> _add(ProductVariant variant) async {
    final deps = context.read<AppDependencies>();
    if (deps.session.state is! SignedIn) {
      context.push('/login?next=${Uri.encodeComponent('/products/${widget.product.slug}')}');
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _adding = true);
    try {
      final quote = await deps.cart.add(productId: widget.product.id, variantId: variant.variantId, quantity: _qty);
      deps.badge.set(quote.itemCount);
      unawaited(deps.obs.analytics.log(AnalyticsEvents.cartItemAdded, {'count': _qty}));
      messenger.showSnackBar(SnackBar(content: const Text('Added to cart'), action: SnackBarAction(label: 'View cart', onPressed: () => context.go('/cart'))));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.userMessage)));
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.product;
    final t = Theme.of(context);
    final variant = p.options.isEmpty ? (p.variants.isNotEmpty ? p.variants.first : null) : p.variantFor(_chosen);
    final price = variant?.priceMinor ?? p.minPriceMinor;
    final maxQty = (variant?.lowStock ?? 20).clamp(1, 20);
    final canBuy = variant != null && variant.inStock;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (p.images.isNotEmpty) ...[
        AspectRatio(
          aspectRatio: 1,
          child: Semantics(
            image: true,
            label: '${p.title}, image ${_image + 1} of ${p.images.length}',
            child: Image.network(p.images[_image], fit: BoxFit.contain, errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined, size: 64)),
          ),
        ),
        if (p.images.length > 1)
          SizedBox(
            height: 64,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: p.images.length,
              separatorBuilder: (_, _) => gapSm,
              itemBuilder: (_, i) => Semantics(button: true, selected: i == _image, label: 'Show image ${i + 1}', child: InkWell(onTap: () => setState(() => _image = i), child: Container(width: 64, decoration: BoxDecoration(border: Border.all(color: i == _image ? t.colorScheme.primary : Colors.transparent, width: 2)), child: Image.network(p.images[i], fit: BoxFit.cover)))),
            ),
          ),
        gapLg,
      ],
      Text(p.title, style: t.textTheme.headlineMedium),
      gapSm,
      Row(children: [
        BlocBuilder<ResourceCubit<ReviewSummary>, ResourceState<ReviewSummary>>(
          builder: (_, s) => s is ResourceLoaded<ReviewSummary> ? Row(children: [BfStars(s.data.average), gapSm, Text('(${s.data.count})', style: t.textTheme.bodySmall)]) : const SizedBox.shrink(),
        ),
        const Spacer(),
        if (p.vendorName != null) Flexible(child: Text('Sold by ${p.vendorName}', style: t.textTheme.bodySmall, overflow: TextOverflow.ellipsis)),
      ]),
      gapMd,
      Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        if (variant == null && p.variants.length > 1) Text('From ', style: t.textTheme.bodyMedium),
        BfMoney(price, currency: p.currency, style: t.textTheme.headlineMedium?.copyWith(color: t.colorScheme.primary)),
        if (variant?.compareAtMinor != null) ...[gapSm, BfMoney(variant!.compareAtMinor!, currency: p.currency, strike: true)],
      ]),
      gapLg,
      for (final option in p.options) ...[
        Text('${option.name}${(_chosen[option.name] ?? '').isNotEmpty ? ': ${_chosen[option.name]}' : ''}', style: t.textTheme.titleMedium),
        gapSm,
        Wrap(spacing: BfTokens.spaceSm, children: [
          for (final value in option.values)
            ChoiceChip(
              label: Text(value),
              selected: _chosen[option.name] == value,
              onSelected: p.valueAvailable(option.name, value, _chosen) ? (sel) => setState(() {
                    _chosen = {..._chosen, option.name: sel ? value : ''};
                    _qty = 1;
                  }) : null,
            ),
        ]),
        gapMd,
      ],
      if (variant != null && !variant.inStock) const BfNotice(text: 'This option is out of stock.', tone: StatusTone.warning),
      if (variant?.lowStock != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text('Only ${variant!.lowStock} left', style: TextStyle(color: t.extension<BfStatusColors>()!.colors.warning))),
      Row(children: [
        BfQuantityStepper(value: _qty, max: maxQty, onChanged: (v) => setState(() => _qty = v)),
        gapLg,
        Expanded(
          child: BfButton(
            label: p.options.isNotEmpty && variant == null ? 'Select options' : canBuy ? 'Add to cart' : 'Unavailable',
            loading: _adding,
            onPressed: canBuy ? () => _add(variant) : null,
            expand: true,
          ),
        ),
      ]),
      gapXl,
      Text('Description', style: t.textTheme.titleLarge),
      gapSm,
      Text(p.description),
      gapXl,
      Text('Customer reviews', style: t.textTheme.titleLarge),
      gapSm,
      BlocBuilder<ResourceCubit<ReviewSummary>, ResourceState<ReviewSummary>>(
        builder: (_, s) => switch (s) {
          ResourceLoaded<ReviewSummary>(:final data) when data.reviews.isEmpty => const Text('No reviews yet. Only customers who received this product can review it.'),
          ResourceLoaded<ReviewSummary>(:final data) => Column(children: [
              for (final r in data.reviews)
                Card(child: Padding(padding: const EdgeInsets.all(BfTokens.spaceMd), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Row(children: [BfStars(r.rating.toDouble()), gapSm, if (r.title != null) Flexible(child: Text(r.title!, style: t.textTheme.titleMedium))]), gapXs, Text(r.body), gapXs, Text('${r.author} · Verified purchase', style: t.textTheme.bodySmall)]))),
            ]),
          ResourceFailure<ReviewSummary>() => const Text('Reviews are unavailable right now.'),
          _ => const BfSkeleton(height: 60),
        },
      ),
      gapXl,
    ]);
  }
}
