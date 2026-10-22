#!/usr/bin/env bash
# Runs every quality gate locally: web (typecheck, lint, tests, build, e2e smoke) and all Flutter projects.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== design tokens in sync =="
node packages/design-tokens/build.mjs
git diff --exit-code -- apps/web/src/app/tokens.css mobile_packages/design_system/lib/src/tokens.g.dart

echo "== web =="
npm run typecheck
npm run lint
npm test
npm run contract
git diff --exit-code -- packages/contracts/openapi.json
(cd apps/web && APP_ORIGIN=http://localhost:3000 MONGODB_URI=mongodb://localhost:27017 \
  JWT_ACCESS_SECRET=ci-only-access-secret-0123456789abcdef-0123 REFRESH_TOKEN_PEPPER=ci-only-pepper-secret-0123456789abcdef-0123 \
  PAYMENT_WEBHOOK_SECRET=ci-only-webhook-secret-0123456789abcdef-01 npx next build)
npm run smoke -w @bazarflow/web

echo "== flutter =="
for p in mobile_packages/app_core mobile_packages/design_system mobile_packages/observability apps/mobile-customer apps/mobile-vendor apps/mobile-admin; do
  echo "-- $p"
  (cd "$p" && flutter pub get >/dev/null && flutter analyze --fatal-infos && flutter test)
done
echo "ALL CHECKS PASSED"
