import 'package:app_core/app_core.dart';
import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/orders_repository.dart';
import '../domain/orders_models.dart';

sealed class OrderDetailState extends Equatable {
  const OrderDetailState();
  @override
  List<Object?> get props => [];
}

class OrderDetailLoading extends OrderDetailState {
  const OrderDetailLoading();
}

class OrderDetailFailure extends OrderDetailState {
  const OrderDetailFailure(this.error);
  final ApiException error;
  @override
  List<Object?> get props => [error];
}

class OrderDetailLoaded extends OrderDetailState {
  const OrderDetailLoaded(
    this.order, {
    this.acting = false,
    this.actionError,
    this.notice,
  });
  final VendorOrder order;

  /// An action is in flight: every action button is disabled so a double tap cannot send it twice.
  final bool acting;
  final ApiException? actionError;
  final String? notice;
  @override
  List<Object?> get props => [order, acting, actionError, notice];
}

class OrderDetailCubit extends Cubit<OrderDetailState> {
  OrderDetailCubit(this._repo, this.id) : super(const OrderDetailLoading());
  final OrdersRepository _repo;
  final String id;

  Future<void> load() async {
    final prev = state;
    if (prev is! OrderDetailLoaded) emit(const OrderDetailLoading());
    try {
      emit(OrderDetailLoaded(await _repo.get(id)));
    } on ApiException catch (e) {
      emit(
        prev is OrderDetailLoaded
            ? OrderDetailLoaded(prev.order, actionError: e)
            : OrderDetailFailure(e),
      );
    }
  }

  Future<void> _act(Future<VendorOrder> Function() op, String done) async {
    final s = state;
    if (s is! OrderDetailLoaded || s.acting) return;
    emit(OrderDetailLoaded(s.order, acting: true));
    try {
      emit(OrderDetailLoaded(await op(), notice: done));
    } on ApiException catch (e) {
      // The server is the authority: a conflict usually means someone else (or another device) changed the order.
      emit(OrderDetailLoaded(s.order, actionError: e));
      if (e.isConflict) await load();
    }
  }

  Future<void> accept() => _act(() => _repo.accept(id), 'Order accepted');
  Future<void> ship(String carrier, String tracking) => _act(
    () => _repo.ship(id, carrier: carrier, trackingNumber: tracking),
    'Marked as shipped',
  );
  Future<void> deliver() =>
      _act(() => _repo.deliver(id), 'Marked as delivered');
  Future<void> cancel(String reason) =>
      _act(() => _repo.cancel(id, reason), 'Order cancelled');
  Future<void> approveReturn() =>
      _act(() => _repo.approveReturn(id), 'Return accepted');
  Future<void> rejectReturn(String reason) =>
      _act(() => _repo.rejectReturn(id, reason), 'Return declined');
}
