import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../app/deps.dart';

class AccountPage extends StatelessWidget {
  const AccountPage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    final user = deps.session.user;
    if (user == null) return const SizedBox.shrink();
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: ListView(
        padding: pagePadding,
        children: [
          Card(
            child: ListTile(
              leading: const CircleAvatar(child: Icon(Icons.storefront)),
              title: Text(user.name),
              subtitle: Text(user.email),
            ),
          ),
          gapMd,
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.notifications_none),
                  title: const Text('Notifications'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push('/notifications'),
                ),
                const Divider(),
                ListTile(
                  leading: const Icon(Icons.warehouse_outlined),
                  title: const Text('Inventory'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push('/inventory'),
                ),
              ],
            ),
          ),
          gapMd,
          const BfNotice(
            text: 'Store settings, product photos and new products are managed in the seller console on the web.',
          ),
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
        ],
      ),
    );
  }
}
