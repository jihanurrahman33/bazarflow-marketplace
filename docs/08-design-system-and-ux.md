# 08 — Design System, Reusable Components and UX States

## 1. Build the design system before page-by-page implementation

First define a small, coherent system, then implement screens from it. Do not ask agents to independently invent colours, spacing, button shapes and typography for each feature.

Deliver a theme specification before building the first full feature:
- brand palette with semantic roles (`primary`, `surface`, `surfaceContainer`, `textPrimary`, `textSecondary`, `border`, `success`, `warning`, `danger`, `info`);
- light and dark mode strategy, if both are in scope;
- typography scale and text styles;
- spacing/radius/elevation tokens;
- responsive breakpoints and grid rules for web;
- icon family and image aspect ratios;
- button/input/card/table/dialog/sheet states;
- focus, keyboard, contrast and touch-target rules;
- Flutter `ThemeData` / component themes and web CSS variables sourced from a documented token file.

Avoid hard-coded literal colours/sizes in feature screens. Literal values belong in token definitions or justified data, not repeated one-off styles. Avoid an abstraction for every single wrapper: build components when consistent styling/behaviour or reuse justifies them.

## 2. Component inventory

### Storefront
- `ProductCard`, `ProductPrice`, `RatingSummary`, `StockBadge`, `VendorBadge`, `ProductGallery`, `VariantSelector`, `QuantityStepper`, `SearchInput`, `FilterDrawer`, `SortMenu`, `Breadcrumbs`, `Pagination/LoadMore`, `EmptyState`, `PriceBreakdown`, `AddressSelector`, `PaymentMethodPicker`.

### Admin/vendor console
- `PageHeader`, `StatSummary`, `DataTable`, `TableToolbar`, `FilterBar`, `StatusBadge`, `AuditTimeline`, `ReviewQueueItem`, `ConfirmDialog`, `FormSection`, `PermissionGuard` (presentation only), `FileUploadField`, `MoneyAmount`, `DateRangeFilter`.

### Shared feedback
- `InlineFieldError`, `FormErrorSummary`, `LoadingSkeleton`, `InlineSpinner`, `FullPageLoading`, `EmptyState`, `RetryPanel`, `PendingStatusPanel`, `SuccessNotice`, `Toast`, `OfflineBanner`, `UnsavedChangesDialog`, `AccessibleModal`.

Components should accept typed data/callbacks, not reach into feature APIs. A `PermissionGuard` can hide/disable an action for clarity, but API authorization still decides access.

## 3. Layout and information density

- Storefront: prioritize product imagery, price, delivery/availability and a clear primary action. Put technical details and long descriptions behind structured sections/accordions when suitable.
- Vendor screens: show the most important task queue first; filters and advanced actions can be collapsed. Separate catalogue, orders, inventory and finance navigation.
- Admin screens: optimize for review/action workflows, not a giant wall of metrics. Every financial/admin action shows resource context, amount/status, and reason/confirmation when high impact.
- Use progressive disclosure, concise labels, consistent empty states, sensible defaults and inline help for unfamiliar business concepts.
- Use image placeholders/aspect-ratio boxes to avoid layout shift. Cloudinary transformations should be defined centrally for thumbnails/gallery/zoom; do not hand-construct arbitrary transformation URLs across features.
- Use a clear mobile breakpoints plan, not simply squashing desktop tables into small screens.

## 4. State-to-UI contract

For every async screen or mutation, the feature spec must answer:
- What does first load look like?
- What does refresh look like when prior data already exists?
- How is an empty result different from a failed request?
- Which failures can be retried, and what is the retry action?
- Can a mutation be cancelled? If cancellation is not guaranteed, how is that communicated?
- What happens on timeout or unknown payment state?
- Is stale data shown, and how is its age/status communicated?
- What happens if the session expires while the user is editing?
- How does the user recover from validation/permission/conflict errors?

Do not reduce every failure to a generic “Something went wrong.” Use stable API error codes mapped to clear copy. Avoid exposing internal or sensitive diagnostics.

## 5. Forms

- One source of truth for field validation schemas/rules per layer where practical; still validate on the server independently.
- Show field-level validation near the field and a form summary for global failure.
- Prevent duplicate submission while in progress, but handle repeated requests idempotently server-side.
- Preserve safe fields after a recoverable failure; discard secrets and payment-related sensitive data.
- Show pending status when a backend/provider is still processing. Avoid a false success screen before server confirmation.

## 6. Accessibility and localization

- Maintain text/background contrast, meaningful semantics, keyboard focus visibility, screen-reader labels, scalable text and touch targets.
- Don't encode meaning only by colour; pair status colour with icon/label.
- Use centralized messages/locale support. Bangladesh launch should assess Bangla and English requirements, BDT formatting, phone/address conventions and locale-specific number/date formatting.
- Never build API logic around translated labels or assume a localized currency string is a machine value.

## 7. UX acceptance checklist

A screen is not done if its happy path works but it has no designed empty/error/pending state, inconsistent tokens, unbounded text, inaccessible controls, duplicated patterns, or confusing recovery after a timeout. Provide a screenshot/preview and state matrix with the PR for major screens.
