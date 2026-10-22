import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:observability/observability.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app/deps.dart';
import '../domain/checkout_models.dart';
import 'checkout_bloc.dart';

class CheckoutPage extends StatelessWidget {
  const CheckoutPage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return BlocProvider(
      create: (_) {
        deps.obs.analytics.log(AnalyticsEvents.checkoutStarted);
        return CheckoutBloc(deps.checkout)..add(const CheckoutStarted());
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Checkout')),
        body: BlocConsumer<CheckoutBloc, CheckoutState>(
          listenWhen: (a, b) => a.phase != b.phase && b.phase == CheckoutPhase.placed,
          listener: (context, state) async {
            final order = state.placed!;
            deps.badge.set(0);
            deps.obs.analytics.log(AnalyticsEvents.checkoutCompleted, {'method': state.method.name});
            final url = order.payment?.redirectUrl;
            final router = GoRouter.of(context);
            if (url != null) {
              // The provider's hosted page opens outside the app. Whatever happens there, the ORDER page (not this
              // screen) is where the outcome is verified server-side.
              router.go('/orders/${order.orderId}?returned=1');
              final uri = Uri.tryParse(url);
              if (uri != null && (uri.scheme == 'https' || uri.scheme == 'http')) {
                await launchUrl(uri, mode: LaunchMode.externalApplication);
              }
            } else {
              router.go('/orders/${order.orderId}');
            }
          },
          builder: (context, state) {
            if (state.phase == CheckoutPhase.loading) return const BfListSkeleton(rows: 4);
            if (state.phase == CheckoutPhase.failure) return BfErrorPanel(error: state.error!, onRetry: () => context.read<CheckoutBloc>().add(const CheckoutStarted()));
            return _CheckoutBody(state: state);
          },
        ),
      ),
    );
  }
}

class _CheckoutBody extends StatelessWidget {
  const _CheckoutBody({required this.state});
  final CheckoutState state;

  @override
  Widget build(BuildContext context) {
    final bloc = context.read<CheckoutBloc>();
    final t = Theme.of(context);
    final q = state.quote;
    final placing = state.phase == CheckoutPhase.placing || state.phase == CheckoutPhase.placed;
    return Column(children: [
      Expanded(
        child: ListView(padding: pagePadding, children: [
          if (state.stale) ...[const BfNotice(title: 'Your order changed', text: 'Prices or stock changed, so we refreshed your summary. Review it and place your order again.', tone: StatusTone.warning), gapMd],
          if (state.error != null && !state.stale) ...[BfInlineError(state.error!), gapMd],
          Text('Delivery address', style: t.textTheme.titleLarge),
          gapSm,
          if (state.addresses.isEmpty) const Text('Add an address to continue.'),
          RadioGroup<String>(
            groupValue: state.selectedAddressId,
            onChanged: (v) => v == null || placing ? null : bloc.add(CheckoutAddressSelected(v)),
            child: Column(children: [
              for (final a in state.addresses)
                Card(child: RadioListTile<String>(value: a.id, title: Text('${a.label} · ${a.recipient}'), subtitle: Text('${a.oneLine}\n${a.phone}'), isThreeLine: true)),
            ]),
          ),
          Align(alignment: Alignment.centerLeft, child: TextButton.icon(icon: const Icon(Icons.add), label: const Text('New address'), onPressed: placing ? null : () => _addAddress(context))),
          gapLg,
          Text('Payment', style: t.textTheme.titleLarge),
          gapSm,
          RadioGroup<PaymentMethod>(
            groupValue: state.method,
            onChanged: (v) => v == null || placing ? null : bloc.add(CheckoutMethodSelected(v)),
            child: Column(children: [
              const Card(child: RadioListTile<PaymentMethod>(value: PaymentMethod.online, title: Text('Pay online'), subtitle: Text("You'll finish on the provider's secure page"))),
              if (q?.paymentMethods.contains('cod') ?? false) const Card(child: RadioListTile<PaymentMethod>(value: PaymentMethod.cod, title: Text('Cash on delivery'), subtitle: Text('Pay the courier when your order arrives'))),
            ]),
          ),
          gapLg,
          Text('Summary', style: t.textTheme.titleLarge),
          gapSm,
          if (q == null || state.quoting) const BfSkeleton(height: 90) else ...[
            for (final g in q.groups) ...[
              Text(g.vendorName, style: t.textTheme.titleMedium),
              for (final l in g.lines) BfKeyValue('${l.quantity} × ${l.title}', BfMoney(l.lineTotalMinor)),
              BfKeyValue('Shipping', BfMoney(g.shippingMinor)),
              gapSm,
            ],
            if (q.hasIssues) BfNotice(text: 'Some items are unavailable.', tone: StatusTone.warning, action: TextButton(onPressed: () => context.go('/cart'), child: const Text('Review cart'))),
          ],
        ]),
      ),
      SafeArea(
        top: false,
        child: Container(
          padding: pagePadding,
          decoration: BoxDecoration(color: t.colorScheme.surface, border: Border(top: BorderSide(color: t.colorScheme.outline))),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            if (q != null) BfKeyValue('Total', BfMoney(q.totalMinor), strong: true),
            gapSm,
            BfButton(label: state.method == PaymentMethod.cod ? 'Place order' : 'Continue to payment', loading: placing, expand: true, onPressed: state.canPlace ? () => bloc.add(const CheckoutPlaceOrderPressed()) : null),
            const SizedBox(height: 4),
            Text('Tapping again after a connection problem is safe: your order is only created once.', style: t.textTheme.bodySmall, textAlign: TextAlign.center),
          ]),
        ),
      ),
    ]);
  }

  Future<void> _addAddress(BuildContext context) async {
    final bloc = context.read<CheckoutBloc>();
    final input = await showModalBottomSheet<AddressInput>(context: context, isScrollControlled: true, builder: (_) => const AddressFormSheet());
    if (input != null) bloc.add(CheckoutAddressAdded(input));
  }
}

