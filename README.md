# Here / there

An original, independently deployable guestbook mini-app. MIT. Reviewed 13 October 2026.

`pnpm install; pnpm check; pnpm dev`. Deployment: provision isolated D1 and private R2, apply `migrations/0001.sql`, set `OWNER_API_TOKEN` with Wrangler secret input, then `pnpm deploy`. No GitHub Actions. Secrets never belong in source.

Versioned contract: `app.manifest.json`. Generic provider API: `/api/items` and `/api/items/:id`, contract 1; only currently public approved items are returned. Media and item queries send no-store, so source revocation applies on the next controlled request. A downloaded copy cannot be recalled.

Owner signs in at `/owner` with the runtime credential. Public browsing works without Composer. Uploads are invitation/owner-only; no anonymous multi-tenant promise. Composition mounts this service under its manifest route. Data remains with the app, never inside Composer.

## Public project standard

Reviewed 13 October 2026. The app supplies saved reader dark/light themes, native app navigation with Ctrl/Cmd+K and ordinary links, visible keyboard focus, phone layouts, favicon/touch icon and page-specific social metadata. Original generated App Composer artwork is retained with its prompt; functional icons remain vectors. These features do not widen signup, owner access or disclosure permissions.

Contributions: [Contributing](CONTRIBUTING.md), [Code of Conduct](CODE_OF_CONDUCT.md), [Security](SECURITY.md), [Accessibility](ACCESSIBILITY.md). Physical-device, screen-reader and full platform sharing acceptance remain distinct from browser checks.

Public collections include caption/alias search, a clear app explanation and original app thumbnails in navigation. When mounted, the reader theme and links stay with Composer; standalone themes remain app-owned. The invited studio and review permissions are unchanged. Review: 14 October 2026.

## Health and optional usage

Reviewed 14 October 2026. `GET /healthz` (or the declared mount plus `/healthz`) returns public liveness and exact source revision. It does not query storage, inspect credentials or prove a full user journey. `HEAD` is supported; other methods return 405.

Optional server-only daily counts use `USAGE_ENDPOINT` (an explicit HTTPS app-scoped endpoint) and `USAGE_TOKEN` (a write-only runtime secret). Both are absent by default, so forks remain independent. The copied MIT publisher derives from App Composer `lib/usage/publisher.mjs`; it is owned and deployable here, without a Composer package or Woodhouse runtime dependency. Failure or a 1.5-second timeout drops a count without blocking the app; there are no retries. Only successful public home-page opens, original photo opens are published. No visitor, URL, referrer, entered text, identity, profile, filename or passphrase is sent. `X-Composer-Verification: 1` excludes synthetic release probes.

The launch operator enables its own instances through Wrangler secrets; do not copy those secrets into a fork. The public [app activity](https://composer.loftwah.com/activity) explains retention, limits and missing-count/bot caveats.

Add `?vitals=1` to the public page, then open “Page performance” for local LCP/INP/CLS measurements. Values apply to this load only; unsupported metrics say unavailable. The self-hosted standard `web-vitals` 6.2.3 bundle and Apache licence/provenance are retained. No values, element attribution or page data are uploaded or persisted. Developer console links stay public and do not print app contents.
