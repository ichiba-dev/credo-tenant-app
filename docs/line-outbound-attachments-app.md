# Outbound LINE attachment application setup

The application code requires `docs/line-outbound-attachments.migration.sql` and
the private `staff-line-files` bucket before sending. Do not enable it in a
hosted environment until the migration, bucket, access review, and end-to-end
checks are complete.

Server-only environment variables:

- `SUPABASE_SERVICE_ROLE_KEY`: existing server credential. Never expose it to the browser.
- `OUTBOUND_PAYLOAD_KEY_V1`: base64 encoding of a random 32-byte AES-256 key.
- `OUTBOUND_TOKEN_SECRET`: base64 encoding of a separate random 32-byte HMAC key.
- `OUTBOUND_PUBLIC_BASE_URL`: the public HTTPS origin of CREDO, without a path.
- `LINE_CHANNEL_ACCESS_TOKEN`: existing LINE server credential.

Keep both outbound keys stable across deployments and all server instances.
The token secret reproduces the same PDF bearer token on an operation retry;
the payload key decrypts the exact payload already frozen in the push row.
Rotating either key requires a versioned migration and a plan for live pushes.

The admin upload route accepts a same-origin multipart request. Service Role
uploads staging, final, and preview objects with `upsert: false`, reads them
back to verify bytes, then finalizes the DB row. A signed image URL is checked
without an Authorization header before LINE push. A generated PDF bearer token
is represented in the DB only by its SHA-256 digest. Its public CREDO route
checks the digest, expiry, revocation, PDF readiness, and tenant scope before
creating a two-minute private Storage URL.

Operational checks before production:

- Apply the schema and create the private bucket with its size/MIME limits.
- Confirm no broad `storage.objects` policy grants browser access to the bucket.
- Set the public HTTPS origin and verify that LINE can retrieve signed image URLs.
- Verify LINE's accepted, unknown, and retry responses with a real test account.
- Suppress bearer tokens in reverse-proxy access logs for the PDF route.
- Arrange cleanup for abandoned staging objects and expired attachment files.
- Plan delivery retries for pushes left `unknown` after the request ends.
