# Here / there

Here / there collects photos and guest postcards for an owner to review before publishing. Visitors browse approved moments; owners control moderation and revoke controlled media at its source. It runs independently and provides approved public items to Linkarooie. MIT.

[Development commands and source ownership](ENGINEERING.md).

`pnpm install --frozen-lockfile; pnpm check; pnpm dev`. Deployment: provision isolated D1 and private R2, apply `migrations/0001.sql`, set `OWNER_API_TOKEN` with Wrangler secret input, then `pnpm deploy`. No GitHub Actions. Secrets never belong in source.

Versioned contract: `app.manifest.json`. Generic provider API: `/api/items` and `/api/items/:id`, contract 1; only currently public approved items are returned. Media and item queries send no-store, so source revocation applies on the next controlled request. A downloaded copy cannot be recalled.

Owner entry is `/owner`. This instance sets `OWNER_STUDIO_URL` to its existing Cloudflare-protected Composer editor, selecting this app. The redirect creates no app session and grants no API permission. Independent installations omit that optional variable and retain the local runtime-credential studio. Public registration is not added. Public browsing works without Composer. Owner photo uploads remain invitation/owner-only. An optional guest postcard path is closed by default: the owner can enable it in configuration, and the public puzzle code `hunter2` permits new pending postcards only. It never signs a guest into the owner studio. No anonymous multi-tenant promise. Composition mounts this service under its manifest route. Data remains with the app, never inside Composer.

![Here / there public collection, captured in a real browser with fictional fixtures](docs/images/public-collection.png)

This screenshot shows the actual public app with fictional local contributions.

## Public project standard

Reviewed 13 October 2026. The app supplies saved reader dark/light themes, native app navigation with Ctrl/Cmd+K and ordinary links, visible keyboard focus, phone layouts, favicon/touch icon and page-specific social metadata. Original generated App Composer artwork is retained with its prompt; functional icons remain vectors. These features do not widen signup, owner access or disclosure permissions.

Contributions: [Contributing](CONTRIBUTING.md), [Code of Conduct](CODE_OF_CONDUCT.md), [Security](SECURITY.md), [Accessibility](ACCESSIBILITY.md). Physical-device, screen-reader and full platform sharing acceptance remain distinct from browser checks.

Public collections include caption/alias search, a clear app explanation and original app thumbnails in navigation. When mounted, the reader theme and links stay with Composer; standalone themes remain app-owned. The invited studio and review permissions are unchanged. Review: 14 October 2026.

## Health and optional usage

Reviewed 14 October 2026. `GET /healthz` (or the declared mount plus `/healthz`) returns public liveness and exact source revision. It does not query storage, inspect credentials or prove a full user journey. `HEAD` is supported; other methods return 405.

Optional server-only daily counts use `USAGE_ENDPOINT` (an explicit HTTPS app-scoped endpoint) and `USAGE_TOKEN` (a write-only runtime secret). Both are absent by default, so forks remain independent. The copied MIT publisher derives from App Composer `lib/usage/publisher.mjs`; it is owned and deployable here, without a Composer package or Woodhouse runtime dependency. Failure or a 1.5-second timeout drops a count without blocking the app; there are no retries. Successful public home-page opens, original contribution-page opens and newly committed pending guest postcard receipts can be published. Receipt counts are not publication or unique-person counts; owner moderation is not counted. No visitor, URL, referrer, entered text, identity, profile, filename or passphrase is sent. `X-Composer-Verification: 1` excludes synthetic release probes.

The launch operator enables its own instances through Wrangler secrets; do not copy those secrets into a fork. The public [app activity](https://composer.loftwah.com/activity) explains retention, limits and missing-count/bot caveats.

Add `?vitals=1` to the public page, then open “Page performance” for local LCP/INP/CLS measurements. Values apply to this load only; unsupported metrics say unavailable. The self-hosted standard `web-vitals` 6.2.3 bundle and Apache licence/provenance are retained. No values, element attribution or page data are uploaded or persisted. Developer console links stay public and do not print app contents.

Original editorial presentation, reviewed 14 October 2026: app-specific illustrated hero and sharing artwork, responsive 600/1200px WebP sources, reserved image dimensions, clear collection/story sections and native browse/contribute actions. Illustration is labelled separately from published contributions. Mounted social URLs resolve inside the app mount. Owner titles, introductions, layouts, moderation, data and configuration contracts are preserved. Asset provenance and optimisation are recorded beside each derivative.

## Optional guest postcards

The owner sets `guestAccess` to `postcards` (or back to `closed`) through the existing configuration contract. Guests open `/contribute`, write up to 160 characters and an optional 60-character alias, confirm consent, and send a browser-rendered PNG postcard. This is a visual contribution with accessible caption/alias metadata, not a new message database or a verified identity. The puzzle code is intentionally public; authority comes from the narrow server route. No owner credential or guest session is issued.

`POST /api/guest-postcard` accepts only code/caption/author/consent/png from the same origin, validates/sanitises the PNG (100 KB, 1200 × 900 maximum), and creates a new random pending item. The existing provider, media visibility, owner review and revocation paths apply unchanged. A guest cannot publish, modify/delete another entry, export, change settings, see pending/private media or use owner uploads. Owner closure/pause and queue/collection caps are rechecked atomically at insertion; storage failure cleans the generated object where possible and never exposes it publicly.

Bounds: six attempts per IP-derived connection bucket per 15 minutes, two valid submissions per bucket, eight admitted submissions globally per UTC day, sixteen pending review items and the existing 200-item gallery cap. Failed storage/admission attempts can consume a daily slot; retries are explicit. These are abuse/storage bounds, not distinct-person counts. Existing owner photos/data/configuration stay in their app-owned D1/R2; no schema migration is needed. The default and earlier clients keep submissions closed unless the owner explicitly activates them. Browser/production qualification and Composer source-pin promotion remain separate from source tests.

## Public sharing and link presentation

MP direction, 16 October 2026: links use no underlines and retain visible keyboard focus. Page, Open Graph and X titles/descriptions agree; the app serves an explicit large-image card with dimensions, type and alt text. The normal release checks live public HTML and JPEG dimensions with a marked Twitterbot user-agent probe. Actual X rendering is a separate observation; a probe alone does not establish it.

The shared header keeps theme switching as a quiet current-mode sun/moon icon. Preserve the stable Dark theme accessible toggle name, pressed state, keyboard focus, 44px target and existing saved-preference key. Keep the secondary control class so light-theme primary-button rules cannot override its foreground.

## Shared Apps launcher

The committed `public/brand/launcher.js` and `launcher.css` follow Composer's maintained launcher contract. The controller is generated from Composer's strictly checked `src/browser/launcher.ts`; app destinations, theme keys and gallery filters stay local. Review and copy updates with Composer's explicit `pnpm ui:assets --check|--write /absolute/this-checkout`, then run this app's checks and release independently. No runtime Composer asset dependency or automatic update is added.

Family typography and launcher refinement, reviewed 18 October 2026: headings use the selected self-hosted Latin Space Grotesk variable font; CSS and preload name the same versioned local asset. The Linkarooie launcher thumbnail uses the reviewed curator crop. Superseded assets remain available. Source and byte provenance: [`public/brand/family-assets-20261018.md`](public/brand/family-assets-20261018.md).
