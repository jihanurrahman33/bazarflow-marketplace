import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../app/deps.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  ApiException? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false) || _busy) return;
    final deps = context.read<AppDependencies>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await deps.session.login(_email.text.trim(), _password.text);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Staff sign in')),
        body: SafeArea(
          child: ListView(padding: pagePadding, children: [
            Form(
              key: _form,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('BazarFlow operations', style: Theme.of(context).textTheme.headlineMedium),
                const SizedBox(height: 4),
                const Text('For platform staff only.'),
                gapLg,
                if (_error != null) ...[BfInlineError(_error!), gapMd],
                TextFormField(controller: _email, enabled: !_busy, keyboardType: TextInputType.emailAddress, textInputAction: TextInputAction.next, decoration: const InputDecoration(labelText: 'Work email'), validator: (v) => (v == null || !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(v.trim())) ? 'Enter a valid email address' : null),
                gapMd,
                TextFormField(controller: _password, enabled: !_busy, obscureText: true, onFieldSubmitted: (_) => _submit(), decoration: const InputDecoration(labelText: 'Password'), validator: (v) => (v == null || v.isEmpty) ? 'Required' : null),
                gapLg,
                BfButton(label: 'Sign in', loading: _busy, onPressed: _submit, expand: true),
              ]),
            ),
          ]),
        ),
      );
}

class AccountPage extends StatelessWidget {
  const AccountPage({super.key});

  @override
  Widget build(BuildContext context) {
    final deps = context.read<AppDependencies>();
    final user = deps.session.user;
    if (user == null) return const SizedBox.shrink();
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: ListView(padding: pagePadding, children: [
        Card(child: ListTile(leading: const CircleAvatar(child: Icon(Icons.admin_panel_settings_outlined)), title: Text(user.name), subtitle: Text(user.email))),
        gapMd,
        Card(
          child: Padding(
            padding: const EdgeInsets.all(BfTokens.spaceMd),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Your permissions', style: Theme.of(context).textTheme.titleMedium),
              gapSm,
              Wrap(spacing: BfTokens.spaceSm, runSpacing: BfTokens.spaceSm, children: [for (final p in user.permissions) Chip(label: Text(p))]),
              if (user.permissions.isEmpty) const Text('None granted.'),
            ]),
          ),
        ),
        gapMd,
        const BfNotice(text: 'High-risk actions ask you to confirm your password. Recording payouts as paid, commission changes and user suspension are done in the web console.'),
        gapLg,
        BfButton(label: 'Sign out', variant: BfButtonVariant.secondary, icon: Icons.logout, expand: true, onPressed: deps.session.logout),
      ]),
    );
  }
}
