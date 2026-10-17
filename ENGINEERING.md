# Develop Here / there

Use Node 22, pnpm 12.8.1 and the committed lockfile (`pnpm install --frozen-lockfile`). TypeScript 6.0.3, Wrangler 4.143.1 and Prettier 3.9.10 are pinned. No Bun or GitHub Actions are required.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Check and emit readable browser/publisher assets, then run the app with its actual source identity and manifest. |
| `pnpm source:write` | Strictly check Worker and browser source; regenerate committed JavaScript and publisher declaration. |
| `pnpm check:types` | Check separate Worker and DOM environments and reject stale generated output. |
| `pnpm lint` | TypeScript unused-local/parameter checks; this scoped semantic lint is not an ESLint claim. |
| `pnpm format:check` / `pnpm format` | Check or format the explicit maintained-source/gate list in `scripts/format-source.mjs`. |
| `pnpm test` | Behavior, moderation/privacy, source revocation and sharing regressions with fictional fixtures. |
| `pnpm build` | Type/parity gate and a credential-free Wrangler dry run with exact identity defines. |
| `pnpm check` | Types, generated parity, semantic lint, formatting and tests. |
| `pnpm deploy` | Exact clean pushed main, full check/build, source recheck, forward DB migrations, source recheck, upload and live source/sharing verification. |

`src/browser/guest-postcard.ts`, `navigation.ts` and `owner.ts` own the postcard preview/submission, reader theme/collection filtering and local owner login/settings/photo/moderation journeys. Their outputs live under `public/brand`. `src/publisher.mts` produces `src/publisher.mjs` and its declaration together. `scripts/source-map.json` explicitly maps every emitted output; checks compile in memory and never rewrite source. Edit the typed source, run `pnpm source:write`, and commit reviewed source and output together.

The Worker program uses Workers globals and the browser program uses DOM globals, without combining their incompatible environments. Existing Worker SQL row/configuration `any` shapes remain a documented legacy boundary; this slice does not claim to validate every database result at runtime. New maintained browser/publisher modules use strict checking. The small pre-paint theme bootstrap and public console discovery message remain nonce-bearing server-rendered literals. Shared launcher/sharing/performance code and the licensed web-vitals bundle retain their explicit upstream maintenance/provenance boundary. Each app commits and releases its own assets; no Composer runtime dependency or automatic update is added.

The deployment script captures the reviewed SHA/config/source before checking and building, then rechecks main/HEAD/origin-main, clean status, config and all tracked file bytes/types before forward DB migrations and again immediately before upload, including assume-unchanged/skip-worktree edits. Failed migrations abort before upload. It explicitly selects root `wrangler.jsonc` and the default environment. Local browser and build evidence does not establish production, physical-device or platform-unfurl acceptance.

Here / there owns D1 photo/moderation records, private R2 media, guest postcards and the provider API. Linkarooie consumes only currently approved public items; it does not acquire ownership of this data or permission to approve an item. Do not change resource identifiers or import real private data for a test. Source extraction preserves routes, request schemas and CSP; resource provisioning and Composer source pins are separate release work.
