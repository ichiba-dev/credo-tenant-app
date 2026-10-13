-- SELECT only. Does not expose request hashes, tokens, or secrets.
select e.name,to_regclass('public.'||e.name) is not null as exists
from (values ('organizations'),('organization_members'),('repair_requests'),('repair_vendor_dispatches'),('repair_vendors'),('vendor_quote_versions'),('vendor_quote_lines'),('vendor_quote_files'),('vendor_quote_uploads'),('owner_reports'),('owner_report_estimate_files')) e(name);
select table_name,column_name,data_type from information_schema.columns where table_schema='public' and
 ((table_name='organizations' and column_name in ('id','name')) or (table_name='owner_reports' and column_name in ('id','organization_id','repair_request_id','estimated_amount')) or
 (table_name='owner_report_estimate_files' and column_name in ('id','organization_id','owner_report_id','repair_request_id','storage_path','original_filename','mime_type','file_size','sort_order','uploaded_by','deleted_at')));
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id in ('vendor-quotes','owner-estimates');
select p.oid::regprocedure::text as signature,p.prosecdef,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('prepare_vendor_quote_upload','record_vendor_quote_revision');
select to_regclass('public.vendor_quote_requests') is null as request_table_name_available,
 not exists(select 1 from information_schema.columns where table_schema='public' and table_name='owner_report_estimate_files' and column_name='source_vendor_quote_id') as source_column_available;
