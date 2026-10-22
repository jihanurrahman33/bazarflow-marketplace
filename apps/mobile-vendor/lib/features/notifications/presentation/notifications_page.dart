import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../app/deps.dart';
import '../data/notifications_repository.dart';

class NotificationsPage extends StatelessWidget {
  const NotificationsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    return BlocProvider(
      create: (_) =>
          PagedCubit<AppNotification>((c) => deps.notifications.list(cursor: c))
            ..load(),
      child: Scaffold(
        appBar: AppBar(title: const Text('Notifications')),
        body: BfPagedView<AppNotification>(
          emptyTitle: 'No notifications yet',
          emptyIcon: Icons.notifications_none,
          itemBuilder: (context, n) => Card(
            child: ListTile(
              leading: Icon(
                n.read ? Icons.notifications_none : Icons.notifications_active,
              ),
              title: Text(
                n.title,
                style: TextStyle(
                  fontWeight: n.read ? FontWeight.w400 : FontWeight.w700,
                ),
              ),
              subtitle: Text(n.body),
              onTap: () async {
                final cubit = context.read<PagedCubit<AppNotification>>();
                final route = appRouteFor(n.deepLink);
                if (!n.read) {
                  try {
                    await deps.notifications.markRead(n.id);
                    cubit.patchItems(
                      (items) => [
                        for (final i in items) i.id == n.id ? i.asRead() : i,
                      ],
                    );
                  } on ApiException {
                    /* best effort */
                  }
                }
                if (route != null && context.mounted) context.push(route);
              },
            ),
          ),
        ),
      ),
    );
  }
}
