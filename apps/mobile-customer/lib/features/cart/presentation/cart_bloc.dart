import 'package:app_core/app_core.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';

import '../data/cart_repository.dart';
import '../domain/cart_models.dart';

/// Number shown on the cart tab badge. Updated by the cart screen and by "add to cart".
class CartBadgeCubit extends Cubit<int> {
  CartBadgeCubit() : super(0);
  void set(int count) => emit(count);
}

sealed class CartEvent extends Equatable {
  const CartEvent();
  @override
  List<Object?> get props => [];
}

class CartStarted extends CartEvent {
  const CartStarted();
}

class CartQuantityChanged extends CartEvent {
  const CartQuantityChanged(this.itemId, this.quantity);
  final String itemId;
  final int quantity;
  @override
  List<Object?> get props => [itemId, quantity];
}

class CartItemRemoved extends CartEvent {
  const CartItemRemoved(this.itemId);
  final String itemId;
  @override
  List<Object?> get props => [itemId];
}

sealed class CartState extends Equatable {
  const CartState();
  @override
  List<Object?> get props => [];
}

class CartLoading extends CartState {
  const CartLoading();
}

class CartFailure extends CartState {
  const CartFailure(this.error);
  final ApiException error;
  @override
  List<Object?> get props => [error];
}

class CartLoaded extends CartState {
  const CartLoaded(this.quote, {this.busyItemId, this.actionError});
  final Quote quote;

  /// The line being changed right now; its controls are disabled (double-tap protection).
  final String? busyItemId;
  final ApiException? actionError;
  @override
  List<Object?> get props => [quote, busyItemId, actionError];
}

class CartBloc extends Bloc<CartEvent, CartState> {
  CartBloc(this._repo, this._badge) : super(const CartLoading()) {
    on<CartStarted>(_onStarted);
    on<CartQuantityChanged>(_onQuantity);
    on<CartItemRemoved>(_onRemoved);
  }
  final CartRepository _repo;
  final CartBadgeCubit _badge;

  Future<void> _onStarted(CartStarted e, Emitter<CartState> emit) async {
    final current = state;
    if (current is! CartLoaded) emit(const CartLoading());
    try {
      final q = await _repo.get();
      _badge.set(q.itemCount);
      emit(CartLoaded(q));
    } on ApiException catch (err) {
      emit(current is CartLoaded ? CartLoaded(current.quote, actionError: err) : CartFailure(err));
    }
  }

  Future<void> _mutate(String itemId, Future<Quote> Function() call, Emitter<CartState> emit) async {
    final s = state;
    if (s is! CartLoaded || s.busyItemId != null) return; // one change at a time: a rapid second tap is ignored
    emit(CartLoaded(s.quote, busyItemId: itemId));
    try {
      final q = await call();
      _badge.set(q.itemCount);
      emit(CartLoaded(q));
    } on ApiException catch (err) {
      emit(CartLoaded(s.quote, actionError: err));
    }
  }

  Future<void> _onQuantity(CartQuantityChanged e, Emitter<CartState> emit) => _mutate(e.itemId, () => _repo.setQuantity(e.itemId, e.quantity), emit);
  Future<void> _onRemoved(CartItemRemoved e, Emitter<CartState> emit) => _mutate(e.itemId, () => _repo.remove(e.itemId), emit);
}