/// Address entry shared by checkout and the address book.
class AddressFormSheet extends StatefulWidget {
  const AddressFormSheet({super.key});
  @override
  State<AddressFormSheet> createState() => _AddressFormSheetState();
}

class _AddressFormSheetState extends State<AddressFormSheet> {
  final _form = GlobalKey<FormState>();
  final _c = {for (final k in ['label', 'recipient', 'phone', 'line1', 'line2', 'city', 'district', 'postalCode']) k: TextEditingController(text: k == 'label' ? 'Home' : '')};

  @override
  void dispose() {
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  String? _req(String? v) => (v == null || v.trim().length < 2) ? 'Required' : null;

  @override
  Widget build(BuildContext context) {
    Widget field(String key, String label, {String? Function(String?)? validator, TextInputType? type, int? maxLength}) => Padding(
          padding: const EdgeInsets.only(bottom: BfTokens.spaceMd),
          child: TextFormField(controller: _c[key], keyboardType: type, maxLength: maxLength, decoration: InputDecoration(labelText: label, counterText: ''), validator: validator),
        );
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: pagePadding,
          child: Form(
            key: _form,
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('New address', style: Theme.of(context).textTheme.titleLarge),
              gapMd,
              field('label', 'Label', validator: _req),
              field('recipient', 'Recipient name', validator: _req),
              field('phone', 'Mobile number', type: TextInputType.phone, validator: (v) => RegExp(r'^\+?[0-9]{7,15}$').hasMatch((v ?? '').trim()) ? null : 'Enter a valid number'),
              field('line1', 'Address line 1', validator: _req),
              field('line2', 'Address line 2 (optional)'),
              field('city', 'City', validator: _req),
              field('district', 'District', validator: _req),
              field('postalCode', 'Postal code', type: TextInputType.number, maxLength: 4, validator: (v) => RegExp(r'^[0-9]{4}$').hasMatch((v ?? '').trim()) ? null : '4 digits'),
              BfButton(
                label: 'Save address',
                expand: true,
                onPressed: () {
                  if (!(_form.currentState?.validate() ?? false)) return;
                  String v(String k) => _c[k]!.text.trim();
                  Navigator.pop(context, AddressInput(label: v('label'), recipient: v('recipient'), phone: v('phone'), line1: v('line1'), line2: v('line2').isEmpty ? null : v('line2'), city: v('city'), district: v('district'), postalCode: v('postalCode')));
                },
              ),
            ]),
          ),
        ),
      ),
    );
  }
}
