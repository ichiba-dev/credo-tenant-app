-- Run as postgres BEFORE migration. One read-only SELECT; no production mutation.
-- Validates catalog prerequisites, not the body/semantics of the existing role helper.
with required_columns(table_name,column_name,type_name,not_null) as (values
 ('organizations','id','uuid',true),
 ('repair_requests','organization_id','uuid',true),('repair_requests','id','bigint',true),
 ('repair_vendor_dispatches','organization_id','uuid',true),('repair_vendor_dispatches','repair_request_id','bigint',true),
 ('repair_vendor_dispatches','id','uuid',true),
 ('organization_members','organization_id','uuid',true),('organization_members','auth_user_id','uuid',true),
 ('organization_members','role','text',true),('organization_members','is_active','boolean',true)
), column_checks as (
 select e.*,coalesce(pg_catalog.format_type(a.atttypid,a.atttypmod)=e.type_name and a.attnotnull=e.not_null,false) matches
 from required_columns e left join pg_catalog.pg_attribute a on a.attrelid=to_regclass('public.'||e.table_name)
  and a.attname=e.column_name and a.attnum>0 and not a.attisdropped
), required_keys(item,table_name,names) as (values
 ('organization FK','organizations',array['id']),
 ('repair FK','repair_requests',array['organization_id','id']),
 ('dispatch FK','repair_vendor_dispatches',array['organization_id','repair_request_id','id']),
 ('creator membership FK','organization_members',array['organization_id','auth_user_id'])
), keys as (
 select e.*,exists(select 1 from pg_catalog.pg_index i where i.indrelid=to_regclass('public.'||e.table_name)
  and i.indisunique and i.indisvalid and i.indisready and i.indimmediate and i.indpred is null and i.indexprs is null
  and array(select a.attname::text from unnest(i.indkey) with ordinality u(n,o)
   join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=u.n
   where u.o<=i.indnkeyatts order by u.o)=e.names) matches from required_keys e
), relations as (
 select e.name,c.oid,c.relrowsecurity,c.relkind from
 (values('organizations'),('repair_requests'),('repair_vendor_dispatches'),('organization_members')) e(name)
 left join pg_catalog.pg_class c on c.oid=to_regclass('public.'||e.name)
), planned(kind,name) as (values
 ('relation','calendar_events'),('relation','calendar_events_pkey'),
 ('relation','calendar_events_org_start_idx'),('relation','calendar_events_repair_idx'),
 ('type','calendar_events'),('function','calendar_events_guard'),('trigger','calendar_events_guard'),
 ('policy','calendar_events_read'),('policy','calendar_events_insert'),('policy','calendar_events_update'),
 ('constraint','calendar_events_pkey'),('constraint','calendar_events_organization_id_fkey'),
 ('constraint','calendar_events_title_check'),('constraint','calendar_events_event_type_check'),
 ('constraint','calendar_events_starts_at_check'),('constraint','calendar_events_ends_at_check'),
 ('constraint','calendar_events_status_check'),('constraint','calendar_events_notes_check'),
 ('constraint','calendar_events_source_type_check'),('constraint','calendar_events_repair_fk'),
 ('constraint','calendar_events_dispatch_fk'),('constraint','calendar_events_creator_fk'),
 ('constraint','calendar_events_source_ck'),('constraint','calendar_events_all_day_ck')
), collisions as (
 select p.*,case kind
 when 'relation' then to_regclass('public.'||name) is not null
 when 'type' then to_regtype('public.'||name) is not null
 when 'function' then exists(select 1 from pg_catalog.pg_proc where pronamespace='public'::regnamespace and proname=p.name)
 when 'trigger' then exists(select 1 from pg_catalog.pg_trigger where tgname=p.name)
 when 'policy' then exists(select 1 from pg_catalog.pg_policies where policyname=p.name)
 else exists(select 1 from pg_catalog.pg_constraint where conname=p.name) end collision from planned p
), helpers as (
 select to_regprocedure('auth.uid()') is not null auth_uid_exists,
  to_regprocedure('gen_random_uuid()') is not null uuid_generator_exists,
  exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure('private.has_org_role(uuid,text[])')
   and prorettype='boolean'::regtype and prosecdef) role_helper_security_definer,
  coalesce(has_function_privilege('authenticated',to_regprocedure('private.has_org_role(uuid,text[])'),'EXECUTE'),false) role_helper_executable,
  coalesce(has_schema_privilege('authenticated',to_regnamespace('private'),'USAGE'),false) private_schema_usage
), role_checks as (
 select e.name,r.oid is not null role_exists,coalesce(not r.rolsuper and not r.rolbypassrls,false) respects_rls
 from (values('anon'),('authenticated'))e(name) left join pg_catalog.pg_roles r on r.rolname=e.name
), sections(seq,item,all_match,details) as (
 select 1,'object collisions',not bool_or(collision),jsonb_agg(to_jsonb(c)) from collisions c
 union all select 2,'required columns',bool_and(matches),jsonb_agg(to_jsonb(c)) from column_checks c
 union all select 3,'existing relations and RLS',bool_and(oid is not null and relkind='r' and relrowsecurity),jsonb_agg(to_jsonb(r)) from relations r
 union all select 4,item,matches,to_jsonb(k) from keys k where item='organization FK'
 union all select 5,item,matches,to_jsonb(k) from keys k where item='repair FK'
 union all select 6,item,matches,to_jsonb(k) from keys k where item='dispatch FK'
 union all select 7,item,matches,to_jsonb(k) from keys k where item='creator membership FK'
 union all select 8,'auth and RLS helper prerequisites',auth_uid_exists and uuid_generator_exists and role_helper_security_definer and role_helper_executable and private_schema_usage,to_jsonb(h) from helpers h
 union all select 9,'browser roles respect RLS',bool_and(role_exists and respects_rls),jsonb_agg(to_jsonb(r)) from role_checks r
), report as (
 select seq,item,jsonb_build_object('all_match',coalesce(all_match,false),'details',details) result from sections
 union all select 10,'overall readiness',jsonb_build_object('overall_ready',bool_and(coalesce(all_match,false))) from sections
)
select item,result from report order by seq;
