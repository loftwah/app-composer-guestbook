# Private enquiries — implementation contract

This first enquiry slice belongs to Here / there. Its app-owned D1 stores the
fixed brief, private-delivery consent, scope provenance and exact operation
receipts. Composer only verifies and brokers supported APIs; it does not store
copies of submissions. The captured finite field validator and model have local
source provenance in `enquiry-model-provenance.json`.

Every form starts closed. An app owner can separately enable a standalone
resource/configuration form or one exact Composer publication/instance scope.
Closing or archiving a stack denies its Composer form and submission path; it
cannot silently change an independently enabled standalone scope. Current
resource visibility, pause, activated configuration and declared scope are
rechecked atomically before admission. The public body never supplies a
workspace, owner token, URL or execution authority.

The brief is private text: title, goal, fixed starting-point choice, optional
conditional HTTPS site and up to eight short deliverable rows. Consent means
private delivery to the authorized workspace only. There are no contacts,
uploads, publication, email, notifications or marketing permissions. The inbox
uses pending/reviewed/rejected states; none is public approval. Imported text and
links remain data and are never rendered as HTML, fetched or executed.

Private bodies expire after 30 days. Minimal nonce/digest/provenance receipts
and logical deletion metadata remain for at most 35 days to support bounded
reconciliation. A public receipt exposes only whether that exact intent was
received, never its body or owner state. An absent/unavailable receipt cannot
prove safe retry after an uncertain response. New input and the uncertain
reference remain visible until an explicit recovery decision.

The independent owner API enforces the existing exact workspace/account/
environment/source/target credential boundary. Mutations bind resource and item
revisions plus operation identity in one atomic journaled change. Composer
requires native Creator permission and current owner/editor workspace access,
rechecks after remote waits, and derives public provenance from an immutable
current publication reference before dispatch. No real enquiries, contacts or
notifications are used in qualification. Production release, physical devices
and broader #117 notification/form-builder acceptance remain separate.
