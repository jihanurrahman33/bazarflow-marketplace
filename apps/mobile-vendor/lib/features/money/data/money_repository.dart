import 'package:app_core/app_core.dart';
import 'package:equatable/equatable.dart';

class Balance extends Equatable {
  const Balance({
    required this.availableMinor,
    required this.pendingMinor,
    required this.lifetimeSalesMinor,
  });
  final int availableMinor;
  final int pendingMinor;
  final int lifetimeSalesMinor;
  @override
  List<Object?> get props => [availableMinor, pendingMinor, lifetimeSalesMinor];
}

class LedgerEntry extends Equatable {
  const LedgerEntry({
    required this.id,
    required this.type,
    required this.amountMinor,
    required this.createdAt,
    this.availableAt,
  });
  final String id;
  final String type;
  final int amountMinor;
  final DateTime createdAt;
  final DateTime? availableAt;
  @override
  List<Object?> get props => [id, type, amountMinor, createdAt, availableAt];
}

class Payout extends Equatable {
  const Payout({
    required this.id,
    required this.amountMinor,
    required this.status,
    required this.createdAt,
  });
  final String id;
  final int amountMinor;
  final String status;
  final DateTime createdAt;
  @override
  List<Object?> get props => [id, amountMinor, status, createdAt];
}

abstract interface class MoneyRepository {
  Future<Balance> balance();
  Future<PageResult<LedgerEntry>> ledger({String? cursor});
  Future<PageResult<Payout>> payouts({String? cursor});
  Future<void> requestPayout(int amountMinor);
  Future<void> cancelPayout(String id);
}

class ApiMoneyRepository implements MoneyRepository {
  ApiMoneyRepository(this._client);
  final ApiClient _client;

  @override
  Future<Balance> balance() async {
    final j = (await _client.get('/vendor/balance')).map;
    return Balance(
      availableMinor: j['availableMinor'] as int,
      pendingMinor: j['pendingMinor'] as int,
      lifetimeSalesMinor: j['lifetimeSalesMinor'] as int,
    );
  }

  @override
  Future<PageResult<LedgerEntry>> ledger({String? cursor}) async {
    final res = await _client.get(
      '/vendor/ledger',
      query: {'limit': 25, 'cursor': ?cursor},
    );
    return PageResult(
      nextCursor: res.nextCursor,
      items: [
        for (final e in res.list.cast<Map<String, dynamic>>())
          LedgerEntry(
            id: e['id'] as String,
            type: e['type'] as String,
            amountMinor: e['amountMinor'] as int,
            createdAt: DateTime.parse(e['createdAt'] as String),
            availableAt: e['availableAt'] == null
                ? null
                : DateTime.parse(e['availableAt'] as String),
          ),
      ],
    );
  }

  @override
  Future<PageResult<Payout>> payouts({String? cursor}) async {
    final res = await _client.get(
      '/vendor/payouts',
      query: {'limit': 20, 'cursor': ?cursor},
    );
    return PageResult(
      nextCursor: res.nextCursor,
      items: [
        for (final p in res.list.cast<Map<String, dynamic>>())
          Payout(
            id: p['id'] as String,
            amountMinor: p['amountMinor'] as int,
            status: p['status'] as String,
            createdAt: DateTime.parse(p['createdAt'] as String),
          ),
      ],
    );
  }

  @override
  Future<void> requestPayout(int amountMinor) async {
    await _client.post('/vendor/payouts', body: {'amountMinor': amountMinor});
  }

  @override
  Future<void> cancelPayout(String id) async {
    await _client.post('/vendor/payouts/$id/cancel');
  }
}
