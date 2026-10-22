import 'package:app_core/app_core.dart';
import 'package:equatable/equatable.dart';

class AppNotification extends Equatable {
  const AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.read,
    required this.createdAt,
    this.deepLink,
  });
  final String id;
  final String title;
  final String body;
  final bool read;
  final DateTime createdAt;
  final String? deepLink;
  AppNotification asRead() => AppNotification(
    id: id,
    title: title,
    body: body,
    read: true,
    createdAt: createdAt,
    deepLink: deepLink,
  );
  @override
  List<Object?> get props => [id, title, body, read, createdAt, deepLink];
}

abstract interface class NotificationsRepository {
  Future<PageResult<AppNotification>> list({String? cursor});
  Future<void> markRead(String id);
}

class ApiNotificationsRepository implements NotificationsRepository {
  ApiNotificationsRepository(this._client);
  final ApiClient _client;

  @override
  Future<PageResult<AppNotification>> list({String? cursor}) async {
    final res = await _client.get(
      '/notifications',
      query: {'limit': 20, 'cursor': ?cursor},
    );
    return PageResult(
      nextCursor: res.nextCursor,
      items: [
        for (final n in res.list.cast<Map<String, dynamic>>())
          AppNotification(
            id: n['id'] as String,
            title: n['title'] as String,
            body: n['body'] as String,
            read: n['read'] == true,
            createdAt: DateTime.parse(n['createdAt'] as String),
            deepLink: n['deepLink'] as String?,
          ),
      ],
    );
  }

  @override
  Future<void> markRead(String id) async {
    await _client.patch('/notifications/$id/read');
  }
}
