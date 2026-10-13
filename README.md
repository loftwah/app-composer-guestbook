# Here / there

An original, independently deployable guestbook mini-app. MIT. Reviewed 13 October 2026.

`pnpm install; pnpm check; pnpm dev`. Deployment: provision isolated D1 and private R2, apply `migrations/0001.sql`, set `OWNER_API_TOKEN` with Wrangler secret input, then `pnpm deploy`. No GitHub Actions. Secrets never belong in source.

Versioned contract: `app.manifest.json`. Generic provider API: `/api/items` and `/api/items/:id`, contract 1; only currently public approved items are returned. Media and item queries send no-store, so source revocation applies on the next controlled request. A downloaded copy cannot be recalled.

Owner signs in at `/owner` with the runtime credential. Public browsing works without Composer. Uploads are invitation/owner-only; no anonymous multi-tenant promise. Composition mounts this service under its manifest route. Data remains with the app, never inside Composer.
