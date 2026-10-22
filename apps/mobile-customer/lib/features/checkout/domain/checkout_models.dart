import 'package:equatable/equatable.dart';

class Address extends Equatable {
  const Address({required this.id, required this.label, required this.recipient, required this.phone, required this.line1, required this.city, required this.district, required this.postalCode, required this.isDefault, this.line2});
  final String id;
  final String label;
  final String recipient;
  final String phone;
  final String line1;
  final String? line2;
  final String city;
  final String district;
  final String postalCode;
  final bool isDefault;
  String get oneLine => '$line1${line2 == null || line2!.isEmpty ? '' : ', $line2'}, $city, $district $postalCode';
  @override
  List<Object?> get props => [id, label, recipient, phone, line1, line2, city, district, postalCode, isDefault];
}

class AddressInput extends Equatable {
  const AddressInput({required this.label, required this.recipient, required this.phone, required this.line1, required this.city, required this.district, required this.postalCode, this.line2});
  final String label;
  final String recipient;
  final String phone;
  final String line1;
  final String? line2;
  final String city;
  final String district;
  final String postalCode;
  Map<String, dynamic> toJson() => {'label': label, 'recipient': recipient, 'phone': phone, 'line1': line1, if (line2 != null && line2!.isNotEmpty) 'line2': line2, 'city': city, 'district': district, 'postalCode': postalCode};
  @override
  List<Object?> get props => [label, recipient, phone, line1, line2, city, district, postalCode];
}

enum PaymentMethod { online, cod }

class PaymentView extends Equatable {
  const PaymentView({required this.id, required this.status, required this.canRetry, this.redirectUrl, this.message});
  final String id;
  final String status;
  final bool canRetry;
  final String? redirectUrl;
  final String? message;

  /// Money may still arrive: never invite the shopper to pay again.
  bool get inFlight => status == 'pending' || status == 'unknown';
  @override
  List<Object?> get props => [id, status, canRetry, redirectUrl, message];
}
