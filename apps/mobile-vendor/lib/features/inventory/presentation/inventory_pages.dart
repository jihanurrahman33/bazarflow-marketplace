import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../app/deps.dart';
import '../data/catalog_ops_repository.dart';

class ProductsPage extends StatelessWidget {
  const ProductsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return BlocProvider(
      create: (_) =>
          PagedCubit<VendorProduct>((c) => deps.catalog.products(cursor: c))
            ..load(),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Products'),
          actions: [
            IconButton(
              tooltip: 'Inventory',
              icon: const Icon(Icons.warehouse_outlined),
              onPressed: () => context.push('/inventory'),
            ),
          ],
        ),
        body: BfPagedView<VendorProduct>(
          emptyTitle: 'No products yet',
          emptyMessage: 'Create products from the seller console on the web, then manage price and stock here.',
          emptyIcon: Icons.inventory_2_outlined,
          itemBuilder: (context, p) => Card(
            child: ListTile(
              onTap: () => context.push('/products/${p.id}'),
              title: Text(
                p.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              subtitle: Text(
                '${p.variants.length} variant(s) · from ${formatMoney(p.minPriceMinor)}',
              ),
              trailing: BfStatusBadge(p.status),
            ),
          ),
        ),
      ),
    );
  }
}

class ProductDetailPage extends StatelessWidget {
  const ProductDetailPage({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return BlocProvider(
      create: (_) =>
          ResourceCubit<VendorProduct>(() => deps.catalog.product(id))..load(),
      child: Builder(
        builder: (context) => Scaffold(
          appBar: AppBar(title: const Text('Product')),
          body: BfResourceView<VendorProduct>(
            builder: (context, p) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        p.title,
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                    ),
                    BfStatusBadge(p.status),
                  ],
                ),
                if (p.status == 'rejected' && p.moderationReason != null) ...[
                  gapMd,
                  BfNotice(
                    title: 'Rejected by moderation',
                    text: p.moderationReason!,
                    tone: StatusTone.danger,
                  ),
                ],
                if (p.status == 'published') ...[
                  gapMd,
                  const BfNotice(
                    text: 'Price changes apply immediately. Title, photos and description are edited on the web console and go through review.',
                  ),
                ],
                gapLg,
                for (final v in p.variants)
                  _VariantCard(product: p, variant: v),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _VariantCard extends StatelessWidget {
  const _VariantCard({required this.product, required this.variant});
  final VendorProduct product;
  final ProductVariantRow variant;

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    final cubit = context.read<ResourceCubit<VendorProduct>>();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(BfTokens.spaceMd),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    variant.label,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Text(variant.sku, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
            gapSm,
            Row(
              children: [
                BfMoney(
                  variant.priceMinor,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const Spacer(),
                TextButton(
                  onPressed: () async {
                    final input = await showReasonDialog(
                      context,
                      title: 'New price (৳)',
                      fieldLabel: 'Price',
                      minLength: 1,
                      confirmLabel: 'Update price',
                      requireText: true,
                    );
                    final minor = input == null ? null : parseMoneyInput(input);
                    if (input != null && minor == null && context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Enter an amount like 1200 or 1200.50'),
                        ),
                      );
                      return;
                    }
                    if (minor == null) return;
                    try {
                      cubit.set(
                        await deps.catalog.updateVariant(
                          product.id,
                          variant.variantId,
                          priceMinor: minor,
                        ),
                      );
                    } on ApiException catch (e) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(
                          context,
                        ).showSnackBar(SnackBar(content: Text(e.userMessage)));
                      }
                    }
                  },
                  child: const Text('Change price'),
                ),
              ],
            ),
            Row(
              children: [
                Text(
                  'On hand ${variant.onHand ?? '—'} · Reserved ${variant.reserved ?? '—'}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const Spacer(),
                Semantics(
                  label: 'Variant ${variant.sku} active',
                  toggled: variant.active,
                  child: Switch(
                    value: variant.active,
                    onChanged: (v) async {
                      try {
                        cubit.set(
                          await deps.catalog.updateVariant(
                            product.id,
                            variant.variantId,
                            active: v,
                          ),
                        );
                      } on ApiException catch (e) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(e.userMessage)),
                          );
                        }
                      }
                    },
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class InventoryPage extends StatefulWidget {
  const InventoryPage({super.key});
  @override
  State<InventoryPage> createState() => _InventoryPageState();
}

class _InventoryPageState extends State<InventoryPage> {
  late final PagedCubit<StockItem> _cubit;
  bool _lowOnly = true;

  @override
  void initState() {
    super.initState();
    final deps = context.read<AppDependencies>();
    _cubit = PagedCubit<StockItem>(
      (c) => deps.catalog.inventory(lowStock: _lowOnly ? 3 : null, cursor: c),
    )..load();
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(title: const Text('Inventory')),
        body: Column(
          children: [
            SwitchListTile(
              title: const Text('Low stock only'),
              value: _lowOnly,
              onChanged: (v) {
                setState(() => _lowOnly = v);
                _cubit.reload(
                  (c) =>
                      deps.catalog.inventory(lowStock: v ? 3 : null, cursor: c),
                );
              },
            ),
            Expanded(
              child: BfPagedView<StockItem>(
                emptyTitle: _lowOnly
                    ? 'Nothing is running low'
                    : 'No stock records yet',
                emptyIcon: Icons.check_circle_outline,
                itemBuilder: (context, i) => Card(
                  child: ListTile(
                    title: Text(
                      i.productTitle.isEmpty ? i.sku : i.productTitle,
                    ),
                    subtitle: Text(
                      '${i.sku} · on hand ${i.onHand} · reserved ${i.reserved}',
                    ),
                    trailing: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          '${i.available}',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: i.available <= 0
                                ? Theme.of(context).colorScheme.error
                                : null,
                          ),
                        ),
                        const Text('available', style: TextStyle(fontSize: 11)),
                      ],
                    ),
                    onTap: () async {
                      final input = await showReasonDialog(
                        context,
                        title: 'Set quantity on hand',
                        body: '${i.reserved} reserved by customers right now.',
                        fieldLabel: 'New quantity',
                        minLength: 1,
                        confirmLabel: 'Save',
                      );
                      final qty = input == null ? null : int.tryParse(input);
                      if (qty == null) return;
                      try {
                        await deps.catalog.adjustStock(
                          i.id,
                          set: qty,
                          reason: 'Count from mobile app',
                        );
                        _cubit.refresh();
                      } on ApiException catch (e) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                e.code == 'CONFLICT'
                                    ? "Stock can't go below what customers have reserved."
                                    : e.userMessage,
                              ),
                            ),
                          );
                        }
                      }
                    },
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
