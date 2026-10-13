-- SELECT only. Safe metadata and aggregate counts; no tokens or hashes.
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='vendor_quote_requests';
select role_name,has_table_privilege(role_name,'public.vendor_quote_requests','SELECT') can_select,
 has_table_privilege(role_name,'public.vendor_quote_requests','INSERT') can_insert,
 has_table_privilege(role_name,'public.vendor_quote_requests','UPDATE') can_update,
 has_table_privilege(role_name,'public.vendor_quote_requests','DELETE') can_delete
from (values ('anon'),('authenticated'),('service_role')) r(role_name);
select p.oid::regprocedure::text as signature,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('issue_vendor_quote_request','revoke_vendor_quote_request','inspect_vendor_quote_request','prepare_requested_vendor_quote','submit_requested_vendor_quote','publish_vendor_quote_to_owner');
select status,count(*) as requests,count(*) filter(where expires_at<=now() and status='pending') as expired_pending from public.vendor_quote_requests group by status;
select count(*) as relationship_mismatch from public.vendor_quote_requests r left join public.repair_vendor_dispatches d on d.organization_id=r.organization_id and d.id=r.vendor_dispatch_id
where d.id is null or d.repair_request_id<>r.repair_request_id or d.vendor_id<>r.vendor_id;
select indexname,indexdef from pg_indexes where schemaname='public' and indexname in ('vendor_quote_requests_one_pending','owner_estimate_vendor_quote_once');
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id in ('vendor-quotes','owner-estimates');
