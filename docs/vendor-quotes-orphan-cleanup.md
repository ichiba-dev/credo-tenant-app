# vendor-quotes orphan cleanup

An upload reservation is created before a signed upload URL is issued. A browser may upload a PDF and then close before finalize. The database cannot atomically roll back a Storage upload, so the uploaded object can remain without a `vendor_quote_files` row.

Run the read-only query below daily with an administrative database role. It lists objects that have no committed quote and whose reservation expired at least 24 hours ago. Objects without a matching reservation are also listed after 24 hours. The 24-hour delay protects in-flight uploads and retries. Review the output and confirm the exact bucket, object name, age, and absence of a matching `vendor_quote_files` row immediately before deletion.

```sql
select o.id, o.name, o.created_at, u.request_id, u.expires_at
from storage.objects o
left join public.vendor_quote_uploads u
  on o.bucket_id = 'vendor-quotes'
 and o.name = u.organization_id::text || '/' || u.repair_request_id::text || '/'
   || u.dispatch_id::text || '/' || u.quote_id::text || '/' || u.file_id::text || '.pdf'
where o.bucket_id = 'vendor-quotes'
  and o.created_at < clock_timestamp() - interval '24 hours'
  and (u.request_id is null or u.expires_at < clock_timestamp() - interval '24 hours')
  and not exists (select 1 from public.vendor_quote_files f
    where f.storage_path = o.name);
```

Use the Storage API with a service role to remove only reviewed paths. Do not delete directly from `storage.objects`; that leaves the underlying file behind. Process one object at a time, log its path, reservation ID, decision, operator, timestamp, and Storage API result, and rerun the query afterward. If a reservation has a committed quote or the database is unavailable, retain the object and investigate. Retain reservation rows for audit and request-id uniqueness; this procedure removes only orphan objects. Alert an operator if the daily candidate count grows or deletion fails; retry only after repeating the database check.
