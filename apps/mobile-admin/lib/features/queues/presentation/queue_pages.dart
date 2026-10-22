import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../app/deps.dart';
import '../data/admin_repository.dart';

String _date(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class QueuesHomePage extends StatelessWidget {
  const QueuesHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final user = context.read<AppDependencies>().session.user;
    bool can(String p) => user?.can(p) ?? false;
    Widget tile(IconData icon, String title, String subtitle, String route) => Card(child: ListTile(leading: Icon(icon), title: Text(title), subtitle: Text(subtitle), trailing: const Icon(Icons.chevron_right), onTap: () => context.push(route)));
    final tiles = [
      if (can('vendor.review')) tile(Icons.storefront_outlined, 'Seller applications', 'Approve, reject or ask for more information', '/queues/applications'),
      if (can('catalog.moderate')) tile(Icons.fact_check_outlined, 'Product review', 'Moderate products before they go live', '/queues/products'),
      if (can('payment.reconcile')) tile(Icons.sync_problem_outlined, 'Payment exceptions', 'Unknown or stuck payments', '/queues/payments'),
      if (can('refund.approve')) tile(Icons.undo, 'Refunds', 'Approve or reject refund requests', '/queues/refunds'),
      if (can('payout.approve')) tile(Icons.account_balance_outlined, 'Payouts', 'Approve seller payout requests', '/queues/payouts'),
    ];
    return Scaffold(
      appBar: AppBar(title: const Text('Queues')),
      body: tiles.isEmpty ? const BfEmptyState(icon: Icons.lock_outline, title: 'No queues for your role', message: 'Ask an administrator to grant permissions.') : ListView(padding: pagePadding, children: [for (final t in tiles) ...[t, gapSm]]),
    );
  }
}

/// Runs one admin action: success refreshes the list, failures show the server's reason. Step-up (password) prompts
/// happen inside the API client when the server asks for them.
Future<void> runAdminAction(BuildContext context, Future<void> Function() op, {required String success, required VoidCallback done}) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    await op();
    messenger.showSnackBar(SnackBar(content: Text(success)));
    done();
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.stepUpRequired ? 'Password confirmation was cancelled.' : e.code == 'FORBIDDEN' && e.details.any((d) => d.code == 'MAKER_CHECKER') ? 'A different administrator must approve this.' : e.userMessage)));
  }
}

class _Queue<T> extends StatelessWidget {
  const _Queue({required this.title, required this.fetch, required this.emptyTitle, required this.builder});
  final String title;
  final Future<PageResult<T>> Function(AppDependencies deps, String? cursor) fetch;
  final String emptyTitle;
  final Widget Function(BuildContext context, T item, AppDependencies deps, VoidCallback refresh) builder;

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return BlocProvider(
      create: (_) => PagedCubit<T>((c) => fetch(deps, c))..load(),
      child: Builder(
        builder: (context) => Scaffold(
          appBar: AppBar(title: Text(title)),
          body: BfPagedView<T>(emptyTitle: emptyTitle, emptyIcon: Icons.check_circle_outline, itemBuilder: (context, item) => builder(context, item, deps, context.read<PagedCubit<T>>().refresh)),
        ),
      ),
    );
  }
}

class ApplicationsQueue extends StatelessWidget {
  const ApplicationsQueue({super.key});
  @override
  Widget build(BuildContext context) => _Queue<SellerApplication>(
        title: 'Seller applications',
        emptyTitle: 'Nothing to review',
        fetch: (d, c) => d.admin.applications(cursor: c),
        builder: (context, a, deps, refresh) => Card(
          child: Padding(
            padding: const EdgeInsets.all(BfTokens.spaceMd),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(a.name, style: Theme.of(context).textTheme.titleMedium),
              Text('/${a.slug} · ${a.phone}\n${a.address}\nApplied ${_date(a.createdAt)}', style: Theme.of(context).textTheme.bodySmall),
              gapSm,
              Wrap(spacing: BfTokens.spaceSm, children: [
                BfButton(label: 'Approve', onPressed: () => runAdminAction(context, () => deps.admin.approveApplication(a.id), success: 'Seller approved', done: refresh)),
                BfButton(label: 'Ask for info', variant: BfButtonVariant.secondary, onPressed: () async {
                  final r = await showReasonDialog(context, title: 'Request more information', body: 'The applicant sees this message.', confirmLabel: 'Send');
                  if (r != null && context.mounted) await runAdminAction(context, () => deps.admin.requestInfo(a.id, r), success: 'Requested', done: refresh);
                }),
                BfButton(label: 'Reject', variant: BfButtonVariant.danger, onPressed: () async {
                  final r = await showReasonDialog(context, title: 'Reject application', body: 'The applicant sees this message.', danger: true, confirmLabel: 'Reject');
                  if (r != null && context.mounted) await runAdminAction(context, () => deps.admin.rejectApplication(a.id, r), success: 'Rejected', done: refresh);
                }),
              ]),
            ]),
          ),
        ),
      );
}

