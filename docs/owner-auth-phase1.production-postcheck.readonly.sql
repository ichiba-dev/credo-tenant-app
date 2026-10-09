-- Read-only catalog/data verification after a separately approved migration.
-- Does not call Auth APIs, output email addresses, or modify production.
with roles as (
  select rolname, oid, rolsuper, rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role')
), operation_table as (
  select c.oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c where c.oid = to_regclass('public.owner_auth_operations')
), expected_columns(name) as (values
  ('id'),('organization_id'),('owner_id'),('request_id'),('operation_type'),('requested_email'),
  ('previous_auth_user_id'),('target_auth_user_id'),('status'),('actor_auth_user_id'),('error_code'),('created_at'),('completed_at')
), columns_check as (
  select e.name, a.attname is not null present from expected_columns e
  left join pg_attribute a on a.attrelid=(select oid from operation_table) and a.attname=e.name
    and a.attnum > 0 and not a.attisdropped
), unique_request as (
  select exists (
    select 1 from pg_index i where i.indrelid=(select oid from operation_table)
      and i.indisunique and i.indisvalid and i.indisready and i.indpred is null and i.indexprs is null
      and (select array_agg(a.attname::text order by k.ord)
        from unnest(i.indkey) with ordinality k(attnum,ord)
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
        where k.ord <= i.indnkeyatts) = array['request_id']::text[]
  ) valid
), audit_trigger as (
  select exists(select 1 from pg_trigger t where t.tgrelid=(select oid from operation_table)
    and t.tgname='owner_auth_operations_guard_identity' and not t.tgisinternal and t.tgenabled <> 'D'
    and t.tgfoid=to_regprocedure('public.guard_owner_auth_operation_identity()')) valid
), owner_scope_fk as (
  select exists(select 1 from pg_constraint c where c.conrelid=to_regclass('public.owner_auth_operations')
    and c.confrelid=to_regclass('public.owners') and c.contype='f' and c.convalidated
    and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum,ord)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)=array['organization_id','owner_id']::text[]
    and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum,ord)
      join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)=array['organization_id','id']::text[]) valid
), checks as (
  select 'owner_email_column' section, exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.owners')
    and a.attname='email' and a.atttypid='text'::regtype and a.attnum>0 and not a.attisdropped) ready,
    jsonb_build_object('email_column_text',exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.owners')
      and a.attname='email' and a.atttypid='text'::regtype and a.attnum>0 and not a.attisdropped)) details
  union all
  select 'audit_table', (select relkind='r' and relrowsecurity and relforcerowsecurity from operation_table)
      and (select bool_and(present) from columns_check),
    jsonb_build_object('exists',to_regclass('public.owner_auth_operations') is not null,
      'rls_enabled',(select relrowsecurity from operation_table),'rls_forced',(select relforcerowsecurity from operation_table),
      'columns',(select jsonb_agg(jsonb_build_object('name',name,'present',present) order by name) from columns_check))
  union all
  select 'owner_organization_scope_fk',coalesce((select valid from owner_scope_fk),false),
    jsonb_build_object('organization_owner_composite_fk',coalesce((select valid from owner_scope_fk),false))
  union all
  select 'request_id_idempotency',coalesce((select valid from unique_request),false),
    jsonb_build_object('unique_request_id',coalesce((select valid from unique_request),false))
  union all
  select 'target_auth_required',exists(select 1 from pg_constraint c
    where c.conrelid=to_regclass('public.owner_auth_operations') and c.conname='owner_auth_operations_target_required_check'
      and c.contype='c' and c.convalidated),
    jsonb_build_object('pending_and_completed_require_target_auth',exists(select 1 from pg_constraint c
      where c.conrelid=to_regclass('public.owner_auth_operations') and c.conname='owner_auth_operations_target_required_check'
        and c.contype='c' and c.convalidated))
  union all
  select 'audit_guard',coalesce((select valid from audit_trigger),false),
    jsonb_build_object('immutable_identity_trigger_enabled',coalesce((select valid from audit_trigger),false))
  union all
  select 'service_role_only',
    exists(select 1 from roles where rolname='service_role' and rolbypassrls
      and has_table_privilege(oid,'public.owner_auth_operations','SELECT')
      and has_table_privilege(oid,'public.owner_auth_operations','INSERT')
      and has_table_privilege(oid,'public.owner_auth_operations','UPDATE')
      and not has_table_privilege(oid,'public.owner_auth_operations','DELETE')
      and not has_table_privilege(oid,'public.owner_auth_operations','TRUNCATE')
      and not has_table_privilege(oid,'public.owner_auth_operations','REFERENCES')
      and not has_table_privilege(oid,'public.owner_auth_operations','TRIGGER')
      and not has_table_privilege(oid,'public.owner_auth_operations','SELECT WITH GRANT OPTION')
      and not has_table_privilege(oid,'public.owner_auth_operations','INSERT WITH GRANT OPTION')
      and not has_table_privilege(oid,'public.owner_auth_operations','UPDATE WITH GRANT OPTION'))
    and not exists(select 1 from roles where rolname in ('anon','authenticated') and
      (has_table_privilege(oid,'public.owner_auth_operations','SELECT') or has_table_privilege(oid,'public.owner_auth_operations','INSERT')
       or has_table_privilege(oid,'public.owner_auth_operations','UPDATE') or has_table_privilege(oid,'public.owner_auth_operations','DELETE')
       or has_table_privilege(oid,'public.owner_auth_operations','TRUNCATE') or has_table_privilege(oid,'public.owner_auth_operations','REFERENCES')
       or has_table_privilege(oid,'public.owner_auth_operations','TRIGGER')
       or has_table_privilege(oid,'public.owner_auth_operations','SELECT WITH GRANT OPTION')
       or has_table_privilege(oid,'public.owner_auth_operations','INSERT WITH GRANT OPTION')
       or has_table_privilege(oid,'public.owner_auth_operations','UPDATE WITH GRANT OPTION')
       or exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.owner_auth_operations')
         and a.attnum>0 and not a.attisdropped and
         (has_column_privilege(oid,a.attrelid,a.attnum,'SELECT') or has_column_privilege(oid,a.attrelid,a.attnum,'INSERT')
          or has_column_privilege(oid,a.attrelid,a.attnum,'UPDATE') or has_column_privilege(oid,a.attrelid,a.attnum,'REFERENCES'))))),
    jsonb_build_object('roles',(select jsonb_agg(jsonb_build_object('name',rolname,
      'select',has_table_privilege(oid,'public.owner_auth_operations','SELECT'),
      'insert',has_table_privilege(oid,'public.owner_auth_operations','INSERT'),
      'update',has_table_privilege(oid,'public.owner_auth_operations','UPDATE'),
      'delete',has_table_privilege(oid,'public.owner_auth_operations','DELETE')) order by rolname) from roles))
)
select section,ready as all_match,details from checks
union all
select 'overall',bool_and(ready),jsonb_build_object('overall_ready',bool_and(ready),
  'failed_sections',coalesce(jsonb_agg(section order by section) filter(where not ready),'[]'::jsonb)) from checks;