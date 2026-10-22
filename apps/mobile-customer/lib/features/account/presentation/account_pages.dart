import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../app/deps.dart';
import '../../checkout/domain/checkout_models.dart';
import '../../checkout/presentation/checkout_page.dart' show AddressFormSheet;
import '../data/account_repository.dart';

class AccountPage extends StatelessWidget {
  const AccountPage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    final user = deps.session.user;
    if (user == null) return const SizedBox.shrink();
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: ListView(padding: pagePadding, children: [
        Card(child: ListTile(leading: const CircleAvatar(child: Icon(Icons.person)), title: Text(user.name), subtitle: Text(user.email), trailing: Icon(user.emailVerified ? Icons.verified : Icons.warning_amber, color: user.emailVerified ? Theme.of(context).extension<BfStatusColors>()!.colors.success : Theme.of(context).extension<BfStatusColors>()!.colors.warning, semanticLabel: user.emailVerified ? 'Email verified' : 'Email not verified'))),
        if (!user.emailVerified) ...[gapMd, BfNotice(title: 'Verify your email', text: 'We use it for order updates and account recovery.', tone: StatusTone.warning, action: TextButton(onPressed: () => context.push('/verify-email'), child: const Text('Verify now')))],
        gapLg,
        Card(child: Column(children: [
          ListTile(leading: const Icon(Icons.notifications_none), title: const Text('Notifications'), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/notifications')),
          const Divider(),
          ListTile(leading: const Icon(Icons.location_on_outlined), title: const Text('Addresses'), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/account/addresses')),
          const Divider(),
          ListTile(leading: const Icon(Icons.devices_outlined), title: const Text('Signed-in devices'), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/account/devices')),
          const Divider(),
          ListTile(leading: const Icon(Icons.lock_outline), title: const Text('Change password'), trailing: const Icon(Icons.chevron_right), onTap: () => _changePassword(context, deps)),
        ])),
        gapLg,
        BfButton(
          label: 'Sign out',
          variant: BfButtonVariant.secondary,
          icon: Icons.logout,
          expand: true,
          onPressed: () async {
            await deps.registrar.unregister();
            await deps.session.logout();
          },
        ),
      ]),
    );
  }

  Future<void> _changePassword(BuildContext context, AppDependencies deps) async {
    final messenger = ScaffoldMessenger.of(context);
    final current = await showReasonDialog(context, title: 'Change password', fieldLabel: 'Current password', obscure: true, minLength: 1, confirmLabel: 'Next');
    if (current == null || !context.mounted) return;
    final next = await showReasonDialog(context, title: 'New password', fieldLabel: 'New password (10+ characters)', obscure: true, minLength: 10, confirmLabel: 'Change password');
    if (next == null) return;
    try {
      await deps.account.changePassword(current, next);
      messenger.showSnackBar(const SnackBar(content: Text('Password changed. Other devices were signed out.')));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.userMessage)));
    }
  }
}

class AddressesPage extends StatelessWidget {
  const AddressesPage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return BlocProvider(
      create: (_) => ResourceCubit<List<Address>>(deps.account.addresses)..load(),
      child: Builder(
        builder: (context) => Scaffold(
          appBar: AppBar(title: const Text('Addresses')),
          floatingActionButton: FloatingActionButton.extended(
            icon: const Icon(Icons.add),
            label: const Text('Add address'),
            onPressed: () async {
              final cubit = context.read<ResourceCubit<List<Address>>>();
              final input = await showModalBottomSheet<AddressInput>(context: context, isScrollControlled: true, builder: (_) => const AddressFormSheet());
              if (input == null) return;
              try {
                await deps.account.addAddress(input);
                cubit.refresh();
              } on ApiException catch (e) {
                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.userMessage)));
              }
            },
          ),
          body: BfResourceView<List<Address>>(
            builder: (context, addresses) => addresses.isEmpty
                ? const BfEmptyState(title: 'No saved addresses', icon: Icons.location_off_outlined)
                : Column(children: [
                    for (final a in addresses)
                      Card(
                        child: ListTile(
                          title: Text('${a.label}${a.isDefault ? ' · Default' : ''}'),
                          subtitle: Text('${a.recipient}\n${a.oneLine}'),
                          isThreeLine: true,
                          trailing: IconButton(
                            tooltip: 'Delete address',
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () async {
                              final cubit = context.read<ResourceCubit<List<Address>>>();
                              if (!await confirm(context, title: 'Delete this address?', body: 'Orders you already placed keep their delivery address.', confirmLabel: 'Delete', danger: true)) return;
                              try {
                                await deps.account.deleteAddress(a.id);
                                cubit.refresh();
                              } on ApiException catch (e) {
                                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.userMessage)));
                              }
                            },
                          ),
                        ),
                      ),
                  ]),
          ),
        ),
      ),
    );
  }
}

class DevicesPage extends StatelessWidget {
  const DevicesPage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return BlocProvider(
      create: (_) => ResourceCubit<List<DeviceSession>>(deps.account.sessions)..load(),
      child: Builder(
        builder: (context) => Scaffold(
          appBar: AppBar(title: const Text('Signed-in devices')),
          body: BfResourceView<List<DeviceSession>>(
            builder: (context, sessions) => Column(children: [
              for (final s in sessions)
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.phone_android),
                    title: Text('${s.name}${s.current ? ' · This device' : ''}'),
                    subtitle: Text('Last active ${s.lastUsedAt.toLocal().toString().substring(0, 16)}'),
                    trailing: s.current
                        ? null
                        : TextButton(
                            onPressed: () async {
                              final cubit = context.read<ResourceCubit<List<DeviceSession>>>();
                              try {
                                await deps.account.revokeSession(s.id);
                                cubit.refresh();
                              } on ApiException catch (e) {
                                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.userMessage)));
                              }
                            },
                            child: const Text('Sign out'),
                          ),
                  ),
                ),
            ]),
          ),
        ),
      ),
    );
  }
}