class ProductsQueue extends StatelessWidget {
  const ProductsQueue({super.key});
  @override
  Widget build(BuildContext context) => _Queue<ReviewProduct>(
        title: 'Product review',
        emptyTitle: 'No products waiting',
        fetch: (d, c) => d.admin.reviewQueue(cursor: c),
        builder: (context, p, deps, refresh) => Card(
          child: Padding(
            padding: const EdgeInsets.all(BfTokens.spaceMd),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(p.title, style: Theme.of(context).textTheme.titleMedium),
              Text('${p.imageCount} photo(s) · ${p.variantCount} variant(s) · from ${formatMoney(p.minPriceMinor)}', style: Theme.of(context).textTheme.bodySmall),
              gapXs,
              Text(p.description, maxLines: 4, overflow: TextOverflow.ellipsis),
              gapSm,
              Wrap(spacing: BfTokens.spaceSm, children: [
                BfButton(label: 'Approve', onPressed: () => runAdminAction(context, () => deps.admin.approveProduct(p.id), success: 'Published', done: refresh)),
                BfButton(label: 'Reject', variant: BfButtonVariant.danger, onPressed: () async {
                  final r = await showReasonDialog(context, title: 'Reject product', body: 'The seller sees this reason.', danger: true, confirmLabel: 'Reject');
                  if (r != null && context.mounted) await runAdminAction(context, () => deps.admin.rejectProduct(p.id, r), success: 'Rejected', done: refresh);
                }),
              ]),
            ]),
          ),
        ),
      );
}

class PaymentsQueue extends StatelessWidget {
  const PaymentsQueue({super.key});
  @override
  Widget build(BuildContext context) => _Queue<PaymentException>(
        title: 'Payment exceptions',
        emptyTitle: 'No exceptions',
        fetch: (d, c) => d.admin.paymentExceptions(cursor: c),
        builder: (context, p, deps, refresh) => Card(
          child: ListTile(
            title: Text(p.reference),
            subtitle: Text('${formatMoney(p.amountMinor)}${p.reason != null ? ' · ${humanize(p.reason!)}' : ' · in flight too long'}'),
            trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [BfStatusBadge(p.status), TextButton(onPressed: () => runAdminAction(context, () => deps.admin.reconcile(p.id), success: 'Checked with the provider', done: refresh), child: const Text('Reconcile'))]),
            onTap: () => context.push('/orders/${p.orderId}'),
          ),
        ),
      );
}

class RefundsQueue extends StatelessWidget {
  const RefundsQueue({super.key});
  @override
  Widget build(BuildContext context) => _Queue<RefundRequest>(
        title: 'Refund requests',
        emptyTitle: 'No refund requests',
        fetch: (d, c) => d.admin.refunds(cursor: c),
        builder: (context, r, deps, refresh) => Card(
          child: Padding(
            padding: const EdgeInsets.all(BfTokens.spaceMd),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [Expanded(child: BfMoney(r.amountMinor, style: Theme.of(context).textTheme.titleLarge)), BfStatusBadge(r.status)]),
              Text(r.reason),
              gapSm,
              Wrap(spacing: BfTokens.spaceSm, children: [
                BfButton(label: 'Approve', onPressed: () async {
                  if (!await confirm(context, title: 'Approve this refund?', body: '${formatMoney(r.amountMinor)} will be returned to the customer. You will be asked to confirm your password.', confirmLabel: 'Approve')) return;
                  if (context.mounted) await runAdminAction(context, () => deps.admin.approveRefund(r.id), success: 'Refund approved', done: refresh);
                }),
                BfButton(label: 'Reject', variant: BfButtonVariant.danger, onPressed: () async {
                  final reason = await showReasonDialog(context, title: 'Reject refund', danger: true, confirmLabel: 'Reject');
                  if (reason != null && context.mounted) await runAdminAction(context, () => deps.admin.rejectRefund(r.id, reason), success: 'Rejected', done: refresh);
                }),
                TextButton(onPressed: () => context.push('/orders/${r.orderId}'), child: const Text('View order')),
              ]),
            ]),
          ),
        ),
      );
}

class PayoutsQueue extends StatelessWidget {
  const PayoutsQueue({super.key});
  @override
  Widget build(BuildContext context) => _Queue<PayoutRequest>(
        title: 'Payout requests',
        emptyTitle: 'No payout requests',
        fetch: (d, c) => d.admin.payouts(cursor: c),
        builder: (context, p, deps, refresh) => Card(
          child: Padding(
            padding: const EdgeInsets.all(BfTokens.spaceMd),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [Expanded(child: BfMoney(p.amountMinor, style: Theme.of(context).textTheme.titleLarge)), BfStatusBadge(p.status)]),
              Text('${humanize(p.method)} · ${p.accountName} · ${p.maskedRef}\nRequested ${_date(p.createdAt)}', style: Theme.of(context).textTheme.bodySmall),
              gapXs,
              const Text('Recording the transfer as paid is done in the web console.', style: TextStyle(fontSize: 12)),
              gapSm,
              Wrap(spacing: BfTokens.spaceSm, children: [
                BfButton(label: 'Approve', onPressed: () async {
                  if (!await confirm(context, title: 'Approve this payout?', body: 'You will be asked to confirm your password.', confirmLabel: 'Approve')) return;
                  if (context.mounted) await runAdminAction(context, () => deps.admin.approvePayout(p.id), success: 'Payout approved', done: refresh);
                }),
                BfButton(label: 'Reject', variant: BfButtonVariant.danger, onPressed: () async {
                  final reason = await showReasonDialog(context, title: 'Reject payout', body: 'The funds return to the seller balance.', danger: true, confirmLabel: 'Reject');
                  if (reason != null && context.mounted) await runAdminAction(context, () => deps.admin.rejectPayout(p.id, reason), success: 'Rejected', done: refresh);
                }),
              ]),
            ]),
          ),
        ),
      );
}
