import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../app/deps.dart';
import '../../account/data/account_repository.dart';
import 'auth_cubits.dart';

String? _required(String? v) => (v == null || v.trim().isEmpty) ? 'Required' : null;
String? _validEmail(String? v) => (v == null || !emailPattern.hasMatch(v.trim())) ? 'Enter a valid email address' : null;
String? _newPassword(String? v) => (v == null || v.length < 10) ? 'Use at least 10 characters' : null;

/// Server-side field problems (e.g. EMAIL_TAKEN is a conflict, TOO_SMALL a field issue) mapped to short copy.
String? serverFieldMessage(AuthFormState state, String field) {
  if (state is! AuthFormFailed) return null;
  final code = state.error.fieldError(field);
  if (code == null) return null;
  return switch (code) { 'TOO_SMALL' => 'Too short', 'TOO_BIG' => 'Too long', 'INVALID_FORMAT' || 'INVALID_STRING' => 'Invalid format', _ => 'Invalid value' };
}

class LoginPage extends StatelessWidget {
  const LoginPage({super.key, this.next});
  final String? next;

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (c) => LoginCubit(c.read<AppDependencies>().session),
        child: _LoginView(next: next),
      );
}

class _LoginView extends StatefulWidget {
  const _LoginView({this.next});
  final String? next;
  @override
  State<_LoginView> createState() => _LoginViewState();
}

class _LoginViewState extends State<_LoginView> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _submit() {
    if (_form.currentState?.validate() ?? false) context.read<LoginCubit>().submit(_email.text, _password.text);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign in')),
      body: SafeArea(
        child: ListView(padding: pagePadding, children: [
          Form(
            key: _form,
            child: BlocBuilder<LoginCubit, AuthFormState>(
              builder: (context, state) {
                final busy = state is AuthFormSubmitting;
                return AutofillGroup(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text('Welcome back', style: Theme.of(context).textTheme.headlineMedium),
                    gapLg,
                    if (state is AuthFormFailed) ...[BfInlineError(state.error), gapMd],
                    TextFormField(controller: _email, enabled: !busy, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.email], textInputAction: TextInputAction.next, decoration: const InputDecoration(labelText: 'Email'), validator: _validEmail),
                    gapMd,
                    TextFormField(
                      controller: _password,
                      enabled: !busy,
                      obscureText: _obscure,
                      autofillHints: const [AutofillHints.password],
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _submit(),
                      decoration: InputDecoration(labelText: 'Password', suffixIcon: IconButton(tooltip: _obscure ? 'Show password' : 'Hide password', icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off), onPressed: () => setState(() => _obscure = !_obscure))),
                      validator: _required,
                    ),
                    gapLg,
                    BfButton(label: 'Sign in', loading: busy, onPressed: _submit, expand: true),
                    gapSm,
                    BfButton(label: 'Create an account', variant: BfButtonVariant.text, onPressed: busy ? null : () => context.go('/register${widget.next != null ? '?next=${Uri.encodeComponent(widget.next!)}' : ''}')),
                    BfButton(label: 'Continue browsing', variant: BfButtonVariant.text, onPressed: busy ? null : () => context.go('/')),
                  ]),
                );
              },
            ),
          ),
        ]),
      ),
    );
  }

}

class RegisterPage extends StatelessWidget {
  const RegisterPage({super.key, this.next});
  final String? next;
  @override
  Widget build(BuildContext context) => BlocProvider(create: (c) => RegisterCubit(c.read<AppDependencies>().session), child: _RegisterView(next: next));
}

class _RegisterView extends StatefulWidget {
  const _RegisterView({this.next});
  final String? next;
  @override
  State<_RegisterView> createState() => _RegisterViewState();
}

