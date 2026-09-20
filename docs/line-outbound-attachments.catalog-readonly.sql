-- Read-only review queries. Not executed by Codex.
begin transaction read only;

-- Include non-public schemas when checking whether an outbound table exists.
select n.nspname as schema_name, c.relname, c.relkind, c.relrowsecurity
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and c.relkind in ('r', 'p', 'v')
  and c.relname ~ '(staff_line|repair_message|line_outbound|tenant_line|owner_report_estimate)'
order by 1, 2;

select table_schema, table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('staff_line_pushes', 'repair_messages', 'tenant_line_attachments',
    'owner_report_estimate_files', 'repair_requests', 'tenant_accounts',
    'tenant_line_accounts', 'organization_members')
order by table_name, ordinal_position;

select n.nspname, c.relname, con.conname, pg_get_constraintdef(con.oid) as definition
from pg_catalog.pg_constraint con
join pg_catalog.pg_class c on c.oid = con.conrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('staff_line_pushes', 'repair_messages', 'tenant_line_attachments',
    'owner_report_estimate_files', 'repair_requests', 'tenant_accounts',
    'tenant_line_accounts', 'organization_members');

select schemaname, tablename, indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public' and tablename in
  ('repair_requests', 'tenant_accounts', 'tenant_line_accounts', 'organization_members', 'staff_line_pushes');

select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef, p.proconfig, p.proacl, pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('create_staff_reply_with_line_push', 'claim_staff_line_push', 'finish_staff_line_push');

select n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid) as definition
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname in ('public', 'storage');

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname in ('public', 'storage');

select table_schema, table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema in ('public', 'storage')
  and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');

select id, public, file_size_limit, allowed_mime_types from storage.buckets;
rollback;
