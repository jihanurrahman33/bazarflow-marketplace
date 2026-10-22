import 'package:app_core/app_core.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';

sealed class AuthFormState extends Equatable {
  const AuthFormState();
  @override
  List<Object?> get props => [];
}

class AuthFormIdle extends AuthFormState {
  const AuthFormIdle();
}

class AuthFormSubmitting extends AuthFormState {
  const AuthFormSubmitting();
}

class AuthFormFailed extends AuthFormState {
  const AuthFormFailed(this.error);
  final ApiException error;
  @override
  List<Object?> get props => [error];
}

/// Success is signalled by the session itself (SignedIn), which drives navigation.
class AuthFormDone extends AuthFormState {
  const AuthFormDone();
}

final emailPattern = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

class LoginCubit extends Cubit<AuthFormState> {
  LoginCubit(this._session) : super(const AuthFormIdle());
  final SessionManager _session;

  Future<void> submit(String email, String password) async {
    if (state is AuthFormSubmitting) return;
    emit(const AuthFormSubmitting());
    try {
      await _session.login(email.trim(), password);
      emit(const AuthFormDone());
    } on ApiException catch (e) {
      emit(AuthFormFailed(e));
    }
  }
}

class RegisterCubit extends Cubit<AuthFormState> {
  RegisterCubit(this._session) : super(const AuthFormIdle());
  final SessionManager _session;

  Future<void> submit({required String name, required String email, required String password, String? phone}) async {
    if (state is AuthFormSubmitting) return;
    emit(const AuthFormSubmitting());
    try {
      await _session.register(name: name.trim(), email: email.trim(), password: password, phone: phone?.trim());
      emit(const AuthFormDone());
    } on ApiException catch (e) {
      emit(AuthFormFailed(e));
    }
  }
}
