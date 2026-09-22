-- Supabase SQL Editor: single read-only SELECT before applying
-- vendor-dispatch-messaging.migration.sql.
with expected_relations(name) as (values
  ('repair_vendor_dispatch_messages'),
  ('repair_vendor_dispatch_messages_pkey'),
  ('vendor_dispatch_messages_org_id_uq'),
  ('vendor_dispatch_messages_request_uq'),
  ('repair_vendor_dispatch_messages_timeline_idx')
), collisions as (
  select e.name,to_regclass('public.'||e.name) as object_oid from expected_relations e
), rpc_overloads as (
  select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,
    p.prosecdef,p.proacl
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='confirm_vendor_dispatch_manual'
), prerequisite_relations(name) as (values
  ('repair_vendor_dispatches'),('repair_vendor_dispatch_events'),
  ('repair_vendors'),('organization_members')
), prerequisite_catalog as (
  select e.name,c.oid,c.relkind,c.relrowsecurity
  from prerequisite_relations e
  left join pg_catalog.pg_namespace n on n.nspname='public'
  left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=e.name
    and c.relkind in ('r','p')
), expected_columns(ord,table_name,column_name,expected_type,expected_not_null) as (values
  (1,'repair_vendor_dispatches','id','uuid',true),
  (2,'repair_vendor_dispatches','organization_id','uuid',true),
  (3,'repair_vendor_dispatches','repair_request_id','bigint',true),
  (4,'repair_vendor_dispatches','vendor_id','uuid',true),
  (5,'repair_vendor_dispatches','status','text',true),
  (6,'repair_vendor_dispatches','transition_request_id','uuid',false),
  (7,'repair_vendors','id','uuid',true),
  (8,'repair_vendors','organization_id','uuid',true),
  (9,'repair_vendors','company_name','text',true),
  (10,'repair_vendors','contact_name','text',true),
  (11,'repair_vendors','phone','text',false),
  (12,'repair_vendors','email','text',false),
  (13,'organization_members','organization_id','uuid',true),
  (14,'organization_members','auth_user_id','uuid',true),
  (15,'organization_members','is_active','boolean',true),
  (16,'organization_members','role','text',true)
), column_catalog as (
  select e.*,a.attnum,pg_catalog.format_type(a.atttypid,a.atttypmod) actual_type,
    a.attnotnull actual_not_null
  from expected_columns e
  left join pg_catalog.pg_namespace n on n.nspname='public'
  left join pg_catalog.pg_class c on c.relnamespace=n.oid
    and c.relname=e.table_name and c.relkind in ('r','p')
  left join pg_catalog.pg_attribute a on a.attrelid=c.oid
    and a.attname=e.column_name and a.attnum>0 and not a.attisdropped
), report(seq,item,result) as (
  select 1,'planned object collisions',jsonb_build_object(
    'safe_to_create',bool_and(object_oid is null)
      and not exists(select 1 from rpc_overloads)
      and not exists(select 1 from pg_catalog.pg_trigger where tgname='vendor_dispatch_messages_immutable')
      and not exists(select 1 from pg_catalog.pg_policies
        where schemaname='public' and policyname='repair_vendor_dispatch_messages_staff_read'),
    'relations',jsonb_object_agg(name,to_jsonb(object_oid::text)),
    'rpc_overloads',coalesce((select jsonb_agg(jsonb_build_object(
      'schema',nspname,'name',proname,'arguments',arguments,'security_definer',prosecdef,'acl',proacl))
      from rpc_overloads),'[]'::jsonb),
    'same_name_triggers',coalesce((select jsonb_agg(jsonb_build_object(
      'table',t.tgrelid::regclass::text,'name',t.tgname)) from pg_catalog.pg_trigger t
      where not t.tgisinternal and t.tgname='vendor_dispatch_messages_immutable'),'[]'::jsonb),
    'same_name_policies',coalesce((select jsonb_agg(jsonb_build_object(
      'schema',schemaname,'table',tablename,'name',policyname)) from pg_catalog.pg_policies
      where policyname='repair_vendor_dispatch_messages_staff_read'),'[]'::jsonb)
  ) from collisions

  union all
  select 2,'Phase1 prerequisite relations',jsonb_build_object(
    'all_exist',bool_and(oid is not null),
    'relations',jsonb_agg(jsonb_build_object('name',name,'exists',oid is not null,
      'kind',relkind,'rls_enabled',relrowsecurity) order by name)
  ) from prerequisite_catalog

  union all
  select 3,'prerequisite functions and ACL',jsonb_build_object(
    'all_match',to_regprocedure(
      'public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)') is not null
      and coalesce((select p.prosecdef from pg_catalog.pg_proc p where p.oid=
        to_regprocedure('public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)')),false)
      and coalesce(has_function_privilege('authenticated',to_regprocedure(
        'public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)'),'execute'),false)
      and not coalesce(has_function_privilege('anon',to_regprocedure(
        'public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)'),'execute'),false)
      and not coalesce(has_function_privilege('service_role',to_regprocedure(
        'public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)'),'execute'),false)
      and to_regprocedure('public._vendor_phase1_no_change()') is not null
      and to_regprocedure('private.has_org_role(uuid,text[])') is not null,
    'transition_exists',to_regprocedure(
      'public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)') is not null,
    'transition_security_definer',coalesce((select p.prosecdef from pg_catalog.pg_proc p where p.oid=
      to_regprocedure('public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)')),false),
    'transition_authenticated_execute',coalesce(has_function_privilege('authenticated',
      to_regprocedure('public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)'),'execute'),false),
    'transition_anon_execute',coalesce(has_function_privilege('anon',
      to_regprocedure('public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)'),'execute'),false),
    'transition_service_role_execute',coalesce(has_function_privilege('service_role',
      to_regprocedure('public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)'),'execute'),false),
    'transition_acl_matches_expected',
      coalesce(has_function_privilege('authenticated',to_regprocedure(
        'public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)'),'execute'),false)
      and not coalesce(has_function_privilege('anon',to_regprocedure(
        'public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)'),'execute'),false)
      and not coalesce(has_function_privilege('service_role',to_regprocedure(
        'public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)'),'execute'),false),
    'immutable_guard_exists',to_regprocedure('public._vendor_phase1_no_change()') is not null,
    'role_helper_exists',to_regprocedure('private.has_org_role(uuid,text[])') is not null)

  union all
  select 4,'composite key prerequisites',jsonb_build_object(
    'all_match',exists(select 1 from pg_catalog.pg_constraint k
      where k.conrelid=to_regclass('public.repair_vendor_dispatches') and k.contype in ('p','u')
        and pg_get_constraintdef(k.oid) like '%(organization_id, id)%')
      and exists(select 1 from pg_catalog.pg_constraint k
      where k.conrelid=to_regclass('public.organization_members') and k.contype in ('p','u')
        and pg_get_constraintdef(k.oid) like '%(organization_id, auth_user_id)%'),
    'dispatch_org_id_unique',exists(select 1 from pg_catalog.pg_constraint k
      where k.conrelid=to_regclass('public.repair_vendor_dispatches') and k.contype in ('p','u')
        and pg_get_constraintdef(k.oid) like '%(organization_id, id)%'),
    'member_org_auth_unique',exists(select 1 from pg_catalog.pg_constraint k
      where k.conrelid=to_regclass('public.organization_members') and k.contype in ('p','u')
        and pg_get_constraintdef(k.oid) like '%(organization_id, auth_user_id)%'))

  union all
  select 5,'required columns',jsonb_build_object(
    'all_match',bool_and(attnum is not null and actual_type=expected_type
      and actual_not_null=expected_not_null),
    'columns',jsonb_agg(jsonb_build_object(
      'table',table_name,'column',column_name,'exists',attnum is not null,
      'expected_type',expected_type,'actual_type',actual_type,
      'expected_nullable',not expected_not_null,
      'actual_nullable',case when attnum is null then null else not actual_not_null end,
      'matches_expected',attnum is not null and actual_type=expected_type
        and actual_not_null=expected_not_null
    ) order by ord)
  ) from column_catalog
)
select item,result from report order by seq;
