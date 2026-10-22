import 'package:app_core/app_core.dart';
import 'package:flutter/material.dart';

import 'theme.dart';
import 'tokens.g.dart';

// ---------- spacing helpers ----------
const gapXs = SizedBox(height: BfTokens.spaceXs, width: BfTokens.spaceXs);
const gapSm = SizedBox(height: BfTokens.spaceSm, width: BfTokens.spaceSm);
const gapMd = SizedBox(height: BfTokens.spaceMd, width: BfTokens.spaceMd);
const gapLg = SizedBox(height: BfTokens.spaceLg, width: BfTokens.spaceLg);
const gapXl = SizedBox(height: BfTokens.spaceXl, width: BfTokens.spaceXl);
const pagePadding = EdgeInsets.all(BfTokens.spaceLg);

/// Primary action. Shows progress and ignores taps while busy (double-submit protection).
class BfButton extends StatelessWidget {
  const BfButton({super.key, required this.label, required this.onPressed, this.loading = false, this.variant = BfButtonVariant.primary, this.icon, this.expand = false});
  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final BfButtonVariant variant;
  final IconData? icon;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !loading;
    final child = Row(mainAxisSize: MainAxisSize.min, children: [
      if (loading) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) else if (icon != null) Icon(icon, size: 18),
      if (loading || icon != null) gapSm,
      Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
    ]);
    final button = switch (variant) {
      BfButtonVariant.primary => FilledButton(onPressed: enabled ? onPressed : null, child: child),
      BfButtonVariant.secondary => OutlinedButton(onPressed: enabled ? onPressed : null, child: child),
      BfButtonVariant.danger => FilledButton(
          onPressed: enabled ? onPressed : null,
          style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error, foregroundColor: Theme.of(context).colorScheme.onError),
          child: child),
      BfButtonVariant.text => TextButton(onPressed: enabled ? onPressed : null, child: child),
    };
    return Semantics(button: true, enabled: enabled, label: loading ? '$label, loading' : label, excludeSemantics: true, child: expand ? SizedBox(width: double.infinity, child: button) : button);
  }
}

enum BfButtonVariant { primary, secondary, danger, text }

// ---------- status ----------
const _statusTones = <String, (StatusTone, IconData)>{
  'pending_payment': (StatusTone.warning, Icons.schedule),
  'awaiting_payment': (StatusTone.warning, Icons.schedule),
  'confirmed': (StatusTone.info, Icons.check),
  'new': (StatusTone.info, Icons.fiber_new),
  'accepted': (StatusTone.info, Icons.check),
  'processing': (StatusTone.info, Icons.autorenew),
  'partially_fulfilled': (StatusTone.info, Icons.timelapse),
  'shipped': (StatusTone.info, Icons.local_shipping_outlined),
  'delivered': (StatusTone.success, Icons.check_circle_outline),
  'cancelled': (StatusTone.neutral, Icons.cancel_outlined),
  'closed': (StatusTone.neutral, Icons.check),
  'return_requested': (StatusTone.warning, Icons.undo),
  'returned': (StatusTone.neutral, Icons.undo),
  'requires_action': (StatusTone.warning, Icons.priority_high),
  'pending': (StatusTone.warning, Icons.schedule),
  'succeeded': (StatusTone.success, Icons.check_circle_outline),
  'failed': (StatusTone.danger, Icons.error_outline),
  'unknown': (StatusTone.warning, Icons.help_outline),
  'paid': (StatusTone.success, Icons.check_circle_outline),
  'refunded': (StatusTone.neutral, Icons.undo),
  'partially_refunded': (StatusTone.info, Icons.undo),
  'cod_pending': (StatusTone.warning, Icons.payments_outlined),
  'requested': (StatusTone.warning, Icons.schedule),
  'approved': (StatusTone.info, Icons.check),
  'rejected': (StatusTone.danger, Icons.cancel_outlined),
  'draft': (StatusTone.neutral, Icons.edit_outlined),
  'pending_review': (StatusTone.warning, Icons.schedule),
  'published': (StatusTone.success, Icons.check_circle_outline),
  'archived': (StatusTone.neutral, Icons.archive_outlined),
  'active': (StatusTone.success, Icons.check),
  'suspended': (StatusTone.danger, Icons.block),
  'submitted': (StatusTone.warning, Icons.schedule),
  'more_info_required': (StatusTone.warning, Icons.priority_high),
};

String humanize(String code) {
  final s = code.replaceAll(RegExp(r'[_.]+'), ' ').trim();
  return s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}

