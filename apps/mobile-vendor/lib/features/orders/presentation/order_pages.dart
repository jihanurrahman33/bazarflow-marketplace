import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../app/deps.dart';
import '../../money/data/money_repository.dart';
import '../domain/orders_models.dart';
import 'order_detail_cubit.dart';

String _date(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  ApiException? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false) || _busy) return;
    final deps = context.read<AppDependencies>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await deps.session.login(_email.text.trim(), _password.text);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Seller sign in')),
    body: SafeArea(
      child: ListView(
        padding: pagePadding,
        children: [
          Form(
            key: _form,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Manage your store',
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 4),
                const Text(
                  'Use the account you were approved with. New sellers apply from the BazarFlow shopping app or website.',
                ),
                gapLg,
                if (_error != null) ...[BfInlineError(_error!), gapMd],
                TextFormField(
                  controller: _email,
                  enabled: !_busy,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(labelText: 'Email'),
                  validator: (v) =>
                      (v == null ||
                          !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
                              .hasMatch(v.trim()))
                      ? 'Enter a valid email address'
                      : null,
                ),
                gapMd,
                TextFormField(
                  controller: _password,
                  enabled: !_busy,
                  obscureText: true,
                  onFieldSubmitted: (_) => _submit(),
                  decoration: const InputDecoration(labelText: 'Password'),
                  validator: (v) =>
                      (v == null || v.isEmpty) ? 'Required' : null,
                ),
                gapLg,
                BfButton(
                  label: 'Sign in',
                  loading: _busy,
                  onPressed: _submit,
                  expand: true,
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

class OverviewPage extends StatelessWidget {
  const OverviewPage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return MultiBlocProvider(
      providers: [
        BlocProvider(
          create: (_) => ResourceCubit<Balance>(deps.money.balance)..load(),
        ),
        BlocProvider(
          create: (_) => PagedCubit<VendorOrder>(
            (c) => deps.orders.list(status: 'new', cursor: c),
          )..load(),
        ),
      ],
      child: Builder(
        builder: (context) => Scaffold(
          appBar: AppBar(
            title: const Text('Overview'),
            actions: [
              IconButton(
                tooltip: 'Notifications',
                icon: const Icon(Icons.notifications_none),
                onPressed: () => context.push('/notifications'),
              ),
            ],
          ),
          body: RefreshIndicator(
            onRefresh: () async {
              await context.read<ResourceCubit<Balance>>().refresh();
              if (context.mounted) {
                await context.read<PagedCubit<VendorOrder>>().refresh();
              }
            },
            child: ListView(
              padding: pagePadding,
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                const _BalanceCards(),
                gapLg,
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Orders waiting for you',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ),
                    TextButton(
                      onPressed: () => context.go('/orders?status=new'),
                      child: const Text('See all'),
                    ),
                  ],
                ),
                BlocBuilder<PagedCubit<VendorOrder>, PagedState<VendorOrder>>(
                  builder: (context, s) => switch (s) {
                    PagedLoaded<VendorOrder>(:final items) => Column(
                      children: [
                        for (final o in items.take(5)) OrderTile(order: o),
                      ],
                    ),
                    PagedEmpty<VendorOrder>() => const Padding(
                      padding: EdgeInsets.all(BfTokens.spaceLg),
                      child: Text("You're all caught up."),
                    ),
                    PagedFailure<VendorOrder>(:final error) => BfErrorPanel(
                      error: error,
                      onRetry: context.read<PagedCubit<VendorOrder>>().reload,
                    ),
                    _ => const BfSkeleton(height: 72),
                  },
                ),
                gapLg,
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.warning_amber),
                    title: const Text('Low stock'),
                    subtitle: const Text('Check items that are running out'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push('/inventory'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _BalanceCards extends StatelessWidget {
  const _BalanceCards();
  @override
  Widget build(BuildContext context) =>
      BlocBuilder<ResourceCubit<Balance>, ResourceState<Balance>>(
        builder: (context, s) => switch (s) {
          ResourceLoaded<Balance>(:final data) => Row(
            children: [
              Expanded(
                child: _Stat('Available', formatMoney(data.availableMinor)),
              ),
              gapMd,
              Expanded(child: _Stat('Pending', formatMoney(data.pendingMinor))),
            ],
          ),
          ResourceFailure<Balance>(:final error) => BfErrorPanel(
            error: error,
            onRetry: context.read<ResourceCubit<Balance>>().load,
          ),
          _ => const BfSkeleton(height: 80),
        },
      );
}

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value);
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(BfTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          gapXs,
          Text(value, style: Theme.of(context).textTheme.titleLarge),
        ],
      ),
    ),
  );
}

class OrderTile extends StatelessWidget {
  const OrderTile({super.key, required this.order});
  final VendorOrder order;
  @override
  Widget build(BuildContext context) => Card(
    child: ListTile(
      onTap: () => context.push('/orders/${order.id}'),
      title: Text(order.orderNumber),
      subtitle: Text(
        '${order.itemCount} item(s) · ${_date(order.createdAt)}${order.paymentMethod == 'cod' ? ' · COD ${formatMoney(order.collectOnDeliveryMinor)}' : ''}',
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          BfMoney(order.totalMinor),
          const SizedBox(height: 4),
          BfStatusBadge(order.status),
        ],
      ),
    ),
  );
}

class OrdersPage extends StatefulWidget {
  const OrdersPage({super.key, this.initialStatus});
  final String? initialStatus;
  @override
  State<OrdersPage> createState() => _OrdersPageState();
}

class _OrdersPageState extends State<OrdersPage> {
  late String? _status = widget.initialStatus;
  late final PagedCubit<VendorOrder> _cubit;

  @override
  void initState() {
    super.initState();
    final deps = context.read<AppDependencies>();
    _cubit = PagedCubit<VendorOrder>(
      (c) => deps.orders.list(status: _status, cursor: c),
    )..load();
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  void _select(String? status) {
    final deps = context.read<AppDependencies>();
    setState(() => _status = status);
    _cubit.reload((c) => deps.orders.list(status: status, cursor: c));
  }

  @override
  Widget build(BuildContext context) {
    const filters = [
      (null, 'Active'),
      ('new', 'New'),
      ('accepted', 'Accepted'),
      ('shipped', 'Shipped'),
      ('delivered', 'Delivered'),
      ('return_requested', 'Returns'),
      ('cancelled', 'Cancelled'),
    ];
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(title: const Text('Orders')),
        body: Column(
          children: [
            SizedBox(
              height: 56,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(
                  horizontal: BfTokens.spaceLg,
                  vertical: BfTokens.spaceSm,
                ),
                children: [
                  for (final f in filters)
                    Padding(
                      padding: const EdgeInsets.only(right: BfTokens.spaceSm),
                      child: ChoiceChip(
                        label: Text(f.$2),
                        selected: _status == f.$1,
                        onSelected: (_) => _select(f.$1),
                      ),
                    ),
                ],
              ),
            ),
            Expanded(
              child: BfPagedView<VendorOrder>(
                itemBuilder: (_, o) => OrderTile(order: o),
                emptyTitle: 'No orders here yet',
                emptyIcon: Icons.inbox_outlined,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class OrderDetailPage extends StatelessWidget {
  const OrderDetailPage({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return BlocProvider(
      create: (_) => OrderDetailCubit(deps.orders, id)..load(),
      child: Scaffold(
        appBar: AppBar(title: const Text('Order')),
        body: BlocConsumer<OrderDetailCubit, OrderDetailState>(
          listenWhen: (a, b) =>
              b is OrderDetailLoaded &&
              (b.notice != null || b.actionError != null) &&
              (a is! OrderDetailLoaded ||
                  a.notice != b.notice ||
                  a.actionError != b.actionError),
          listener: (context, s) {
            final l = s as OrderDetailLoaded;
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(l.actionError?.userMessage ?? l.notice!)),
            );
          },
          builder: (context, s) => switch (s) {
            OrderDetailLoading() => const BfListSkeleton(),
            OrderDetailFailure(:final error) => BfErrorPanel(
              error: error,
              onRetry: context.read<OrderDetailCubit>().load,
            ),
            OrderDetailLoaded() => RefreshIndicator(
              onRefresh: context.read<OrderDetailCubit>().load,
              child: _OrderBody(state: s),
            ),
          },
        ),
      ),
    );
  }
}

class _OrderBody extends StatelessWidget {
  const _OrderBody({required this.state});
  final OrderDetailLoaded state;

  @override
  Widget build(BuildContext context) {
    final o = state.order;
    final cubit = context.read<OrderDetailCubit>();
    final t = Theme.of(context);
    final busy = state.acting;
    return ListView(
      padding: pagePadding,
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(o.orderNumber, style: t.textTheme.headlineMedium),
            ),
            BfStatusBadge(o.status),
          ],
        ),
        Text('Placed ${_date(o.createdAt)}', style: t.textTheme.bodySmall),
        gapMd,
        if (o.paymentMethod == 'cod') ...[
          BfNotice(
            title: 'Cash on delivery',
            text:
                'Collect ${formatMoney(o.collectOnDeliveryMinor)} from the customer on delivery.',
            tone: StatusTone.warning,
          ),
          gapMd,
        ],
        Wrap(
          spacing: BfTokens.spaceSm,
          runSpacing: BfTokens.spaceSm,
          children: [
            if (o.canAccept)
              BfButton(
                label: 'Accept order',
                loading: busy,
                onPressed: cubit.accept,
              ),
            if (o.canShip)
              BfButton(
                label: 'Mark as shipped',
                loading: busy,
                onPressed: () => _ship(context, cubit),
              ),
            if (o.canDeliver)
              BfButton(
                label: 'Mark as delivered',
                loading: busy,
                onPressed: cubit.deliver,
              ),
            if (o.canCancel)
              BfButton(
                label: o.status == 'new' ? 'Reject' : 'Cancel order',
                variant: BfButtonVariant.danger,
                loading: busy,
                onPressed: () => _cancel(context, cubit),
              ),
            if (o.returnPending) ...[
              BfButton(
                label: 'Accept return',
                loading: busy,
                onPressed: cubit.approveReturn,
              ),
              BfButton(
                label: 'Decline return',
                variant: BfButtonVariant.secondary,
                loading: busy,
                onPressed: () => _decline(context, cubit),
              ),
            ],
          ],
        ),
        gapLg,
        Card(
          child: Padding(
            padding: const EdgeInsets.all(BfTokens.spaceMd),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Items', style: t.textTheme.titleMedium),
                for (final i in o.items)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(i.title),
                              Text(
                                '${i.sku} · ${i.quantity} × ${formatMoney(i.unitPriceMinor)}${i.variantLabel == 'Default' ? '' : ' · ${i.variantLabel}'}',
                                style: t.textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ),
                        BfMoney(i.lineTotalMinor),
                      ],
                    ),
                  ),
                const Divider(),
                BfKeyValue('Subtotal', BfMoney(o.subtotalMinor)),
                BfKeyValue('Shipping', BfMoney(o.shippingMinor)),
                BfKeyValue(
                  'Commission (${o.commissionBps / 100}%)',
                  Text('−${formatMoney(o.commissionMinor)}'),
                ),
                BfKeyValue('Your earnings', BfMoney(o.netMinor), strong: true),
              ],
            ),
          ),
        ),
        gapMd,
        Card(
          child: Padding(
            padding: const EdgeInsets.all(BfTokens.spaceMd),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Ship to', style: t.textTheme.titleMedium),
                Text('${o.recipient}\n${o.address}\n${o.phone}'),
                if (o.trackingNumber != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      '${o.carrier} · tracking ${o.trackingNumber}',
                      style: t.textTheme.bodySmall,
                    ),
                  ),
              ],
            ),
          ),
        ),
        ExpansionTile(
          title: const Text('History'),
          children: [
            for (final e in o.timeline)
              ListTile(
                dense: true,
                leading: BfStatusBadge(e.status),
                title: Text(_date(e.at)),
                subtitle: e.note == null ? null : Text(e.note!),
              ),
          ],
        ),
        gapXl,
      ],
    );
  }

  Future<void> _ship(BuildContext context, OrderDetailCubit cubit) async {
    final details = await showDialog<({String carrier, String tracking})>(context: context, builder: (_) => const _ShipDialog());
    if (details != null) cubit.ship(details.carrier, details.tracking);
  }

  Future<void> _cancel(BuildContext context, OrderDetailCubit cubit) async {
    final reason = await showReasonDialog(
      context,
      title: 'Cancel this order?',
      body: 'The customer sees this reason. Online payments are refunded automatically.',
      danger: true,
      confirmLabel: 'Cancel order',
    );
    if (reason != null) cubit.cancel(reason);
  }

  Future<void> _decline(BuildContext context, OrderDetailCubit cubit) async {
    final reason = await showReasonDialog(
      context,
      title: 'Decline this return?',
      confirmLabel: 'Decline return',
    );
    if (reason != null) cubit.rejectReturn(reason);
  }
}

/// Collects carrier + tracking number; the Mark-as-shipped button stays disabled until both look valid.
class _ShipDialog extends StatefulWidget {
  const _ShipDialog();
  @override
  State<_ShipDialog> createState() => _ShipDialogState();
}

class _ShipDialogState extends State<_ShipDialog> {
  final _carrier = TextEditingController();
  final _tracking = TextEditingController();

  @override
  void dispose() {
    _carrier.dispose();
    _tracking.dispose();
    super.dispose();
  }

  bool get _valid => _carrier.text.trim().length >= 2 && _tracking.text.trim().length >= 3;

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Shipment details'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: _carrier, decoration: const InputDecoration(labelText: 'Carrier (e.g. Pathao)'), onChanged: (_) => setState(() {})),
          gapMd,
          TextField(controller: _tracking, decoration: const InputDecoration(labelText: 'Tracking number'), onChanged: (_) => setState(() {})),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: _valid ? () => Navigator.pop(context, (carrier: _carrier.text.trim(), tracking: _tracking.text.trim())) : null, child: const Text('Mark as shipped')),
        ],
      );
}
