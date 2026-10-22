import 'package:app_core/app_core.dart';
import 'package:equatable/equatable.dart';

import '../../checkout/data/checkout_repository.dart';
import '../../checkout/domain/checkout_models.dart';

class DeviceSession extends Equatable {
  const DeviceSession({required this.id, required this.name, required this.current, required this.lastUsedAt});
  final String id;
  final String name;
  final bool current;
  final DateTime lastUsedAt;
  @override
  List<Object?> get props => [id, name, current, lastUsedAt];
}

abstract interface class AccountRepository {
  Future<SessionUser> updateName(String name);
  Future<void> changePassword(String current, String next);
  Future<void> verifyEmail(String code);
  Future<void> resendVerification();
  Future<List<DeviceSession>> sessions();
  Future<void> revokeSession(String id);
  Future<List<Address>> addresses();
  Future<Address> addAddress(AddressInput input);
  Future<void> deleteAddress(String id);
}

class ApiAccountRepository implements AccountRepository {
  ApiAccountRepository(this._client);
  final ApiClient _client;

  @override
  Future<SessionUser> updateName(String name) async => SessionUser.fromJson((await _client.patch('/me', body: {'name': name})).map);
  @override
  Future<void> changePassword(String current, String next) async {
    await _client.post('/me/password', body: {'currentPassword': current, 'newPassword': next});
  }

  @override
  Future<void> verifyEmail(String code) async {
    await _client.post('/auth/verify-contact', body: {'code': code});
  }

  @override
  Future<void> resendVerification() async {
    await _client.post('/auth/resend-verification');
  }

  @override
  Future<List<DeviceSession>> sessions() async => [
        for (final s in (await _client.get('/me/sessions')).list.cast<Map<String, dynamic>>())
          DeviceSession(
            id: s['id'] as String,
            current: s['current'] == true,
            lastUsedAt: DateTime.parse(s['lastUsedAt'] as String),
            name: ((s['device'] as Map<String, dynamic>)['name'] as String?) ?? (s['device'] as Map<String, dynamic>)['platform'] as String,
          ),
      ];
  @override
  Future<void> revokeSession(String id) async {
    await _client.delete('/me/sessions/$id');
  }

  @override
  Future<List<Address>> addresses() async => [for (final a in (await _client.get('/addresses')).list) parseAddress(a as Map<String, dynamic>)];
  @override
  Future<Address> addAddress(AddressInput input) async => parseAddress((await _client.post('/addresses', body: input.toJson())).map);
  @override
  Future<void> deleteAddress(String id) async {
    await _client.delete('/addresses/$id');
  }
}
