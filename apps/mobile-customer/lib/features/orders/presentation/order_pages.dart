import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app/deps.dart';
import '../domain/order_models.dart';
import 'order_cubit.dart';

String _date(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class OrdersPage extends StatelessWidget {
  const OrdersPage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return BlocProvider(
      create: (_) => PagedCubit<OrderSummary>((c) => deps.orders.list(cursor: c))..load(),
      child: Scaffold(
        appBar: AppBar(title: const Text('Your orders')),
        body: BfPagedView<OrderSummary>(
          emptyTitle: 'No orders yet',
          emptyMessage: 'When you place an order it will appear here.',
          emptyIcon: Icons.receipt_long_outlined,
          emptyAction: BfButton(label: 'Start shopping', onPressed: () => context.go('/')),
          itemBuilder: (context, o) => Card(
            child: ListTile(
              onTap: () => context.push('/orders/${o.id}'),
              title: Text(o.orderNumber),
              subtitle: Text(_date(o.createdAt)),
              trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [BfMoney(o.totalMinor), const SizedBox(height: 4), BfStatusBadge(o.status)]),
            ),
          ),
        ),
      ),
    );
  }
}

class OrderPage extends StatefulWidget {
  const OrderPage({super.key, required this.orderId, this.returnedFromPayment = false});
  final String orderId;
  final bool returnedFromPayment;
  @override
  State<OrderPage> createState() => _OrderPageState();
}

class _OrderPageState extends State<OrderPage> with WidgetsBindingObserver {
  late final OrderCubit _cubit;

  @override
  void initState() {
    super.initState();
    final deps = context.read<AppDependencies>();
    _cubit = OrderCubit(deps.orders, widget.orderId, cameFromPayment: widget.returnedFromPayment)..load();
    WidgetsBinding.instance.addObserver(this);
  }

  /// Coming back from the provider's browser page: verify with the server, never assume.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      final s = _cubit.state;
      if (s is OrderLoaded && s.order.awaitingPayment) _cubit.checkNow();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _cubit.close();
    super.dispose();
  }

  Future<void> _open(String? url) async {
    final uri = url == null ? null : Uri.tryParse(url);
    if (uri != null && (uri.scheme == 'https' || uri.scheme == 'http')) await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(title: const Text('Order')),
        body: BlocConsumer<OrderCubit, OrderState>(
          listenWhen: (a, b) => b is OrderLoaded && b.actionError != null && (a is! OrderLoaded || a.actionError != b.actionError),
          listener: (context, state) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text((state as OrderLoaded).actionError!.userMessage))),
          builder: (context, state) => switch (state) {
            OrderLoading() => const BfListSkeleton(),
            OrderFailure(:final error) => BfErrorPanel(error: error, onRetry: _cubit.load),
            OrderLoaded() => RefreshIndicator(onRefresh: _cubit.load, child: _OrderBody(state: state, onOpen: _open)),
          },
        ),
      ),
    );
  }
}

class _OrderBody extends StatelessWidget {
  const _OrderBody({required this.state, required this.onOpen});
  final OrderLoaded state;
  final Future<void> Function(String?) onOpen;

