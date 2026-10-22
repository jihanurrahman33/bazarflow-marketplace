# 07 — Flutter Apps and BLoC Architecture

## 1. App strategy

Ship three apps with separate identities/release pipelines:
- `customer_app`
- `vendor_app`
- `admin_app`

Share code through internal Dart packages for API client, error/result types, secure session management, theme/design system, analytics/Crashlytics wrappers, notification deep-link handling and common primitives. Keep role-specific features and navigation in their own apps. Shared code must not turn a user app binary into a hidden-but-accessible admin console.

Every app authenticates to the same versioned Next.js API; the API authorizes each operation independently.

## 2. Feature-first Clean Architecture

Example feature layout:

```text
lib/
  app/                         # app bootstrap, routes, dependency registration
  core/
    config/                    # parsed build/runtime configuration
    network/                   # Dio client, interceptors, typed API errors
    session/                   # access/refresh flow and session repository
    storage/                   # encrypted local data abstraction
    theme/                     # tokens, ThemeData, component themes
    analytics/                 # approved event names and redaction
    notifications/             # FCM registration/deep links
    widgets/                   # small generic reusable widgets
  features/
    catalog/
      data/                    # DTOs, remote source, repository implementation
      domain/                  # entities, repository contract, use cases
      presentation/            # BLoC/Cubit, pages, feature widgets
    cart/
    checkout/
    orders/
    ...
```

Dependency direction: `presentation -> domain`, `data -> domain`; domain does not depend on Flutter UI, Dio, Firebase or Hive. Use cases are valuable for orchestration/business logic, not mandatory wrappers around every simple getter.

## 3. BLoC responsibilities

- **Event:** user intent or an external event, e.g. `LoadProducts`, `RefreshOrders`, `SubmitCheckout`, `CancelCheckout`.
- **State:** complete, serializable/predictable screen state. Model data and phases explicitly; avoid dozens of booleans whose combinations can contradict one another.
- **Bloc/Cubit:** coordinates use cases, emits state transitions and handles cancellation/race behaviour. It does not build widgets or reach into MongoDB.
- **Repository:** maps API DTOs/errors to domain results and owns data source selection/cache policy.
- **Widget:** renders the current state and dispatches user intent. Do not perform business decisions in `build()`.

Use a maintained immutable/sealed-state approach if it improves exhaustiveness (e.g. Freezed, sealed classes in Dart). Confirm package compatibility before pinning versions.

## 4. State modelling standard

Every feature defines the states it can legitimately enter. Example for a list screen:

```dart
sealed class OrdersState {}
final class OrdersInitial extends OrdersState {}
final class OrdersLoading extends OrdersState {}
final class OrdersLoaded extends OrdersState {
  OrdersLoaded(this.orders, {this.isRefreshing = false, this.nextCursor});
  final List<OrderSummary> orders;
  final bool isRefreshing;
  final String? nextCursor;
}
final class OrdersEmpty extends OrdersState {}
final class OrdersFailure extends OrdersState {
  OrdersFailure(this.error, {this.canRetry = true});
  final AppError error;
  final bool canRetry;
}
```

The exact representation can vary, but account for these user-visible cases where applicable:
- initial/not-yet-loaded;
- loading and refreshing without unnecessary visual flicker;
- loaded and empty;
- field validation failure;
- recoverable network/server failure with retry;
- unrecoverable authorization/session failure;
- submitted/pending/awaiting provider response;
- success with a safe next step;
- cancellation and timeout;
- stale/offline data if offline mode exists.

For a checkout/payment screen, `pending` is not `failure`; never tell the customer to pay again when the previous provider attempt is unknown. Expose a “check status”/reconciliation flow.

## 5. Networking and access-token renewal

- One API client configured from typed app configuration. Use a base URL by environment, not hardcoded constants distributed across features.
- Add request correlation IDs and safe structured diagnostics.
- Decode common API errors into typed error codes; map codes to localized and user-friendly copy.
- Use a single-flight refresh coordinator so simultaneous 401s do not race to rotate the same token.
- Retry a request at most according to an explicit rule. Never automatically retry a non-idempotent mutation without an idempotency key.
- Add connect/receive/send timeouts, cancellation and network status presentation.
- Treat API server permission errors as authoritative even if UI hidden the relevant action.

## 6. Local storage and encryption

Use `flutter_secure_storage` for refresh tokens, key-encryption keys and other small secrets. Its current platform implementation uses OS secure storage mechanisms; verify each target/version behaviour at build time.

For local structured data using Hive/Hive CE or the selected maintained fork:
1. Generate a strong random AES key using a cryptographically secure random source on first setup.
2. Store the key only in platform secure storage; never hardcode it or derive it from a username/device ID.
3. Use the Hive variant's supported authenticated encryption API (such as `HiveAesCipher` where available) and pin/test the exact package version.
4. Separate sensitive and non-sensitive boxes; do not persist unnecessary profile/order details.
5. On logout or account switch, delete user-scoped cached data and rotate/remove the local key when required.
6. Plan encryption-key loss/migration, app reinstall, backup/restore and schema upgrades; do not silently replace a key and strand old data.
7. Avoid persisting refresh tokens in Hive even when the box is encrypted. Keep them in secure storage.
8. No client encryption makes a rooted/jailbroken device invulnerable. Minimize local secrets and use server-side expiry/revocation.

Do not use the experimental web implementation of secure storage as a substitute for browser session security; these are mobile apps in this scope.

## 7. Firebase and device lifecycle

- Initialize Firebase correctly per app/environment; use distinct app registrations where appropriate.
- `firebase_crashlytics`: record fatal/nonfatal exceptions and useful breadcrumbs; redact PII/tokens/provider payloads.
- `firebase_analytics`: define an approved event taxonomy; never log secrets, full addresses, payment credentials or free-form support content. Verify events with DebugView.
- `firebase_messaging`: request permission at a sensible UX point; register/update device installation/token with the API; handle foreground, background, terminated-app and tapped-notification flows.
- Keep notification payloads small and non-sensitive. Prefer resource IDs/deep links; fetch current authorized data after opening.
- Configure iOS APNs keys/capabilities and Android requirements; test real devices, not only emulator happy paths.
- Consider Firebase App Check to reduce abuse of Firebase resources, but do not confuse it with authentication/authorization for the Next.js API.

## 8. Flutter testing requirements

- BLoC tests for initial/loading/success/empty/failure/cancel/pending transitions and stale-response races.
- Repository tests for DTO parsing, API error mapping, retry/idempotency behaviour and secure-storage failure.
- Widget tests for all defined screen states, validation and accessible labels.
- Integration tests for sign-in/refresh/logout, checkout/payment pending status, order updates, vendor ownership-denied errors and notification deep links.
- Fake clock/token expiry where practical; do not rely on real time/sleep in tests.
- Test encrypted storage migration on supported OS versions and verify test fixtures contain no production secrets.