class _RegisterViewState extends State<_RegisterView> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();

  @override
  void dispose() {
    for (final c in [_name, _email, _phone, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  void _submit() {
    if (_form.currentState?.validate() ?? false) context.read<RegisterCubit>().submit(name: _name.text, email: _email.text, password: _password.text, phone: _phone.text);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create account')),
      body: SafeArea(
        child: ListView(padding: pagePadding, children: [
          Form(
            key: _form,
            child: BlocConsumer<RegisterCubit, AuthFormState>(
              listener: (context, state) {
                // Signed in already (the session drives navigation); send them to verify their email first.
                if (state is AuthFormDone) context.go('/verify-email');
              },
              builder: (context, state) {
                final busy = state is AuthFormSubmitting;
                return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  if (state is AuthFormFailed) ...[BfInlineError(state.error), gapMd],
                  TextFormField(controller: _name, enabled: !busy, textCapitalization: TextCapitalization.words, textInputAction: TextInputAction.next, decoration: InputDecoration(labelText: 'Full name', errorText: serverFieldMessage(state, 'name')), validator: _required),
                  gapMd,
                  TextFormField(controller: _email, enabled: !busy, keyboardType: TextInputType.emailAddress, textInputAction: TextInputAction.next, decoration: InputDecoration(labelText: 'Email', errorText: serverFieldMessage(state, 'email')), validator: _validEmail),
                  gapMd,
                  TextFormField(controller: _phone, enabled: !busy, keyboardType: TextInputType.phone, textInputAction: TextInputAction.next, decoration: InputDecoration(labelText: 'Mobile number (optional)', hintText: '+8801…', errorText: serverFieldMessage(state, 'phone'))),
                  gapMd,
                  TextFormField(controller: _password, enabled: !busy, obscureText: true, textInputAction: TextInputAction.done, onFieldSubmitted: (_) => _submit(), decoration: InputDecoration(labelText: 'Password', helperText: 'At least 10 characters', errorText: serverFieldMessage(state, 'password')), validator: _newPassword),
                  gapLg,
                  BfButton(label: 'Create account', loading: busy, onPressed: _submit, expand: true),
                  BfButton(label: 'I already have an account', variant: BfButtonVariant.text, onPressed: busy ? null : () => context.go('/login')),
                ]);
              },
            ),
          ),
        ]),
      ),
    );
  }
}

class VerifyEmailPage extends StatefulWidget {
  const VerifyEmailPage({super.key});
  @override
  State<VerifyEmailPage> createState() => _VerifyEmailPageState();
}

class _VerifyEmailPageState extends State<VerifyEmailPage> {
  final _code = TextEditingController();
  bool _busy = false;
  bool _resent = false;
  ApiException? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function(AccountRepository repo) op) async {
    final deps = context.read<AppDependencies>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await op(deps.account);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    final email = deps.session.user?.email ?? 'your email';
    return Scaffold(
      appBar: AppBar(title: const Text('Verify your email'), actions: [TextButton(onPressed: () => context.go('/'), child: const Text('Skip'))]),
      body: SafeArea(
        child: ListView(padding: pagePadding, children: [
          Text('We sent a 6-digit code to $email. It expires in 15 minutes.'),
          gapLg,
          if (_error != null) ...[BfInlineError(_error!), gapMd],
          if (_resent) ...[const BfNotice(text: 'A new code is on its way.', tone: StatusTone.success), gapMd],
          TextField(controller: _code, keyboardType: TextInputType.number, maxLength: 6, autofillHints: const [AutofillHints.oneTimeCode], decoration: const InputDecoration(labelText: 'Verification code'), onChanged: (_) => setState(() {})),
          gapMd,
          BfButton(
            label: 'Verify',
            loading: _busy,
            expand: true,
            onPressed: _code.text.length == 6
                ? () => _run((repo) async {
                      await repo.verifyEmail(_code.text);
                      await deps.session.reloadProfile();
                      if (context.mounted) context.go('/');
                    })
                : null,
          ),
          BfButton(
            label: 'Resend code',
            variant: BfButtonVariant.text,
            onPressed: _busy
                ? null
                : () => _run((repo) async {
                      await repo.resendVerification();
                      if (mounted) setState(() => _resent = true);
                    }),
          ),
        ]),
      ),
    );
  }
}
