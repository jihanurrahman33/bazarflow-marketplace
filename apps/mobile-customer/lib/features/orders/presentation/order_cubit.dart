import 'dart:async';

import 'package:app_core/app_core.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';

import '../../checkout/domain/checkout_models.dart';
import '../data/orders_repository.dart';
import '../domain/order_models.dart';

sealed class OrderState extends Equatable {
  const OrderState();
  @override
  List<Object?> get props => [];
}

class OrderLoading extends OrderState {
  const OrderLoading();
}

class OrderFailure extends OrderState {
  const OrderFailure(this.error);
  final ApiException error;
  @override
  List<Object?> get props => [error];
}

class OrderLoaded extends OrderState {
  const OrderLoaded(this.order, {this.payment, this.polling = false, this.pollsLeft = 0, this.acting = false, this.actionError, this.refreshError});
  final OrderDetail order;
  final PaymentView? payment;

  /// Asking the provider (via our server) whether the payment went through.
  final bool polling;
  final int pollsLeft;
  final bool acting;
  final ApiException? actionError;
  final ApiException? refreshError;

  /// Payment is still resolving and we must not suggest paying again.
  bool get verifying => order.awaitingPayment && (payment?.inFlight ?? false);
  bool get canPayAgain => order.awaitingPayment && (payment?.canRetry ?? false);
  bool get hasOpenPaymentPage => order.awaitingPayment && payment?.status == 'requires_action' && payment?.redirectUrl != null;

  OrderLoaded copyWith({OrderDetail? order, PaymentView? payment, bool clearPayment = false, bool? polling, int? pollsLeft, bool? acting, ApiException? actionError, bool clearAction = false, ApiException? refreshError, bool clearRefresh = false}) => OrderLoaded(
        order ?? this.order,
        payment: clearPayment ? null : (payment ?? this.payment),
        polling: polling ?? this.polling,
        pollsLeft: pollsLeft ?? this.pollsLeft,
        acting: acting ?? this.acting,
        actionError: clearAction ? null : (actionError ?? this.actionError),
        refreshError: clearRefresh ? null : (refreshError ?? this.refreshError),
      );

  @override
  List<Object?> get props => [order, payment, polling, pollsLeft, acting, actionError, refreshError];
}

class OrderCubit extends Cubit<OrderState> {
  OrderCubit(this._repo, this.orderId, {this.pollInterval = const Duration(seconds: 5), this.maxPolls = 12, this.cameFromPayment = false}) : super(const OrderLoading());
  final OrdersRepository _repo;
  final String orderId;
  final Duration pollInterval;
  final int maxPolls;

  /// The browser just returned from the provider's page: expect a status change shortly.
  final bool cameFromPayment;
  int _pollGeneration = 0;
  Timer? _pollTimer;

  /// Waits [pollInterval] on a timer that [close] can cancel (a Future.delayed would outlive the screen).
  Future<void> _tick() {
    final done = Completer<void>();
    _pollTimer = Timer(pollInterval, done.complete);
    return done.future;
  }

  Future<void> load() async {
    final prev = state;
    if (prev is! OrderLoaded) emit(const OrderLoading());
    try {
      final order = await _repo.get(orderId);
      final payment = order.paymentMethod == 'online' ? await _repo.payment(orderId) : null;
      if (isClosed) return;
      emit(OrderLoaded(order, payment: payment));
      final s = state as OrderLoaded;
      if (s.verifying || (cameFromPayment && order.awaitingPayment && payment?.status != 'failed' && payment?.status != 'cancelled')) {
        unawaited(startPolling());
      }
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(prev is OrderLoaded ? prev.copyWith(refreshError: e) : OrderFailure(e));
    }
  }

  /// Ask the provider (server-side) a bounded number of times, then hand control back to the user ("Check status").
  Future<void> startPolling() async {
    final gen = ++_pollGeneration;
    var left = maxPolls;
    while (left > 0 && !isClosed && gen == _pollGeneration) {
      final s = state;
      if (s is! OrderLoaded || !s.order.awaitingPayment) break;
      emit(s.copyWith(polling: true, pollsLeft: left));
      await _tick();
      if (isClosed || gen != _pollGeneration) return;
      try {
        final payment = await _repo.refreshPayment(orderId);
        final order = await _repo.get(orderId);
        if (isClosed || gen != _pollGeneration) return;
        emit(OrderLoaded(order, payment: payment, polling: left > 1 && order.awaitingPayment && (payment?.inFlight ?? false), pollsLeft: left - 1));
        if (!order.awaitingPayment || !(payment?.inFlight ?? false)) break;
      } on ApiException catch (e) {
        if (isClosed || gen != _pollGeneration) return;
        // Keep going on transient failures; the next tick tries again.
        emit((state as OrderLoaded).copyWith(refreshError: e));
        if (!e.retryable) break;
      }
      left--;
    }
    final end = state;
    if (!isClosed && gen == _pollGeneration && end is OrderLoaded) emit(end.copyWith(polling: false, pollsLeft: 0));
  }

  Future<void> checkNow() async {
    _pollGeneration++; // cancel any running loop
    final s = state;
    if (s is! OrderLoaded || s.acting) return;
    emit(s.copyWith(acting: true, clearAction: true));
    try {
      final payment = await _repo.refreshPayment(orderId);
      final order = await _repo.get(orderId);
      emit(OrderLoaded(order, payment: payment));
    } on ApiException catch (e) {
      emit(s.copyWith(acting: false, actionError: e));
    }
  }

  /// Returns the hosted-payment URL to open, or null on failure (error is in the state).
  Future<String?> payAgain() async {
    final s = state;
    if (s is! OrderLoaded || s.acting) return null;
    emit(s.copyWith(acting: true, clearAction: true));
    try {
      final payment = await _repo.startPayment(orderId);
      emit((state as OrderLoaded).copyWith(payment: payment, acting: false));
      return payment.redirectUrl;
    } on ApiException catch (e) {
      emit((state as OrderLoaded).copyWith(acting: false, actionError: e));
      return null;
    }
  }

  Future<void> cancel() => _act(() async {
        final order = await _repo.cancel(orderId);
        final payment = order.paymentMethod == 'online' ? await _repo.payment(orderId) : null;
        return OrderLoaded(order, payment: payment);
      });

  Future<void> requestReturn(String vendorOrderId, String reason) => _act(() async {
        await _repo.requestReturn(vendorOrderId, reason);
        final order = await _repo.get(orderId);
        return OrderLoaded(order, payment: (state as OrderLoaded).payment);
      });

  Future<void> review(String productSlug, int rating, String body) => _act(() async {
        await _repo.review(productSlug: productSlug, rating: rating, body: body);
        return (state as OrderLoaded).copyWith(acting: false);
      });

  Future<void> _act(Future<OrderLoaded> Function() op) async {
    final s = state;
    if (s is! OrderLoaded || s.acting) return;
    _pollGeneration++;
    emit(s.copyWith(acting: true, clearAction: true));
    try {
      emit(await op());
    } on ApiException catch (e) {
      emit(s.copyWith(acting: false, actionError: e));
    }
  }

  @override
  Future<void> close() {
    _pollGeneration++;
    _pollTimer?.cancel();
    return super.close();
  }
}