/// Colour is never the only signal: every status has an icon AND a text label.
class BfStatusBadge extends StatelessWidget {
  const BfStatusBadge(this.status, {super.key});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (tone, icon) = _statusTones[status] ?? (StatusTone.neutral, Icons.circle_outlined);
    final (fg, bg) = Theme.of(context).extension<BfStatusColors>()!.tone(tone);
    return Semantics(
      label: 'Status: ${humanize(status)}',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: BfTokens.spaceSm + 2, vertical: 3),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(BfTokens.radiusPill)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 14, color: fg),
          gapXs,
          Text(humanize(status), style: TextStyle(color: fg, fontSize: BfTokens.textCaption, fontWeight: FontWeight.w600)),
        ]),
      ),
    );
  }
}

// ---------- feedback ----------
class BfEmptyState extends StatelessWidget {
  const BfEmptyState({super.key, required this.title, this.message, this.icon = Icons.inbox_outlined, this.action});
  final String title;
  final String? message;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(BfTokens.spaceXxl),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 48, color: t.colorScheme.onSurfaceVariant),
          gapMd,
          Text(title, style: t.textTheme.titleMedium, textAlign: TextAlign.center),
          if (message != null) ...[gapSm, Text(message!, style: t.textTheme.bodySmall, textAlign: TextAlign.center)],
          if (action != null) ...[gapLg, action!],
        ]),
      ),
    );
  }
}

/// A failed load. "Try again" is offered only when retrying can help; a support reference is always shown.
class BfErrorPanel extends StatelessWidget {
  const BfErrorPanel({super.key, required this.error, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final api = error is ApiException ? error as ApiException : null;
    final message = api?.userMessage ?? 'Something went wrong. Please try again.';
    final canRetry = onRetry != null && (api?.retryable ?? true);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(BfTokens.spaceXxl),
        child: Semantics(
          liveRegion: true,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(api?.isNetwork == true ? Icons.wifi_off : Icons.error_outline, size: 48, color: t.colorScheme.error),
            gapMd,
            Text("We couldn't load this", style: t.textTheme.titleMedium),
            gapSm,
            Text(message, style: t.textTheme.bodyMedium, textAlign: TextAlign.center),
            if (api?.requestId != null) ...[gapSm, Text('Reference: ${api!.requestId}', style: t.textTheme.bodySmall)],
            if (canRetry) ...[gapLg, BfButton(label: 'Try again', onPressed: onRetry)],
          ]),
        ),
      ),
    );
  }
}

/// Inline, non-blocking error (form submit, action failure).
class BfInlineError extends StatelessWidget {
  const BfInlineError(this.error, {super.key});
  final Object error;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final msg = error is ApiException ? (error as ApiException).userMessage : 'Something went wrong. Please try again.';
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(BfTokens.spaceMd),
        decoration: BoxDecoration(color: t.colorScheme.errorContainer, borderRadius: BorderRadius.circular(BfTokens.radiusMd)),
        child: Row(children: [Icon(Icons.error_outline, color: t.colorScheme.error, size: 20), gapSm, Expanded(child: Text(msg))]),
      ),
    );
  }
}

class BfNotice extends StatelessWidget {
  const BfNotice({super.key, required this.text, this.tone = StatusTone.info, this.title, this.action});
  final String text;
  final String? title;
  final StatusTone tone;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = Theme.of(context).extension<BfStatusColors>()!.tone(tone);
    final icon = switch (tone) { StatusTone.success => Icons.check_circle_outline, StatusTone.warning => Icons.warning_amber, StatusTone.danger => Icons.error_outline, _ => Icons.info_outline };
    return Semantics(
      container: true,
      child: Container(
        padding: const EdgeInsets.all(BfTokens.spaceMd),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(BfTokens.radiusMd)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: fg, size: 20),
          gapSm,
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (title != null) Text(title!, style: TextStyle(color: fg, fontWeight: FontWeight.w700)),
            Text(text),
            if (action != null) ...[gapSm, action!],
          ])),
        ]),
      ),
    );
  }
}

class BfSkeleton extends StatelessWidget {
  const BfSkeleton({super.key, this.height = 16, this.width});
  final double height;
  final double? width;
  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: Container(height: height, width: width, decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(BfTokens.radiusMd))),
      );
}

class BfListSkeleton extends StatelessWidget {
  const BfListSkeleton({super.key, this.rows = 5, this.rowHeight = 72});
  final int rows;
  final double rowHeight;
  @override
  Widget build(BuildContext context) => Semantics(
        label: 'Loading',
        child: ListView.separated(
          physics: const NeverScrollableScrollPhysics(),
          padding: pagePadding,
          itemCount: rows,
          separatorBuilder: (_, _) => gapMd,
          itemBuilder: (_, _) => BfSkeleton(height: rowHeight),
        ),
      );
}

