/// Build/runtime configuration, parsed once at app start (never hardcoded in features).
class AppConfig {
  const AppConfig({
    required this.baseUrl,
    required this.appId,
    this.platform = 'android',
    this.environment = 'development',
    this.connectTimeout = const Duration(seconds: 10),
    this.receiveTimeout = const Duration(seconds: 25),
  });

  /// Origin of the BazarFlow API, e.g. `https://api.example.com` (no trailing slash, no `/api/v1`).
  final String baseUrl;

  /// Application id, sent when registering the device and shown in the sessions list.
  final String appId;
  final String platform;
  final String environment;
  final Duration connectTimeout;
  final Duration receiveTimeout;

  bool get isProduction => environment == 'production';

  /// Reads `--dart-define` values. Production builds must define `API_BASE_URL`.
  factory AppConfig.fromEnvironment({required String appId, String platform = 'android'}) {
    const base = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:3000');
    const env = String.fromEnvironment('APP_ENV', defaultValue: 'development');
    final config = AppConfig(baseUrl: base, appId: appId, platform: platform, environment: env);
    config.validate();
    return config;
  }

  void validate() {
    final uri = Uri.tryParse(baseUrl);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      throw ArgumentError('API_BASE_URL is not a valid URL: $baseUrl');
    }
    if (isProduction && uri.scheme != 'https') {
      throw ArgumentError('Production builds must use https (got ${uri.scheme}).');
    }
    if (baseUrl.endsWith('/')) throw ArgumentError('API_BASE_URL must not end with a slash.');
  }
}
