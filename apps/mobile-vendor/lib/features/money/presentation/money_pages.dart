import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../app/deps.dart';
import '../data/money_repository.dart';

String _date(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class EarningsPage extends StatelessWidget {
  const EarningsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return MultiBlocProvider(
      providers: [
        BlocProvider(
          create: (_) => ResourceCubit<Balance>(deps.money.balance)..load(),
        ),
        BlocProvider(
          create: (_) =>
              PagedCubit<Payout>((c) => deps.money.payouts(cursor: c))..load(),
        ),
        BlocProvider(
          create: (_) =>
              PagedCubit<LedgerEntry>((c) => deps.money.ledger(cursor: c))
                ..load(),
        ),
      ],
      child: DefaultTabController(
        length: 2,
        child: Builder(
          builder: (context) => Scaffold(
            appBar: AppBar(
              title: const Text('Earnings'),
              bottom: const TabBar(
                tabs: [
                  Tab(text: 'Payouts'),
                  Tab(text: 'Ledger'),
                ],
              ),
            ),
            body: Column(
              children: [
                const Padding(padding: pagePadding, child: _Balance()),
                Expanded(
                  child: TabBarView(
                    children: [
                      BfPagedView<Payout>(
                        key: const ValueKey('payouts'),
                        emptyTitle: 'No payouts yet',
                        emptyIcon: Icons.account_balance_wallet_outlined,
                        itemBuilder: (context, p) => Card(
                          child: ListTile(
                            title: BfMoney(p.amountMinor),
                            subtitle: Text(_date(p.createdAt)),
                            trailing: p.status == 'requested'
                                ? Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      BfStatusBadge(p.status),
                                      IconButton(
                                        tooltip: 'Cancel payout',
                                        icon: const Icon(Icons.close),
                                        onPressed: () =>
                                            _cancel(context, deps, p),
                                      ),
                                    ],
                                  )
                                : BfStatusBadge(p.status),
                          ),
                        ),
                      ),
                      BfPagedView<LedgerEntry>(
                        key: const ValueKey('ledger'),
                        emptyTitle: 'No ledger entries yet',
                        emptyIcon: Icons.receipt_long_outlined,
                        itemBuilder: (context, e) => Card(
                          child: ListTile(
                            title: Text(humanize(e.type)),
                            subtitle: Text(
                              '${_date(e.createdAt)} · ${e.availableAt == null ? 'payable after delivery' : 'payable from ${_date(e.availableAt!)}'}',
                            ),
                            trailing: Text(
                              '${e.amountMinor < 0 ? '−' : '+'}${formatMoney(e.amountMinor.abs())}',
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                color: e.amountMinor < 0
                                    ? Theme.of(context).colorScheme.error
                                    : null,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _cancel(
    BuildContext context,
    AppDependencies deps,
    Payout p,
  ) async {
    final cubit = context.read<PagedCubit<Payout>>();
    final balance = context.read<ResourceCubit<Balance>>();
    if (!await confirm(
      context,
      title: 'Cancel this payout request?',
      body: 'The amount returns to your available balance.',
      confirmLabel: 'Cancel request',
    )) {
      return;
    }
    try {
      await deps.money.cancelPayout(p.id);
      cubit.refresh();
      balance.refresh();
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.userMessage)));
      }
    }
  }
}

class _Balance extends StatelessWidget {
  const _Balance();

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return BlocBuilder<ResourceCubit<Balance>, ResourceState<Balance>>(
      builder: (context, s) => switch (s) {
        ResourceLoaded<Balance>(:final data) => Card(
          child: Padding(
            padding: const EdgeInsets.all(BfTokens.spaceMd),
            child: Column(
              children: [
                BfKeyValue(
                  'Available to withdraw',
                  BfMoney(data.availableMinor),
                  strong: true,
                ),
                BfKeyValue(
                  'Pending (held until delivery)',
                  BfMoney(data.pendingMinor),
                ),
                BfKeyValue('Lifetime sales', BfMoney(data.lifetimeSalesMinor)),
                gapSm,
                BfButton(
                  label: 'Request payout',
                  expand: true,
                  onPressed: data.availableMinor <= 0
                      ? null
                      : () async {
                          final payouts = context.read<PagedCubit<Payout>>();
                          final balance = context
                              .read<ResourceCubit<Balance>>();
                          final input = await showReasonDialog(
                            context,
                            title: 'Request a payout',
                            body:
                                'Available now: ${formatMoney(data.availableMinor)}. Payouts go to the destination in your store settings.',
                            fieldLabel: 'Amount (৳)',
                            minLength: 1,
                            confirmLabel: 'Request payout',
                          );
                          final minor = input == null
                              ? null
                              : parseMoneyInput(input);
                          if (minor == null) return;
                          try {
                            await deps.money.requestPayout(minor);
                            payouts.refresh();
                            balance.refresh();
                          } on ApiException catch (e) {
                            if (context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text(_payoutError(e))),
                              );
                            }
                          }
                        },
                ),
              ],
            ),
          ),
        ),
        ResourceFailure<Balance>(:final error) => BfErrorPanel(
          error: error,
          onRetry: context.read<ResourceCubit<Balance>>().load,
        ),
        _ => const BfSkeleton(height: 140),
      },
    );
  }

  String _payoutError(ApiException e) {
    final f = e.details.isEmpty ? null : e.details.first;
    return switch (f?.code) {
      'REQUIRED' => 'Add a payout destination in your store settings on the web console first.',
      'BELOW_MINIMUM' => 'That is below the minimum payout.',
      'EXCEEDS_AVAILABLE' => 'That is more than your available balance.',
      'UNVERIFIED' => 'Verify your email address first.',
      _ => e.userMessage,
    };
  }
}
