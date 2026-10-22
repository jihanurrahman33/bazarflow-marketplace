import 'package:flutter/material.dart';

import 'tokens.g.dart';

/// Material 3 themes derived ONLY from the shared design tokens. Feature code uses `Theme.of(context)`
/// or the helpers in this package, never literal colours.
class BfTheme {
  BfTheme._();

  static ThemeData light() => _build(BfTokens.light, Brightness.light);
  static ThemeData dark() => _build(BfTokens.dark, Brightness.dark);

  static ThemeData _build(BfColors c, Brightness b) {
    final scheme = ColorScheme(
      brightness: b,
      primary: c.primary,
      onPrimary: c.onPrimary,
      primaryContainer: c.primarySoft,
      onPrimaryContainer: c.textPrimary,
      secondary: c.accent,
      onSecondary: c.surface,
      secondaryContainer: c.accentSoft,
      onSecondaryContainer: c.textPrimary,
      error: c.danger,
      onError: c.surface,
      errorContainer: c.dangerSoft,
      onErrorContainer: c.textPrimary,
      surface: c.surface,
      onSurface: c.textPrimary,
      onSurfaceVariant: c.textSecondary,
      surfaceContainerHighest: c.surfaceContainer,
      surfaceContainer: c.surfaceContainer,
      outline: c.border,
      outlineVariant: c.border,
    );
    final text = TextTheme(
      headlineMedium: TextStyle(fontSize: BfTokens.textHeadline, fontWeight: FontWeight.w700, color: c.textPrimary),
      titleLarge: TextStyle(fontSize: BfTokens.textTitle, fontWeight: FontWeight.w700, color: c.textPrimary),
      titleMedium: TextStyle(fontSize: BfTokens.textBodyLarge, fontWeight: FontWeight.w600, color: c.textPrimary),
      bodyLarge: TextStyle(fontSize: BfTokens.textBodyLarge, color: c.textPrimary),
      bodyMedium: TextStyle(fontSize: BfTokens.textBody, color: c.textPrimary),
      bodySmall: TextStyle(fontSize: BfTokens.textCaption, color: c.textSecondary),
      labelLarge: TextStyle(fontSize: BfTokens.textBody, fontWeight: FontWeight.w600),
    );
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(BfTokens.radiusMd));
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: c.background,
      textTheme: text,
      extensions: [BfStatusColors(c)],
      appBarTheme: AppBarTheme(backgroundColor: c.surface, foregroundColor: c.textPrimary, elevation: 0, scrolledUnderElevation: 1),
      cardTheme: CardThemeData(color: c.surface, elevation: 0, margin: EdgeInsets.zero, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BfTokens.radiusLg), side: BorderSide(color: c.border))),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.surface,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(BfTokens.radiusMd), borderSide: BorderSide(color: c.border)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(BfTokens.radiusMd), borderSide: BorderSide(color: c.border)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(BfTokens.radiusMd), borderSide: BorderSide(color: c.focus, width: 2)),
        errorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(BfTokens.radiusMd), borderSide: BorderSide(color: c.danger)),
        contentPadding: const EdgeInsets.symmetric(horizontal: BfTokens.spaceLg, vertical: BfTokens.spaceMd),
      ),
      filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size(64, BfTokens.touchTarget), shape: shape)),
      outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(minimumSize: const Size(64, BfTokens.touchTarget), shape: shape, side: BorderSide(color: c.border))),
      textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(minimumSize: const Size(48, BfTokens.touchTarget))),
      navigationBarTheme: NavigationBarThemeData(backgroundColor: c.surface, indicatorColor: c.primarySoft),
      dividerTheme: DividerThemeData(color: c.border, space: 1),
    );
  }
}

/// Semantic status colours (success / warning / danger / info) as a theme extension.
@immutable
class BfStatusColors extends ThemeExtension<BfStatusColors> {
  const BfStatusColors(this.colors);
  final BfColors colors;

  (Color fg, Color bg) tone(StatusTone t) => switch (t) {
        StatusTone.success => (colors.success, colors.successSoft),
        StatusTone.warning => (colors.warning, colors.warningSoft),
        StatusTone.danger => (colors.danger, colors.dangerSoft),
        StatusTone.info => (colors.info, colors.infoSoft),
        StatusTone.neutral => (colors.textSecondary, colors.surfaceContainer),
      };

  @override
  BfStatusColors copyWith({BfColors? colors}) => BfStatusColors(colors ?? this.colors);
  @override
  BfStatusColors lerp(ThemeExtension<BfStatusColors>? other, double t) => this;
}

enum StatusTone { success, warning, danger, info, neutral }
