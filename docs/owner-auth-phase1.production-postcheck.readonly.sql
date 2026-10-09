-- Read-only catalog verification after a separately approved migration.
-- One result set; no Auth API calls, email values, or writes are performed.
with roles as (
  select rolname,oid,rolbypassrls from pg_catalog.pg_roles
  where rolname in ('anon','authenticated','service_role')
), operation_table as (
  select c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity
  from pg_catalog.pg_class c where c.oid=pg_catalog.to_regclass('public.owner_auth_operations')
), expected_columns(name,type_name,is_nullable,has_default) as (values
  ('id','uuid',false,true),
  ('organization_id','uuid',false,false),('owner_id','uuid',false,false),('request_id','uuid',false,false),
  ('operation_type','text',false,false),('requested_email','text',false,false),
  ('previous_auth_user_id','uuid',true,false),('target_auth_user_id','uuid',true,false),
  ('status','text',false,false),('actor_auth_user_id','uuid',false,false),('error_code','text',true,false),
  ('created_at','timestamp with time zone',false,true),('completed_at','timestamp with time zone',true,false)
), columns_check as (
  select e.name,e.type_name,e.is_nullable,e.has_default,a.attname is not null present,
    coalesce(pg_catalog.format_type(a.atttypid,a.atttypmod)=e.type_name,false) type_matches,
    coalesce((not a.attnotnull)=e.is_nullable,false) nullability_matches,
    coalesce(a.atthasdef=e.has_default,false) default_matches
  from expected_columns e
  left join pg_catalog.pg_attribute a on a.attrelid=(select oid from operation_table)
    and a.attname=e.name and a.attnum>0 and not a.attisdropped
), owner_email as (
  select a.atttypid='text'::regtype type_matches,not a.attnotnull nullable,
    not a.atthasdef no_default
  from pg_catalog.pg_attribute a
  where a.attrelid=pg_catalog.to_regclass('public.owners') and a.attname='email'
    and a.attnum>0 and not a.attisdropped
), unique_request as (
  select exists(select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_index i on i.indexrelid=c.conindid
    where c.conrelid=(select oid from operation_table) and c.contype='u' and c.convalidated
      and i.indisunique and i.indisvalid and i.indisready and i.indpred is null and i.indexprs is null
      and i.indnkeyatts=1 and i.indnatts=1
      and (select array_agg(a.attname::text order by k.ord)
        from unnest(c.conkey) with ordinality k(attnum,ord)
        join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)
        =array['request_id']::text[]) valid
), owner_scope_fk as (
  select exists(select 1 from pg_catalog.pg_constraint c
    where c.conrelid=pg_catalog.to_regclass('public.owner_auth_operations')
      and c.confrelid=pg_catalog.to_regclass('public.owners') and c.contype='f' and c.convalidated
      and (select array_agg(a.attname::text order by k.ord)
        from unnest(c.conkey) with ordinality k(attnum,ord)
        join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)
        =array['organization_id','owner_id']::text[]
      and (select array_agg(a.attname::text order by k.ord)
        from unnest(c.confkey) with ordinality k(attnum,ord)
        join pg_catalog.pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)
        =array['organization_id','id']::text[]) valid
), organization_fk as (
  select exists(select 1 from pg_catalog.pg_constraint c
    where c.conrelid=pg_catalog.to_regclass('public.owner_auth_operations')
      and c.confrelid=pg_catalog.to_regclass('public.organizations') and c.contype='f' and c.convalidated
      and (select array_agg(a.attname::text order by k.ord)
        from unnest(c.conkey) with ordinality k(attnum,ord)
        join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)
        =array['organization_id']::text[]
      and (select array_agg(a.attname::text order by k.ord)
        from unnest(c.confkey) with ordinality k(attnum,ord)
        join pg_catalog.pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)
        =array['id']::text[]) valid
), expected_index as (
  select exists(select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class idx on idx.oid=i.indexrelid
    join pg_catalog.pg_am am on am.oid=idx.relam
    where i.indrelid=(select oid from operation_table)
      and idx.relname='owner_auth_operations_org_owner_created_idx'
      and i.indisvalid and i.indisready and not i.indisunique and i.indpred is null and i.indexprs is null
      and i.indnkeyatts=3 and i.indnatts=3 and am.amname='btree'
      and (select array_agg(a.attname::text order by k.ord)
        from unnest(i.indkey) with ordinality k(attnum,ord)
        join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
        where k.ord<=i.indnkeyatts)=array['organization_id','owner_id','created_at']::text[]
      and exists(select 1 from unnest(i.indoption) with ordinality opt(option_bits,ord)
        where opt.ord=3 and (opt.option_bits & 1)=1)) valid
), guard_function as (
  select p.oid,p.prorettype='trigger'::regtype return_type_valid
  from pg_catalog.pg_proc p
  where p.oid=pg_catalog.to_regprocedure('public.guard_owner_auth_operation_identity()')
), audit_trigger as (
  select exists(select 1 from pg_catalog.pg_trigger t
    where t.tgrelid=(select oid from operation_table)
      and t.tgname='owner_auth_operations_guard_identity' and not t.tgisinternal
      and t.tgconstraint=0 and t.tgenabled='O' and t.tgtype=27
      and t.tgfoid=(select oid from guard_function)) valid
), table_acl as (
  select
    (select count(*)=3 from roles) roles_present,
    exists(select 1 from roles r where r.rolname='service_role' and r.rolbypassrls
      and pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'SELECT')
      and pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'INSERT')
      and pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'UPDATE')
      and not pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'DELETE')
      and not pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'TRUNCATE')
      and not pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'REFERENCES')
      and not pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'TRIGGER')
      and not pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'SELECT WITH GRANT OPTION')
      and not pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'INSERT WITH GRANT OPTION')
      and not pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'UPDATE WITH GRANT OPTION')
      and not pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'DELETE WITH GRANT OPTION')
      and not pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'TRUNCATE WITH GRANT OPTION')
      and not pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'REFERENCES WITH GRANT OPTION')
      and not pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),'TRIGGER WITH GRANT OPTION')) service_role_table_acl,
    not exists(select 1 from roles r cross join (values
      ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')
    ) p(privilege_name) where r.rolname in ('anon','authenticated')
      and pg_catalog.has_table_privilege(r.oid,(select oid from operation_table),p.privilege_name)) browser_table_acl,
    not exists(select 1 from pg_catalog.pg_attribute a
      where a.attrelid=(select oid from operation_table) and a.attnum>0 and not a.attisdropped
        and a.attacl is not null) no_column_acl,
    not exists(select 1 from roles r cross join pg_catalog.pg_attribute a cross join (values
      ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')
    ) p(privilege_name) where r.rolname in ('anon','authenticated')
      and a.attrelid=(select oid from operation_table) and a.attnum>0 and not a.attisdropped
      and pg_catalog.has_column_privilege(r.oid,a.attrelid,a.attnum,p.privilege_name)) browser_column_acl
), owner_repair_objects as (
  select
    pg_catalog.to_regprocedure('public.guard_repair_provenance()') is not null provenance_function,
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
  select 'owners_email' section,
    exists(select 1 from owner_email where type_matches and nullable and no_default) ready,
    jsonb_build_object('exists',exists(select 1 from owner_email),
      'type_text',coalesce((select type_matches from owner_email),false),
      'nullable',coalesce((select nullable from owner_email),false),
      'no_default',coalesce((select no_default from owner_email),false)) details
  union all
  select 'owner_auth_operations_columns',
    (select relkind='r' from operation_table)
      and coalesce((select bool_and(present and type_matches and nullability_matches and default_matches)
        from columns_check),false)
      and (select count(*)=13 from pg_catalog.pg_attribute a
        where a.attrelid=(select oid from operation_table) and a.attnum>0 and not a.attisdropped),
    jsonb_build_object('exists',pg_catalog.to_regclass('public.owner_auth_operations') is not null,
      'expected_column_count',13,
      'actual_column_count',(select count(*) from pg_catalog.pg_attribute a
        where a.attrelid=(select oid from operation_table) and a.attnum>0 and not a.attisdropped),
      'columns',(select jsonb_agg(jsonb_build_object('name',name,'present',present,'type_matches',type_matches,
        'nullable_matches',nullability_matches,'default_matches',default_matches) order by name) from columns_check))
  union all
  select 'owner_auth_operations_constraints',
    coalesce((select valid from unique_request),false)
      and coalesce((select valid from owner_scope_fk),false)
      and coalesce((select valid from organization_fk),false)
      and exists(select 1 from pg_catalog.pg_constraint c
        where c.conrelid=pg_catalog.to_regclass('public.owner_auth_operations')
          and c.conname='owner_auth_operations_target_required_check' and c.contype='c' and c.convalidated),
    jsonb_build_object('request_id_unique',coalesce((select valid from unique_request),false),
      'organization_owner_composite_fk',coalesce((select valid from owner_scope_fk),false),
      'organization_id_fk',coalesce((select valid from organization_fk),false),
      'pending_and_completed_require_target_auth',exists(select 1 from pg_catalog.pg_constraint c
        where c.conrelid=pg_catalog.to_regclass('public.owner_auth_operations')
          and c.conname='owner_auth_operations_target_required_check' and c.contype='c' and c.convalidated))
  union all
  select 'owner_auth_operations_index',coalesce((select valid from expected_index),false),
    jsonb_build_object('expected_btree_index',coalesce((select valid from expected_index),false))
  union all
  select 'owner_auth_operations_rls_policy',
    coalesce((select relrowsecurity and relforcerowsecurity from operation_table),false)
      and not exists(select 1 from pg_catalog.pg_policy p where p.polrelid=(select oid from operation_table)),
    jsonb_build_object('rls_enabled',coalesce((select relrowsecurity from operation_table),false),
      'rls_forced',coalesce((select relforcerowsecurity from operation_table),false),
      'no_policies',not exists(select 1 from pg_catalog.pg_policy p where p.polrelid=(select oid from operation_table)))
  union all
  select 'owner_auth_operations_acl',roles_present and service_role_table_acl and browser_table_acl
      and no_column_acl and browser_column_acl,
    jsonb_build_object('roles_present',roles_present,'service_role_select_insert_update_only',service_role_table_acl,
      'anon_authenticated_no_table_privileges',browser_table_acl,'no_column_acl_for_any_role',no_column_acl,
      'anon_authenticated_no_column_privileges',browser_column_acl)
  from table_acl
  union all
  select 'guard_function',exists(select 1 from guard_function where return_type_valid),
    jsonb_build_object('exists',exists(select 1 from guard_function),
      'returns_trigger',coalesce((select return_type_valid from guard_function),false))
  union all
  select 'guard_trigger',coalesce((select valid from audit_trigger),false),
    jsonb_build_object('target_table',pg_catalog.to_regclass('public.owner_auth_operations') is not null,
      'enabled_before_row_update_or_delete',coalesce((select valid from audit_trigger),false),
      'update_event',coalesce(exists(select 1 from pg_catalog.pg_trigger t
        where t.tgrelid=(select oid from operation_table) and t.tgname='owner_auth_operations_guard_identity'
          and (t.tgtype & 16)=16),false),
      'delete_event',coalesce(exists(select 1 from pg_catalog.pg_trigger t
        where t.tgrelid=(select oid from operation_table) and t.tgname='owner_auth_operations_guard_identity'
          and (t.tgtype & 8)=8),false),
      'insert_event',coalesce(exists(select 1 from pg_catalog.pg_trigger t
        where t.tgrelid=(select oid from operation_table) and t.tgname='owner_auth_operations_guard_identity'
          and (t.tgtype & 4)=4),false),
      'references_expected_guard_function',exists(select 1 from pg_catalog.pg_trigger t
        where t.tgrelid=(select oid from operation_table) and t.tgname='owner_auth_operations_guard_identity'
          and t.tgfoid=(select oid from guard_function)))
  union all
  select 'owner_repair_phase1_preserved',provenance_function and provenance_trigger and owner_repair_rpc
      and repair_requests_rls and repair_photos_rls and owner_key and property_key,
    jsonb_build_object('guard_repair_provenance_function',provenance_function,
      'guard_repair_provenance_trigger',provenance_trigger,'create_owner_repair_rpc',owner_repair_rpc,
      'repair_requests_rls',repair_requests_rls,'repair_photos_rls',repair_photos_rls,
      'owner_composite_key',owner_key,'property_composite_key',property_key)
  from owner_repair_objects
)
select section,ready as all_match,details from checks
union all
select 'overall',coalesce(bool_and(ready),false),jsonb_build_object('overall_ready',coalesce(bool_and(ready),false),
  'failed_sections',coalesce(jsonb_agg(section order by section) filter(where not ready),'[]'::jsonb))
from checks;