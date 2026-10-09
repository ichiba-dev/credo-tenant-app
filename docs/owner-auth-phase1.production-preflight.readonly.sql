-- Read-only catalog check before migration. Run as postgres.
-- One SELECT only. No Auth API calls, email values, or writes are performed.
with roles as (
  select rolname,oid,rolsuper,rolbypassrls
  from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role')
), required_relations(name) as (values
  ('organizations'),('owners'),('organization_members'),('properties'),('property_owners'),('repair_requests'),('repair_photos')
), relation_checks as (
  select r.name,coalesce(c.relkind in ('r','p'),false) present
  from required_relations r
  left join pg_catalog.pg_class c on c.oid=pg_catalog.to_regclass('public.'||r.name)
), required_columns(table_name,column_name,type_name) as (values
  ('organizations','id','uuid'),
  ('owners','id','uuid'),('owners','organization_id','uuid'),('owners','auth_user_id','uuid'),('owners','name','text'),('owners','is_active','boolean'),
  ('organization_members','organization_id','uuid'),('organization_members','auth_user_id','uuid'),
  ('organization_members','role',null),('organization_members','is_active','boolean'),
  ('properties','id','uuid'),('properties','organization_id','uuid'),('properties','name','text'),('properties','is_active','boolean'),
  ('property_owners','organization_id','uuid'),('property_owners','owner_id','uuid'),('property_owners','property_id','uuid'),
  ('property_owners','is_active','boolean'),('property_owners','valid_from','date'),('property_owners','valid_to','date')
), column_checks as (
  select e.table_name,e.column_name,e.type_name,a.attname is not null present,
    e.type_name is null or pg_catalog.format_type(a.atttypid,a.atttypmod)=e.type_name type_matches
  from required_columns e
  left join pg_catalog.pg_attribute a on a.attrelid=pg_catalog.to_regclass('public.'||e.table_name)
    and a.attname=e.column_name and a.attnum>0 and not a.attisdropped
), owner_email_column as (
  select a.atttypid='text'::regtype valid
  from pg_catalog.pg_attribute a
  where a.attrelid=pg_catalog.to_regclass('public.owners') and a.attname='email'
    and a.attnum>0 and not a.attisdropped
), owner_scope_key as (
  select exists(select 1 from pg_catalog.pg_index i
    where i.indrelid=pg_catalog.to_regclass('public.owners') and i.indisunique and i.indisvalid
      and i.indisready and i.indimmediate and i.indpred is null and i.indexprs is null
      and (select array_agg(a.attname::text order by k.ord)
        from unnest(i.indkey) with ordinality k(attnum,ord)
        join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
        where k.ord<=i.indnkeyatts)=array['organization_id','id']::text[]) valid
), organization_id_key as (
  select exists(select 1 from pg_catalog.pg_index i
    where i.indrelid=pg_catalog.to_regclass('public.organizations') and i.indisunique and i.indisvalid
      and i.indisready and i.indimmediate and i.indpred is null and i.indexprs is null
      and (select array_agg(a.attname::text order by k.ord)
        from unnest(i.indkey) with ordinality k(attnum,ord)
        join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
        where k.ord<=i.indnkeyatts)=array['id']::text[]) valid
), planned_objects as (
  select pg_catalog.to_regclass('public.owner_auth_operations') is not null table_collision,
    pg_catalog.to_regclass('public.owner_auth_operations_org_owner_created_idx') is not null index_collision,
    exists(select 1 from pg_catalog.pg_trigger t
      where t.tgrelid=pg_catalog.to_regclass('public.owner_auth_operations')
        and t.tgname='owner_auth_operations_guard_identity' and not t.tgisinternal) trigger_collision,
    exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='guard_owner_auth_operation_identity') function_collision
), owner_repair_objects as (
  select exists(select 1 from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure('public.guard_repair_provenance()')) provenance_function,
    exists(select 1 from pg_catalog.pg_trigger t
      where t.tgrelid=pg_catalog.to_regclass('public.repair_requests')
        and t.tgname='guard_repair_provenance' and not t.tgisinternal and t.tgenabled<>'D'
        and t.tgfoid=pg_catalog.to_regprocedure('public.guard_repair_provenance()')) provenance_trigger,
    pg_catalog.to_regprocedure('public.create_owner_repair(uuid,text,text,text,text,text)') is not null owner_repair_rpc,
    coalesce((select c.relrowsecurity from pg_catalog.pg_class c
      where c.oid=pg_catalog.to_regclass('public.repair_requests')),false) repair_requests_rls,
    coalesce((select c.relrowsecurity from pg_catalog.pg_class c
      where c.oid=pg_catalog.to_regclass('public.repair_photos')),false) repair_photos_rls,
    exists(select 1 from pg_catalog.pg_constraint c
      where c.conrelid=pg_catalog.to_regclass('public.owners') and c.conname='owner_repair_owner_org_key'
        and c.contype='u' and c.convalidated) owner_key,
    exists(select 1 from pg_catalog.pg_constraint c
      where c.conrelid=pg_catalog.to_regclass('public.properties') and c.conname='owner_repair_property_org_key'
        and c.contype='u' and c.convalidated) property_key
), checks as (
  select 'required_schema' section,
    (select bool_and(present) from relation_checks)
      and (select bool_and(present and type_matches) from column_checks)
      and (select count(*)=3 from roles)
      and exists(select 1 from roles where rolname='service_role' and rolbypassrls)
      and exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) ready,
    jsonb_build_object('relations',(select jsonb_agg(jsonb_build_object('name',name,'present',present) order by name) from relation_checks),
      'columns',(select jsonb_agg(jsonb_build_object('table',table_name,'name',column_name,'present',present,'type_matches',type_matches) order by table_name,column_name) from column_checks),
      'admin_manager_authorization','organization_members columns are present; admin/manager allowlist is enforced by server actions',
      'service_role_server_only','server-side application contract; database preflight verifies role characteristics only',
      'api_roles',(select jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'bypass_rls',rolbypassrls) order by rolname) from roles)) details
  union all
  select 'owners_email',coalesce((select bool_and(valid) from owner_email_column),true),
    jsonb_build_object('exists',exists(select 1 from owner_email_column),
      'valid_text_type',coalesce((select bool_and(valid) from owner_email_column),false),
      'missing_column_is_expected_before_migration',not exists(select 1 from owner_email_column))
  union all
  select 'planned_object_collisions',not table_collision and not index_collision and not trigger_collision and not function_collision,
    jsonb_build_object('owner_auth_operations_table',table_collision,
      'planned_index',index_collision,'planned_trigger',trigger_collision,
      'planned_function_name',function_collision,'planned_rpc_count',0)
  from planned_objects
  union all
  select 'organization_keys',coalesce((select valid from owner_scope_key),false)
      and coalesce((select valid from organization_id_key),false),
    jsonb_build_object('owners_organization_id_id_key',coalesce((select valid from owner_scope_key),false),
      'organizations_id_key',coalesce((select valid from organization_id_key),false),
      'owner_auth_operations_fk_target','owners(organization_id,id)')
  union all
  select 'owner_repair_phase1_preserved',provenance_function and provenance_trigger and owner_repair_rpc
      and repair_requests_rls and repair_photos_rls and owner_key and property_key,
    jsonb_build_object('guard_repair_provenance_function',provenance_function,
      'guard_repair_provenance_trigger',provenance_trigger,'create_owner_repair_rpc',owner_repair_rpc,
      'repair_requests_rls',repair_requests_rls,'repair_photos_rls',repair_photos_rls,
      'owner_composite_key',owner_key,'property_composite_key',property_key,
      'owner_auth_migration_mutates_owner_repair_objects',false)
  from owner_repair_objects
)
select section,ready as all_match,details from checks
union all
select 'overall',bool_and(ready),jsonb_build_object('overall_ready',bool_and(ready),
  'failed_sections',coalesce(jsonb_agg(section order by section) filter(where not ready),'[]'::jsonb))
from checks;