import 'package:app_core/app_core.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';

import '../../cart/domain/cart_models.dart';
import '../data/checkout_repository.dart';
import '../domain/checkout_models.dart';

sealed class CheckoutEvent extends Equatable {
  const CheckoutEvent();
  @override
  List<Object?> get props => [];
}

class CheckoutStarted extends CheckoutEvent {
  const CheckoutStarted();
}

class CheckoutAddressSelected extends CheckoutEvent {
  const CheckoutAddressSelected(this.addressId);
  final String addressId;
  @override
  List<Object?> get props => [addressId];
}

class CheckoutMethodSelected extends CheckoutEvent {
  const CheckoutMethodSelected(this.method);
  final PaymentMethod method;
  @override
  List<Object?> get props => [method];
}

class CheckoutAddressAdded extends CheckoutEvent {
  const CheckoutAddressAdded(this.input);
  final AddressInput input;
  @override
  List<Object?> get props => [input];
}

class CheckoutPlaceOrderPressed extends CheckoutEvent {
  const CheckoutPlaceOrderPressed();
}

enum CheckoutPhase { loading, ready, placing, placed, failure }

class CheckoutState extends Equatable {
  const CheckoutState({
    this.phase = CheckoutPhase.loading,
    this.addresses = const [],
    this.selectedAddressId,
    this.quote,
    this.method = PaymentMethod.online,
    this.quoting = false,
    this.error,
    this.stale = false,
    this.placed,
  });
  final CheckoutPhase phase;
  final List<Address> addresses;
  final String? selectedAddressId;
  final Quote? quote;
  final PaymentMethod method;
  final bool quoting;

  /// Last failed action (place order / quote / save address). Inline, not a dead end.
  final ApiException? error;

  /// Prices or stock changed under the shopper: the summary was refreshed and they must look again.
  final bool stale;
  final PlacedOrder? placed;

  bool get canPlace => phase == CheckoutPhase.ready && !quoting && selectedAddressId != null && quote != null && !quote!.isEmpty && !quote!.hasIssues;

  CheckoutState copyWith({
    CheckoutPhase? phase,
    List<Address>? addresses,
    String? selectedAddressId,
    Quote? quote,
    PaymentMethod? method,
    bool? quoting,
    ApiException? error,
    bool clearError = false,
    bool? stale,
    PlacedOrder? placed,
  }) =>
      CheckoutState(
        phase: phase ?? this.phase,
        addresses: addresses ?? this.addresses,
        selectedAddressId: selectedAddressId ?? this.selectedAddressId,
        quote: quote ?? this.quote,
        method: method ?? this.method,
        quoting: quoting ?? this.quoting,
        error: clearError ? null : (error ?? this.error),
        stale: stale ?? this.stale,
        placed: placed ?? this.placed,
      );

  @override
  List<Object?> get props => [phase, addresses, selectedAddressId, quote, method, quoting, error, stale, placed];
}

class CheckoutBloc extends Bloc<CheckoutEvent, CheckoutState> {
  CheckoutBloc(this._repo, {String Function()? keyFactory})
      : _newKey = keyFactory ?? newIdempotencyKey,
        super(const CheckoutState()) {
    on<CheckoutStarted>(_onStarted);
    on<CheckoutAddressSelected>(_onAddress);
    on<CheckoutMethodSelected>((e, emit) => emit(state.copyWith(method: e.method, clearError: true)));
    on<CheckoutAddressAdded>(_onAddressAdded);
    on<CheckoutPlaceOrderPressed>(_onPlace);
  }

  final CheckoutRepository _repo;
  final String Function() _newKey;

  /// One key per LOGICAL submission (same address + method + total). A retry after a timeout reuses it, so the server
  /// returns the original order instead of creating a second one. Any change to the inputs mints a new key.
  ({String signature, String key})? _attempt;

  Future<void> _onStarted(CheckoutStarted e, Emitter<CheckoutState> emit) async {
    emit(const CheckoutState());
    try {
      final addresses = await _repo.addresses();
      final selected = addresses.isEmpty ? null : (addresses.firstWhere((a) => a.isDefault, orElse: () => addresses.first)).id;
      emit(state.copyWith(phase: CheckoutPhase.ready, addresses: addresses, selectedAddressId: selected));
      if (selected != null) await _loadQuote(selected, emit);
    } on ApiException catch (err) {
      emit(state.copyWith(phase: CheckoutPhase.failure, error: err));
    }
  }

  Future<void> _loadQuote(String addressId, Emitter<CheckoutState> emit, {bool stale = false}) async {
    emit(state.copyWith(quoting: true, clearError: true));
    try {
      final q = await _repo.quote(addressId);
      final method = q.paymentMethods.isEmpty || q.paymentMethods.contains(state.method.name) ? state.method : PaymentMethod.online;
      emit(state.copyWith(quote: q, quoting: false, method: method, stale: stale));
    } on ApiException catch (err) {
      emit(state.copyWith(quoting: false, error: err));
    }
  }

  Future<void> _onAddress(CheckoutAddressSelected e, Emitter<CheckoutState> emit) async {
    emit(state.copyWith(selectedAddressId: e.addressId, stale: false));
    await _loadQuote(e.addressId, emit);
  }

  Future<void> _onAddressAdded(CheckoutAddressAdded e, Emitter<CheckoutState> emit) async {
    try {
      final created = await _repo.createAddress(e.input);
      emit(state.copyWith(addresses: [created, ...state.addresses], selectedAddressId: created.id, clearError: true));
      await _loadQuote(created.id, emit);
    } on ApiException catch (err) {
      emit(state.copyWith(error: err));
    }
  }

  Future<void> _onPlace(CheckoutPlaceOrderPressed e, Emitter<CheckoutState> emit) async {
    if (!state.canPlace) return;
    final addressId = state.selectedAddressId!;
    final quote = state.quote!;
    final signature = '$addressId|${state.method.name}|${quote.totalMinor}';
    if (_attempt?.signature != signature) _attempt = (signature: signature, key: _newKey());
    emit(state.copyWith(phase: CheckoutPhase.placing, clearError: true, stale: false));
    try {
      final order = await _repo.placeOrder(addressId: addressId, method: state.method, expectedTotalMinor: quote.totalMinor, idempotencyKey: _attempt!.key);
      _attempt = null;
      emit(state.copyWith(phase: CheckoutPhase.placed, placed: order));
    } on ApiException catch (err) {
      const changed = {'PRICE_CHANGED', 'INVENTORY_UNAVAILABLE', 'PRODUCT_UNAVAILABLE'};
      if (changed.contains(err.code)) {
        _attempt = null; // nothing was created; the next attempt is a different submission
        emit(state.copyWith(phase: CheckoutPhase.ready, error: err));
        await _loadQuote(addressId, emit, stale: true);
      } else {
        // Network/timeout/5xx: the order MAY exist. Keep the key so pressing the button again is safe.
        emit(state.copyWith(phase: CheckoutPhase.ready, error: err));
      }
    }
  }
}
