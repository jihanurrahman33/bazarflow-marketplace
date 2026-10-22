import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../app/deps.dart';
import '../../queues/data/admin_repository.dart';

String _date(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class OrderSearchPage extends StatefulWidget {
  const OrderSearchPage({super.key});
  @override
  State<OrderSearchPage> createState() => _OrderSearchPageState();
}

class _OrderSearchPageState extends State<OrderSearchPage> {
  final _text = TextEditingController();
  late final PagedCubit<OrderRow> _cubit;

  @override
  void initState() {
    super.initState();
    final deps = context.read<AppDependencies>();
    _cubit = PagedCubit<OrderRow>((c) => deps.admin.orders(cursor: c))..load();
  }

  @override
  void dispose() {
    _text.dispose();
    _cubit.close();
    super.dispose();
  }

  void _search() {
    final deps = context.read<AppDependencies>();
    final q = _text.text.trim().toUpperCase();
    _cubit.reload((c) => deps.admin.orders(orderNumber: q.isEmpty ? null : q, cursor: c));
  }

  @override
  Widget build(BuildContext context) {
    final canRead = context.read<AppDependencies>().session.user?.can('order.read_all') ?? false;
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(title: const Text('Orders')),
        body: !canRead
            ? const BfEmptyState(icon: Icons.lock_outline, title: 'No order access', message: 'Your role cannot look up orders.')
            : Column(children: [
                Padding(
                  padding: pagePadding,
                  child: TextField(
                    controller: _text,
                    textCapitalization: TextCapitalization.characters,
                    textInputAction: TextInputAction.search,
                    onSubmitted: (_) => _search(),
                    decoration: InputDecoration(labelText: 'Order number', hintText: 'BF-XXXXXXXX', suffixIcon: IconButton(tooltip: 'Search', icon: const Icon(Icons.search), onPressed: _search)),
                  ),
                ),
                Expanded(
                  child: BfPagedView<OrderRow>(
                    emptyTitle: 'No orders match',
                    emptyIcon: Icons.search_off,
                    itemBuilder: (context, o) => Card(
                      child: ListTile(
                        onTap: () => context.push('/orders/${o.id}'),
                        title: Text(o.orderNumber),
                        subtitle: Text('${_date(o.createdAt)} · ${o.paymentMethod}'),
                        trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [BfMoney(o.totalMinor), BfStatusBadge(o.status)]),
                      ),
                    ),
                  ),
                ),
              ]),
      ),
    );
  }
}

class OrderSupportPage extends StatelessWidget {
  const OrderSupportPage({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return BlocProvider(
      create: (_) => ResourceCubit<OrderSupportView>(() => deps.admin.order(id))..load(),
      child: Scaffold(
        appBar: AppBar(title: const Text('Order')),
        body: BfResourceView<OrderSupportView>(
          builder: (context, o) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [Expanded(child: Text(o.row.orderNumber, style: Theme.of(context).textTheme.headlineMedium)), BfStatusBadge(o.row.status)]),
            Text('${o.buyerName ?? ''} · ${o.buyerEmail ?? ''}', style: Theme.of(context).textTheme.bodySmall),
            gapSm,
            Row(children: [BfStatusBadge(o.row.paymentStatus), gapSm, Text(o.row.paymentMethod), const Spacer(), BfMoney(o.row.totalMinor, style: Theme.of(context).textTheme.titleLarge)]),
            gapLg,
            Text('Seller orders', style: Theme.of(context).textTheme.titleLarge),
            for (final v in o.sellerOrders)
              Card(child: Padding(padding: const EdgeInsets.all(BfTokens.spaceMd), child: Column(children: [
                Row(children: [Expanded(child: Text(v.vendor, style: Theme.of(context).textTheme.titleMedium)), BfStatusBadge(v.status)]),
                BfKeyValue('Total', BfMoney(v.totalMinor)),
                BfKeyValue('Commission', BfMoney(v.commissionMinor)),
                BfKeyValue('Seller net', BfMoney(v.netMinor)),
              ]))),
            gapLg,
            Text('Payments', style: Theme.of(context).textTheme.titleLarge),
            if (o.payments.isEmpty) const Text('No payment attempts.'),
            for (final p in o.payments) Card(child: ListTile(title: Text(p.reference), subtitle: Text(p.refundedMinor > 0 ? 'Refunded ${formatMoney(p.refundedMinor)}' : ''), trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [BfMoney(p.amountMinor), BfStatusBadge(p.status)]))),
            if (o.refunds.isNotEmpty) ...[
              gapLg,
              Text('Refunds', style: Theme.of(context).textTheme.titleLarge),
              for (final r in o.refunds) Card(child: ListTile(title: Text(r.reason), trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [BfMoney(r.amountMinor), BfStatusBadge(r.status)]))),
            ],
            gapXl,
          ]),
        ),
      ),
    );
  }
}
