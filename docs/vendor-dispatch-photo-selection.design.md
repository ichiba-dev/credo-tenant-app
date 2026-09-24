# Vendor dispatch photo selection: migration plan

The migration in `vendor-dispatch-photo-selection.migration.sql` adds immutable
attachment references and `confirm_vendor_dispatch_manual_v2`. The existing
`confirm_vendor_dispatch_manual` remains unchanged for deployed clients.
Apply the migration before deploying the updated app, since the new app reads
the attachment table and calls v2.

`repair_vendor_dispatch_message_attachments` stores the organization, message,
dispatch, repair, source type, source ID, order and creation time. The migration
preserves existing bigint `repair_photos.id` values and their identity generator;
there is no ID conversion or backfill. Photo IDs travel as decimal strings in
JSON to preserve bigint precision; LINE attachment IDs remain UUIDs.
No file is copied. A legacy photo uses only the
stable key `repair_request:<id>`; the signed or public URL is never stored in
the history. Resolve a fresh scoped URL when a future delivery path needs one.

Composite foreign keys bind the message, dispatch and source to the same
organization and repair, preventing reassignment or NULL unassignment after
the source is referenced. `repair_photos.repair_id` remains nullable for
unselected photos.
An insert trigger also checks that each source belongs to the dispatch's repair
and that LINE attachments are images. Source CHECK constraints and partial
unique indexes reject mixed or duplicate references. UPDATE and DELETE are
blocked by the existing immutable trigger function.

The v2 RPC validates ordered JSON photo references, locks the request ID,
inserts the message and attachments, then calls the existing transition RPC.
Any error rolls back all four effects. A retry compares body, recipient and
ordered selections before returning the original message.

Run `vendor-dispatch-photo-selection.production-preflight.readonly.sql` in the
production SQL Editor before applying the migration. Confirm the report and
record the existing schema before deployment. Local SQL regression uses
`docs/test-fixtures/vendor-dispatch-photo-selection.local.mjs` with
PGlite installed outside the repository in a temporary directory. Vendor LINE
delivery remains a separate future change: it needs per-photo delivery states
and provider result handling.

Immediately after migration and before v2 use, run
`vendor-dispatch-photo-selection.production-postcheck.readonly.sql`. Its 12 rows
check 11 sections and overall readiness, including zero attachments and false
markers on existing messages. Photo ID preservation requires comparison with a
pre-migration ID snapshot; matching counts alone cannot prove it.