  @override
  Widget build(BuildContext context) {
    final o = state.order;
    final t = Theme.of(context);
    final cubit = context.read<OrderCubit>();
    return ListView(padding: pagePadding, physics: const AlwaysScrollableScrollPhysics(), children: [
      if (state.refreshError != null) ...[BfNotice(text: state.refreshError!.isNetwork ? "You're offline. Showing the last loaded data." : state.refreshError!.userMessage, tone: StatusTone.warning), gapMd],
      Row(children: [Expanded(child: Text(o.orderNumber, style: t.textTheme.headlineMedium)), BfStatusBadge(o.status)]),
      Text('Placed ${_date(o.createdAt)} · ${o.paymentMethod == 'cod' ? 'Cash on delivery' : 'Paid online'}', style: t.textTheme.bodySmall),
      gapMd,
      if (state.hasOpenPaymentPage) ...[BfNotice(title: 'Complete your payment', text: "You'll finish on the provider's secure page.", tone: StatusTone.warning, action: BfButton(label: 'Pay now', onPressed: () => onOpen(state.payment!.redirectUrl))), gapMd],
      if (state.verifying) ...[
        BfNotice(
          title: state.payment?.status == 'unknown' ? 'We are confirming your payment' : 'Waiting for payment confirmation',
          text: "${state.payment?.message ?? 'This usually takes a few seconds.'} Please don't pay again.",
          action: state.polling ? const Row(children: [SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)), SizedBox(width: 8), Text('Checking…')]) : BfButton(label: 'Check status', variant: BfButtonVariant.secondary, loading: state.acting, onPressed: cubit.checkNow),
        ),
        gapMd,
      ],
      if (state.canPayAgain) ...[
        BfNotice(
          title: 'Payment not completed',
          text: 'You have not been charged for a failed attempt.',
          tone: StatusTone.danger,
          action: BfButton(label: 'Try payment again', loading: state.acting, onPressed: () async => onOpen(await cubit.payAgain())),
        ),
        gapMd,
      ],
      if (o.status == 'cancelled') ...[BfNotice(text: o.cancellationReason == 'payment_expired' ? 'Payment was not completed in time.' : (o.paymentStatus == 'refunded' || o.paymentStatus == 'partially_refunded') ? 'Your payment has been refunded.' : 'This order was cancelled.', tone: StatusTone.warning), gapMd],
      for (final v in o.vendorOrders) _VendorOrderCard(v: v),
      gapMd,
      Card(
        child: Padding(
          padding: const EdgeInsets.all(BfTokens.spaceMd),
          child: Column(children: [
            BfKeyValue('Items', BfMoney(o.subtotalMinor)),
            BfKeyValue('Shipping', BfMoney(o.shippingMinor)),
            BfKeyValue('Total', BfMoney(o.totalMinor), strong: true),
            const Divider(),
            Align(alignment: Alignment.centerLeft, child: Text('Delivery: ${o.address}', style: t.textTheme.bodySmall)),
          ]),
        ),
      ),
      if (o.cancellable) ...[
        gapLg,
        BfButton(
          label: 'Cancel order',
          variant: BfButtonVariant.danger,
          loading: state.acting,
          onPressed: () async {
            final ok = await confirm(context, title: 'Cancel this order?', body: o.paymentStatus == 'paid' ? 'Your payment will be refunded to your original payment method.' : 'Items in this order will be released.', confirmLabel: 'Yes, cancel order', danger: true);
            if (ok) cubit.cancel();
          },
        ),
      ],
      gapXl,
    ]);
  }
}

class _VendorOrderCard extends StatelessWidget {
  const _VendorOrderCard({required this.v});
  final VendorOrderView v;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final cubit = context.read<OrderCubit>();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(BfTokens.spaceMd),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Expanded(child: Text('Sold by ${v.vendorName}', style: t.textTheme.titleMedium)), BfStatusBadge(v.status)]),
          const Divider(),
          for (final i in v.items)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(children: [
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(i.title), Text('${i.quantity} × ${formatMoney(i.unitPriceMinor)}${i.variantLabel == 'Default' ? '' : ' · ${i.variantLabel}'}', style: t.textTheme.bodySmall)])),
                BfMoney(i.lineTotalMinor),
                if (v.status == 'delivered') TextButton(onPressed: () => _review(context, cubit, i), child: const Text('Review')),
              ]),
            ),
          if (v.trackingNumber != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${v.carrier} · tracking ${v.trackingNumber}', style: t.textTheme.bodySmall)),
          if (v.timeline.isNotEmpty)
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: const Text('Progress'),
              children: [for (final e in v.timeline) ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: BfStatusBadge(e.status), title: Text(_date(e.at)), subtitle: e.note == null ? null : Text(e.note!))],
            ),
          if (v.status == 'delivered') TextButton(onPressed: () => _return(context, cubit), child: const Text('Request a return')),
        ]),
      ),
    );
  }

  Future<void> _return(BuildContext context, OrderCubit cubit) async {
    final reason = await showReasonDialog(context, title: 'Request a return', fieldLabel: 'What went wrong?', confirmLabel: 'Send request');
    if (reason != null) cubit.requestReturn(v.id, reason);
  }

  Future<void> _review(BuildContext context, OrderCubit cubit, OrderItem item) async {
    final body = await showReasonDialog(context, title: 'Review ${item.title}', fieldLabel: 'Your review (10+ characters)', confirmLabel: 'Post review', minLength: 10);
    if (body != null) cubit.review(item.productSlug, 5, body);
  }
}
