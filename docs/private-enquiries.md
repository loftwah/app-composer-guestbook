# App-owned private enquiries

Prepared #117 implementation. The app owns its records, queue, consent, export,
review and expiry. Composer may broker an enquiry through this supported API;
it never keeps a second submission store. No email, contacts, uploads,
notifications or public approval state are implemented.

The fixed `briefs/v1` form is captured from Composer's reviewed #21 field model.
Its validator and calendar helper are local MIT source, with exact provenance in
[enquiry-model-provenance.json](enquiry-model-provenance.json). Incoming schemas,
URLs, workspace selectors and extra values cannot replace that model.

## Opening and using a form

Forms start closed. An authenticated resource owner configures an explicit
`standalone` scope or one `composer.publication` scope. The latter fixes the stack,
publication, instance, resource and activated configuration. Enabling a later
publication closes older scopes for that same stack and instance atomically.
It does not close a separately enabled standalone form or another stack's scope.

Standalone routes, with the ordinary optional `/guestbook` mount prefix:

- `GET /r/:resource/c/:configuration/enquiry` renders the actual brief form.
- `POST .../enquiry/submit` accepts only `{contract:1,intent,values,consent:true}`.
- `POST .../enquiry/receipt` accepts only `{contract:1,intent}` and returns only
  `{contract:1,intent,received:boolean}`. Absence cannot establish rollback.

Writes require the page's current source and target headers plus same origin.
These public headers verify the current app address; they are not owner access.
The server repeats resource/environment/target, active scope revision, activated
configuration, visibility and current restore-lineage guards in the insertion.
A later source closure prevents rendering, reopening and new delivery. No brief
can enter the legacy photo feed, provider items or approved-media routes.

The browser retains incomplete/newer input during delayed replies and unknown
receipts. It stores only the opaque intent in this tab, never private text.
Before leaving, native browser navigation warns about pending or unsaved input.
Only a valid matching receipt can confirm delivery. A successful missing-receipt
check enables an explicit retry of the exact original in-page snapshot and same
intent; a newer draft stays unsent. Reloading can recover the opaque receipt
intent but does not recover private text or its retry snapshot. A closed or
changed Composer publication may prevent its receipt from being checked through
that public broker; keep the intent rather than inventing another delivery.

## Supported owner API

All private routes use the existing bearer-only app connection and exact
`X-Composer-Workspace`, account, environment, source and target proof. Public guest
codes and browser sessions grant none of this authority. The app can operate
independently of Composer with its supported owner connection.

`GET /api/resources/:resource/enquiries` has fixed `status=pending|reviewed|rejected|all`
and `page=1..10` filters, twenty entries per page. Duplicate/unknown filters and
cross-workspace resources are refused. `GET .../enquiries/export` exports up to200
retained private bodies with consent and immutable provenance; no credential or
media is included. `GET .../enquiries/receipt?operation=:uuid` returns a bounded
historical operation acknowledgement, never the submitted private body.

`POST .../enquiries` accepts one declared command:

- `configure`: explicit scope, boolean enabled, current scope/resource revisions
  and a UUIDv4 operation.
- `review`, `reject` or `delete`: exact item and item/resource revisions plus the
  original operation identity. Delete clears submitted text immediately.
- `form`, `submit` or `deliveryReceipt`: fixed broker operations with an owner-
  verified scope. They do not create a public inbox or accept browser authority.

One atomic D1 batch commits each owner change and its immutable acknowledgement.
Exact replay checks the earlier receipt before current CAS/eligibility. Unknown
transport/storage outcomes retain the operation; an absent receipt alone does
not prove rollback. Every confirmed item has one immutable intent per resource;
changed content with the same intent is refused. Independently repeated source
verification is enforced by the actual Worker at each owner write.

## Bounds and retention

The request limit is12KiB; normalized values are at most10KiB. Title120, goal2000,
HTTPS site240, and up to8 deliverables (item120/detail300) are enforced by the same
local model in browser and app. Public attempts are limited to6 per connection
per15minutes, including receipt reads; delivery attempts to2. Atomic app limits
are16 pending,20 per UTC day and200 retained bodies per resource. Replays do not
add records or consume another queue slot. At most32 form scopes may be enabled;
owner operations are capped at100 per resource per UTC day. Temporary existing
rate buckets hold only a connection hash, not an enquiry identity or analytics.

App reads deny expired bodies at30days even if cleanup fails. Daily03:17UTC and
request-time cleanup clear expired text, so physical removal normally completes
by the next daily run; scheduler/storage outages may delay physical removal.
Minimal delivery and operation receipt metadata is retained for35days and then
purged. No claim of instantaneous provider storage erasure is made. Preview has
an explicit empty cron list and no production D1/R2/services. Apply forward0004
only after the independent0003 portability migration; neither changes legacy
photos, settings or media.

Local qualification uses fictional records, actual Worker/D1 and both Chromium
and WebKit for standalone/mounted delivery, delayed edits, lost ACK, receipt-only
checking, explicit exact retry and late closure. It is not a production release,
Cloudflare Access qualification, physical-device result, adoption, notifications
or complete #117 audience automation. Release and integration remain separate.
