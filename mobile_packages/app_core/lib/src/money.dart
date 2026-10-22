/// Money is always integer minor units + currency. Locale formatting happens only at the edge.
String formatMoney(int amountMinor, {String currency = 'BDT'}) {
  final negative = amountMinor < 0;
  final abs = amountMinor.abs();
  final major = abs ~/ 100;
  final minor = (abs % 100).toString().padLeft(2, '0');
  final grouped = major.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  final symbol = currency == 'BDT' ? '৳' : '$currency ';
  return '${negative ? '-' : ''}$symbol$grouped.$minor';
}

/// Parses a user-typed decimal ("1200", "1200.5") into minor units, or null if it is not a valid amount.
int? parseMoneyInput(String input) {
  final m = RegExp(r'^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$').firstMatch(input);
  if (m == null) return null;
  return int.parse(m.group(1)!) * 100 + int.parse((m.group(2) ?? '').padRight(2, '0'));
}
