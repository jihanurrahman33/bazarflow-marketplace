import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../app/deps.dart';
import '../../queues/data/admin_repository.dart';

class OverviewPage extends StatelessWidget {
  const OverviewPage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    final canReport = deps.session.user?.can('report.read') ?? false;
    return MultiBlocProvider(
      providers: [
        BlocProvider(create: (_) => ResourceCubit<OpsHealth>(deps.admin.health)..load()),
        BlocProvider(create: (_) => ResourceCubit<SalesSummary>(() => deps.admin.sales(DateTime.now().subtract(const Duration(days: 7)), DateTime.now()))..load()),
      ],
      child: Scaffold(
        appBar: AppBar(title: const Text('Overview')),
        body: !canReport
            ? const BfEmptyState(icon: Icons.lock_outline, title: 'No reporting access', message: 'Your role has no reporting permission. Open your work queues from the Queues tab.')
            : const _OverviewBody(),
      ),
    );
  }
}

class _OverviewBody extends StatelessWidget {
  const _OverviewBody();

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async {
        await context.read<ResourceCubit<OpsHealth>>().refresh();
        if (context.mounted) await context.read<ResourceCubit<SalesSummary>>().refresh();
      },
      child: ListView(padding: pagePadding, physics: const AlwaysScrollableScrollPhysics(), children: [
        Text('System health', style: Theme.of(context).textTheme.titleLarge),
        gapSm,
        BlocBuilder<ResourceCubit<OpsHealth>, ResourceState<OpsHealth>>(
          builder: (context, s) => switch (s) {
            ResourceLoaded<OpsHealth>(:final data) => _Health(h: data),
            ResourceFailure<OpsHealth>(:final error) => BfErrorPanel(error: error, onRetry: context.read<ResourceCubit<OpsHealth>>().load),
            _ => const BfSkeleton(height: 160),
          },
        ),
        gapXl,
        Text('Last 7 days', style: Theme.of(context).textTheme.titleLarge),
        gapSm,
        BlocBuilder<ResourceCubit<SalesSummary>, ResourceState<SalesSummary>>(
          builder: (context, s) => switch (s) {
            ResourceLoaded<SalesSummary>(:final data) => Card(
                child: Padding(
                  padding: const EdgeInsets.all(BfTokens.spaceMd),
                  child: Column(children: [
                    BfKeyValue('Paid orders', Text('${data.paidOrders}')),
                    BfKeyValue('Gross merchandise', BfMoney(data.grossMinor)),
                    BfKeyValue('Platform commission', BfMoney(data.commissionMinor)),
                    BfKeyValue('Refunds', BfMoney(data.refundsMinor)),
                  ]),
                ),
              ),
            ResourceFailure<SalesSummary>(:final error) => BfErrorPanel(error: error, onRetry: context.read<ResourceCubit<SalesSummary>>().load),
            _ => const BfSkeleton(height: 120),
          },
        ),
      ]),
    );
  }
}

class _Health extends StatelessWidget {
  const _Health({required this.h});
  final OpsHealth h;

  @override
  Widget build(BuildContext context) {
    Widget row(String label, String value, {bool warn = false, String? route}) => ListTile(
          dense: true,
          title: Text(label),
          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
            BfStatusBadge(warn ? 'failed' : 'succeeded'),
            gapSm,
            Text(value),
          ]),
          onTap: route == null ? null : () => context.push(route),
        );
    return Card(
      child: Column(children: [
        if (h.needsAttention) const Padding(padding: EdgeInsets.all(BfTokens.spaceMd), child: BfNotice(text: 'Something needs attention.', tone: StatusTone.warning)),
        row('Background queue', '${h.deadEvents} dead · ${h.pendingEvents} pending', warn: h.deadEvents > 0),
        row('Payments unknown / stuck', '${h.unknownPayments} / ${h.stuckPayments}', warn: h.unknownPayments + h.stuckPayments > 0, route: '/queues/payments'),
        row('Failed refunds', '${h.failedRefunds}', warn: h.failedRefunds > 0, route: '/queues/refunds'),
        row('Payouts to approve / pay', '${h.payoutsToApprove} / ${h.payoutsToPay}', route: '/queues/payouts'),
      ]),
    );
  }
}
