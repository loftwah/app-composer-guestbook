# Selected-resource member operations

The named Worker entrypoint `GuestbookMemberService` supplies the narrow Guestbook
side of Composer's shared membership contract. It uses the supported
[Workers named service entrypoint](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/).
It adds no account database, invitations, public login or permission store here.
App data remains in this app's existing D1/R2 and requires no schema migration.

Composer binds `GUESTBOOK_MEMBERS` to this exact deployed Guestbook Worker with
`entrypoint: "GuestbookMemberService"`. Only that binding's `fetch` accepts
`POST /__composer/member` (or `/guestbook/__composer/member` when composed).
The default public Worker always returns 404 on the member path, including when
presented either credential. Other paths and methods cannot dispatch owner APIs
through the named service.

The feature is closed unless `MEMBER_SERVICE_TOKEN`, `MEMBER_ISSUER`,
`RESOURCE_ACCOUNT_ID` and `RESOURCE_ENVIRONMENT` are configured. The dedicated
member secret is mirrored only into Composer's server-side
`GUESTBOOK_MEMBER_TOKEN`; it must differ from the general owner secret. The
owner token is rejected by the member entrypoint and the member token is
rejected by owner routes. Root configuration declares the intended issuer as
`https://composer.loftwah.com`; preview has no member issuer or resources.
The composed promotion must preserve that issuer and separately provision the
narrow secret before enabling the member bridge.

The request uses `Authorization: Bearer <member secret>` and the existing exact
`X-Composer-Workspace`, `X-Composer-Account`, `X-Composer-Environment`,
`X-Composer-Source`, `X-Composer-Target` proof. A supplied Origin must match the
request origin. The source is the actual build's exact SHA; the target is the
selected origin plus mount, not an interchangeable standalone URL.

```json
{
  "schema": "composer.member-operation/1",
  "actor": { "issuer": "https://composer.loftwah.com", "accountId": "stable-session-user-id" },
  "workspace": "selected-workspace-id",
  "resource": "selected-resource-id",
  "action": "contribute",
  "input": { "caption": "Fictional message", "author": "Optional alias", "consent": true, "png": "base64-png" }
}
```

Composer resolves the actor from its authenticated server session and checks
current accepted membership plus the exact app/resource/action immediately
before dispatch. Browser claims, a profile ID or profile ownership never grant
moderation. The app independently checks the exact selected resource's
workspace/account/environment/target, the declared issuer, narrow action and
input schema. Its server connection does not expose a general path dispatcher.

`contribute` accepts only the four illustrated input fields. It reuses the
existing app-owned postcard validator and writes a random pending contribution.
Live resource visibility, the active configuration's postcard setting, pause,
PNG sanitation, consent, per-actor connection bucket, daily admission, queue and
collection caps remain enforced. An unknown acknowledgement retains the
potentially committed private object; callers must keep the message and avoid
blind retries. Public puzzle-code submission remains a separate deliberately
narrow existing feature, and never grants member or moderation access.

`moderate` supports only:

- `{ "operation": "list" }`: returns `{contract:1,resource:{id,version},items}`.
  Each item contains only `id`, `caption`, `author`, `status`, `revision` and
  `synthetic` from the selected resource. No private-media URL, configuration,
  owner identity, export, enquiry or analytics is included.
- `{ "operation": "moderate", "operationId": "unique-operation-id", "expectedVersion": 2, "item": "selected-item-id", "itemRevision": 1, "status": "approved" }`:
  permits `approved`, `hidden` or `rejected` only. Existing app-owned version
  checks, source-lineage eligibility and atomic operation receipts apply. The
  response is `{contract:1,outcome:"applied",resource:{id,version},item,status}`.
  Operation identities are namespaced by stable actor; an exact retry can
  reconcile its receipt without applying moderation twice. Changed input or
  stale resource/item versions return conflict. Deletion, configuration,
  publication controls, exports and private-media downloads are absent.

Revocation belongs to the shared Composer contract: it denies the next
protected dispatch while preserving unrelated profile access and Guestbook
content. An already dispatched operation may complete; there is no claim of a
cross-Worker transaction or retroactive cancellation. Composer records dispatch
and membership/grant audit. Guestbook enforces live source visibility and media
revocation on each controlled public read.

Run `pnpm check` for fictional SQL/API boundary and regression tests.
`pnpm test:member-runtime` builds this exact app and exercises the actual bundled
named entrypoint in pinned Wrangler/workerd with isolated fictional D1/R2 and a
separate caller Worker. Its one owned temporary storage root is removed on
success and failure. This establishes a local runtime transport boundary, not a
production deployment, full authenticated Composer journey or physical-device
acceptance. Root integration owns current-grant/revoke/session qualification and
release receipts.
