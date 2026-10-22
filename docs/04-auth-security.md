# 04 — Authentication, Authorization and Security

## 1. Threat model baseline

Assume clients can be modified, requests replayed, role fields altered, IDs guessed, webhook requests forged, provider APIs delayed, and users can own multiple devices. The server is the authority for identity, price, stock, permissions and transaction state. Mobile App Check or client obfuscation may add abuse friction but never replace API authentication and authorization.

Use the current OWASP Top 10 and OWASP API Security Top 10 as review baselines, especially broken object-level authorization, broken authentication, property-level authorization, unrestricted resource consumption, and unsafe third-party API consumption.

## 2. Web and mobile sessions

### Website
- Use an established, maintained authentication/session implementation where possible rather than inventing cryptography.
- Session cookie: `HttpOnly`, `Secure` in production, appropriate `SameSite`, narrow domain/path and bounded lifetime.
- Do not store access or refresh tokens in `localStorage` or expose them to client JavaScript.
- Protect cookie-authenticated state-changing requests against CSRF. Validate `Origin`/`Host` where applicable and use framework-supported protections/tokens.
- Re-check authorization in every Server Action and Route Handler. Middleware may redirect for UX but does not replace data-layer authorization.

### Flutter apps
- Use short-lived signed JWT access tokens (e.g. 5–15 minute starting range) with issuer, audience, subject, issued-at, expiry, session/family ID and a narrow token purpose. Explicitly allow only chosen algorithms and key IDs.
- Keep access token in memory where practicable; don't persist it in ordinary Hive preferences.
- Use a cryptographically random, opaque rotating refresh token stored in `flutter_secure_storage`; store only its hash server-side. Rotate on refresh; detect reuse, revoke the session family and log safely.
- On a 401, allow one single-flight refresh for concurrent requests, retry the original safe request once, and prevent loops. On refresh failure, clear local session and route to sign-in.
- Offer per-device session revocation and “sign out all devices”. Clear sensitive cached user data on logout/account switch.

### Why opaque refresh token, JWT access token?
JWT access tokens are easy to validate briefly; refresh tokens need rotation, revocation and reuse detection, which are usually more manageable as opaque server-tracked secrets. If the implementation decides to use JWT refresh tokens instead, it must still implement rotation/reuse detection and server-side revocation; signing a token is not a session management strategy.

## 3. Password and account controls

- Use a maintained password-hashing library configured for Argon2id or another current, reviewed password hashing scheme; never encrypt passwords reversibly.
- Verify email/phone before high-risk account actions. OTPs must be short-lived, one-time, hashed at rest where suitable, attempt-limited and rate-limited by account/IP/device.
- Return non-enumerating responses for login/password-reset flows where feasible.
- Use secure reset tokens with single-use semantics, expiry and session invalidation.
- Consider MFA/step-up auth for privileged admin operations, payout/refund approval, credential changes and recovery.
- Lock/suspend accounts with clear policy and support processes; don't permanently lock users in a way attackers can trigger trivially.

## 4. RBAC + resource authorization

Implement centralized helpers/policies such as:

- `requireAuthenticated()`
- `requirePermission(actor, "catalog.product.publish")`
- `requireResourceOwner(actor, resource)`
- `requireVendorActive(actor.vendorId)`
- `assertTransitionAllowed(currentState, requestedTransition, actor)`

Every protected operation must check:
1. **Function-level permission:** may this actor perform this action?
2. **Object-level authorization:** may they act on this exact resource?
3. **Property-level authorization:** which specific fields may they update/read?
4. **State/business eligibility:** is this transition valid now, for this actor and this resource?

Prefer query scoping that includes ownership (`{ _id: productId, vendorId: actor.vendorId }`) instead of fetching an arbitrary object and trusting a client-supplied vendor ID. DTOs should be allow-listed so a vendor cannot mass-assign `status`, `commissionRate`, `isFeatured`, `isAdmin` or other server-controlled properties.

## 5. API security baseline

- Validate path, query, headers and body using explicit schemas; reject unknown or dangerous fields for mutations.
- Use request body size limits, pagination maxima, timeouts and rate limits, with stricter limits for OTP, login, search, checkout, refunds and expensive report/AI routes.
- Use HTTPS/TLS everywhere. Set safe security headers and restrictive CORS allowlists for browser origins; CORS does not protect against non-browser clients.
- Use CSRF controls where cookie authentication is used.
- Use parameterized/typed database operations; never pass client-provided MongoDB operator objects or raw `$where` expressions.
- Redact tokens, passwords, OTPs, payment provider secrets, full addresses and sensitive provider payloads from logs.
- Prevent SSRF in any URL-fetch/image-import feature: use allowlisted hosts, block private/internal IPs and avoid following arbitrary redirects.
- Apply content-security policy and safe output handling; sanitize any user-authored rich text before rendering.
- Use a secrets manager or deployment secret environment for production; separate dev/test/staging/prod credentials and rotate credentials.
- Run dependency audit, secret scanning, static analysis and container/build checks in CI. Establish a vulnerability-reporting and patch process.

## 6. Payment/webhook security

- Provider credentials exist only on the server; do not compile them into Flutter or expose them through public runtime config.
- Validate signature/HMAC according to provider docs; if the provider requires a server-side verify/status API, call it and compare merchant reference, amount, currency and expected order.
- Do not trust a “success” URL/query parameter or client redirect.
- Deduplicate provider events with a unique database constraint and atomic state transitions. Acknowledge only after durable handling or durable enqueue; return provider-specific response codes as required.
- Verify webhook timestamps/signatures where the provider supports it; define replay windows and key rotation.
- Provider timeouts are ambiguous. Reconcile by querying the provider using a stable merchant reference before creating a new attempt.
- Keep card PAN/CVV out of your system; use hosted checkout or provider tokenization. Understand PCI obligations with the provider and qualified adviser.
- Audit admin-triggered capture/refund/payout adjustments and enforce approval thresholds.

## 7. Cloudinary media security

- Client asks the platform for upload authorization; API authenticates user and checks ownership/permission before returning narrow signed upload parameters.
- Restrict folder/prefix, asset type, file size, accepted formats, transformations and expiry.
- Verify upload result/server callback and bind the resulting public ID to an authorized product/vendor record.
- Only published, moderated product media is available to storefront users where moderation is required.
- Never expose Cloudinary API secret in browser or mobile bundle. Store `public_id`, resource type, dimensions and safe delivery URL metadata.

## 8. Privacy, audit and abuse controls

- Minimize collection of identity, address and business documents; define access roles and retention/deletion policies.
- Do not send raw PII, access tokens, payment data or free-text support messages to analytics by default.
- Record admin and financial actions in append-only audit logs with actor, reason, request ID, resource, timestamp and safe before/after changes.
- Detect checkout velocity, coupon abuse, seller spam, credential attacks and notification abuse through rate limits and signals; avoid unreliable fingerprinting as the only control.
- Do not expose the reason for internal fraud detection in user-facing errors if doing so enables evasion.

## 9. Required negative tests

Every protected endpoint must test unauthenticated access, wrong role, right role/wrong object, wrong vendor, forbidden fields, disabled account, invalid state transition, expired/revoked token, invalid/replayed webhook, rate-limit behaviour and error redaction as applicable.
