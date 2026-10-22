import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../app/deps.dart';
import '../domain/cart_models.dart';
import 'cart_bloc.dart';

const _issueCopy = {
  'PRODUCT_UNAVAILABLE': 'No longer available',
  'VARIANT_UNAVAILABLE': 'This option is no longer available',
  'VENDOR_INACTIVE': 'This seller is not active',
  'INSUFFICIENT_STOCK': 'Not enough stock',
};

class CartPage extends StatelessWidget {
  const CartPage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return BlocProvider(
      create: (_) => CartBloc(deps.cart, deps.badge)..add(const CartStarted()),
      child: Scaffold(
        appBar: AppBar(title: const Text('Your cart')),
        body: BlocConsumer<CartBloc, CartState>(
          listenWhen: (a, b) => b is CartLoaded && b.actionError != null && (a is! CartLoaded || a.actionError != b.actionError),
          listener: (context, state) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text((state as CartLoaded).actionError!.userMessage))),
          builder: (context, state) => switch (state) {
            CartLoading() => const BfListSkeleton(),
            CartFailure(:final error) => BfErrorPanel(error: error, onRetry: () => context.read<CartBloc>().add(const CartStarted())),
            CartLoaded(:final quote) when quote.isEmpty => BfEmptyState(icon: Icons.shopping_cart_outlined, title: 'Your cart is empty', message: 'Add products and they will show up here.', action: BfButton(label: 'Start shopping', onPressed: () => context.go('/'))),
            CartLoaded() => _CartBody(state: state),
          },
        ),
      ),
    );
  }
}

class _CartBody extends StatelessWidget {
  const _CartBody({required this.state});
  final CartLoaded state;

  @override
  Widget build(BuildContext context) {
    final q = state.quote;
    final t = Theme.of(context);
    return Column(children: [
      Expanded(
        child: RefreshIndicator(
          onRefresh: () async => context.read<CartBloc>().add(const CartStarted()),
          child: ListView(padding: pagePadding, physics: const AlwaysScrollableScrollPhysics(), children: [
            if (q.hasIssues) ...[const BfNotice(title: 'Some items need attention', text: 'Fix or remove the highlighted items to continue.', tone: StatusTone.warning), gapMd],
            for (final g in q.groups) ...[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(BfTokens.spaceMd),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [Expanded(child: Text('Sold by ${g.vendorName}', style: t.textTheme.titleMedium)), Text('Shipping ${formatMoney(g.shippingMinor)}', style: t.textTheme.bodySmall)]),
                    const Divider(),
                    for (final l in g.lines) _LineTile(line: l, issue: q.issueFor(l.itemId), busy: state.busyItemId == l.itemId),
                  ]),
                ),
              ),
              gapMd,
            ],
          ]),
        ),
      ),
      SafeArea(
        top: false,
        child: Container(
          padding: pagePadding,
          decoration: BoxDecoration(color: t.colorScheme.surface, border: Border(top: BorderSide(color: t.colorScheme.outline))),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            BfKeyValue('Items (${q.itemCount})', BfMoney(q.subtotalMinor)),
            BfKeyValue('Shipping', BfMoney(q.shippingMinor)),
            BfKeyValue('Total', BfMoney(q.totalMinor), strong: true),
            gapMd,
            BfButton(label: 'Checkout', expand: true, onPressed: q.hasIssues || q.groups.isEmpty ? null : () => context.push('/checkout')),
          ]),
        ),
      ),
    ]);
  }
}

class _LineTile extends StatelessWidget {
  const _LineTile({required this.line, required this.issue, required this.busy});
  final CartLine line;
  final CartIssue? issue;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final bloc = context.read<CartBloc>();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: BfTokens.spaceSm),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 64, height: 64, child: line.imageUrl == null ? const Icon(Icons.image_outlined) : Image.network(line.imageUrl!, fit: BoxFit.cover, errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined))),
        gapMd,
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            InkWell(onTap: () => context.push('/products/${line.productSlug}'), child: Text(line.title, style: t.textTheme.titleMedium)),
            if (line.variantLabel != 'Default') Text(line.variantLabel, style: t.textTheme.bodySmall),
            if (issue != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${_issueCopy[issue!.code] ?? 'Check this item'}${issue!.availableQuantity != null ? ' (${issue!.availableQuantity} left)' : ''}', style: TextStyle(color: t.colorScheme.error, fontWeight: FontWeight.w600))),
            gapXs,
            Row(children: [
              BfQuantityStepper(value: line.quantity, busy: busy, onChanged: (v) => bloc.add(CartQuantityChanged(line.itemId, v))),
              TextButton(onPressed: busy ? null : () => bloc.add(CartItemRemoved(line.itemId)), child: const Text('Remove')),
            ]),
          ]),
        ),
        BfMoney(line.lineTotalMinor, style: t.textTheme.titleMedium),
      ]),
    );
  }
}