class BfOfflineBanner extends StatelessWidget {
  const BfOfflineBanner({super.key});
  @override
  Widget build(BuildContext context) => const Material(
        child: Padding(padding: EdgeInsets.all(BfTokens.spaceSm), child: Center(child: Text("You're offline. Showing the last loaded data."))),
      );
}

// ---------- data display ----------
class BfMoney extends StatelessWidget {
  const BfMoney(this.minor, {super.key, this.currency = 'BDT', this.style, this.strike = false});
  final int minor;
  final String currency;
  final TextStyle? style;
  final bool strike;
  @override
  Widget build(BuildContext context) => Text(
        formatMoney(minor, currency: currency),
        style: (style ?? Theme.of(context).textTheme.bodyMedium)?.copyWith(fontFeatures: const [FontFeature.tabularFigures()], decoration: strike ? TextDecoration.lineThrough : null),
      );
}

class BfStars extends StatelessWidget {
  const BfStars(this.value, {super.key});
  final double? value;
  @override
  Widget build(BuildContext context) {
    final v = value;
    if (v == null) return Text('No ratings yet', style: Theme.of(context).textTheme.bodySmall);
    final full = v.round().clamp(0, 5);
    return Semantics(
      label: '$v out of 5 stars',
      excludeSemantics: true,
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        for (var i = 0; i < 5; i++) Icon(i < full ? Icons.star : Icons.star_border, size: 16, color: Theme.of(context).colorScheme.secondary),
      ]),
    );
  }
}

class BfKeyValue extends StatelessWidget {
  const BfKeyValue(this.label, this.value, {super.key, this.strong = false});
  final String label;
  final Widget value;
  final bool strong;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(children: [
        Expanded(child: Text(label, style: strong ? t.textTheme.titleMedium : t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.onSurfaceVariant))),
        DefaultTextStyle.merge(style: strong ? t.textTheme.titleMedium : null, child: value),
      ]),
    );
  }
}

class BfQuantityStepper extends StatelessWidget {
  const BfQuantityStepper({super.key, required this.value, required this.onChanged, this.min = 1, this.max = 20, this.busy = false});
  final int value;
  final int min;
  final int max;
  final bool busy;
  final ValueChanged<int> onChanged;
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        IconButton.outlined(tooltip: 'Decrease quantity', onPressed: busy || value <= min ? null : () => onChanged(value - 1), icon: const Icon(Icons.remove)),
        SizedBox(width: 40, child: Semantics(liveRegion: true, child: Text('$value', textAlign: TextAlign.center))),
        IconButton.outlined(tooltip: 'Increase quantity', onPressed: busy || value >= max ? null : () => onChanged(value + 1), icon: const Icon(Icons.add)),
      ]);
}

// ---------- dialogs ----------
/// Confirmation with an optional free-text field (reasons, references). Returns the text, or null if cancelled.
Future<String?> showReasonDialog(
  BuildContext context, {
  required String title,
  String? body,
  String fieldLabel = 'Reason',
  String confirmLabel = 'Confirm',
  bool danger = false,
  bool requireText = true,
  int minLength = 3,
  bool obscure = false,
}) {
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        final ok = !requireText || controller.text.trim().length >= minLength;
        return AlertDialog(
          title: Text(title),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (body != null) ...[Text(body), gapMd],
            TextField(controller: controller, autofocus: true, obscureText: obscure, maxLines: obscure ? 1 : 3, minLines: 1, maxLength: obscure ? 128 : 300, decoration: InputDecoration(labelText: fieldLabel), onChanged: (_) => setState(() {})),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            FilledButton(
              onPressed: ok ? () => Navigator.pop(ctx, controller.text.trim()) : null,
              style: danger ? FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error) : null,
              child: Text(confirmLabel),
            ),
          ],
        );
      },
    ),
  );
}

/// Plain yes/no for irreversible actions.
Future<bool> confirm(BuildContext context, {required String title, String? body, String confirmLabel = 'Confirm', bool danger = false}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: body == null ? null : Text(body),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), style: danger ? FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error) : null, child: Text(confirmLabel)),
      ],
    ),
  );
  return r ?? false;
}

/// Password prompt used for step-up authentication.
Future<String?> promptPassword(BuildContext context) => showReasonDialog(
      context,
      title: 'Confirm your password',
      body: 'This action moves money or changes settings, so we need to confirm it is really you.',
      fieldLabel: 'Password',
      confirmLabel: 'Confirm',
      obscure: true,
      minLength: 1,
    );
