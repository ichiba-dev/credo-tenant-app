-- Supabase SQL Editor: run this single read-only SELECT after applying
-- vendor-master-ui.migration.sql. It returns one item/result result set.
with vendor_master_rpc as (
  select p.oid,n.nspname,p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.prosecdef,p.proacl,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='save_repair_vendor_master'
), phase1_rpc_expected(ord,function_name,signature,expected_anon,
    expected_authenticated,expected_service_role) as (
  values
    (1,'select_repair_vendor',
      'public.select_repair_vendor(uuid,bigint,uuid,text,uuid)',false,true,false),
    (2,'transition_repair_vendor_dispatch',
      'public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)',false,true,false),
    (3,'prepare_vendor_quote_upload',
      'public.prepare_vendor_quote_upload(uuid,bigint,uuid,uuid,uuid,timestamptz,text,bigint,bytea)',
      false,false,true),
    (4,'record_vendor_quote_revision',
      'public.record_vendor_quote_revision(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,date,text,text,jsonb,text,bigint,bytea)',
      false,false,true)
), phase1_rpc as (
  select e.*,to_regprocedure(e.signature) as function_oid,
    (select count(*) from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=e.function_name) as overload_count
  from phase1_rpc_expected e
), phase1_relations(ord,relation_name) as (
  values
    (1,'repair_vendors'),
    (2,'repair_vendor_categories'),
    (3,'repair_vendor_areas'),
    (4,'repair_vendor_dispatches'),
    (5,'repair_vendor_dispatch_events')
), phase1_catalog as (
  select e.ord,e.relation_name,c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity
  from phase1_relations e
  left join pg_catalog.pg_namespace n on n.nspname='public'
  left join pg_catalog.pg_class c on c.relnamespace=n.oid
    and c.relname=e.relation_name and c.relkind in ('r','p')
), identity_guard as (
  select t.oid,t.tgname,t.tgenabled,t.tgtype,t.tgfoid,
    pg_catalog.pg_get_triggerdef(t.oid) as definition
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='repair_vendors'
    and not t.tgisinternal and t.tgname='repair_vendors_identity_guard'
), report(seq,item,result) as (
  select 1,'vendor_master_requests table',jsonb_build_object(
    'exists',c.oid is not null,
    'rls_enabled',c.relrowsecurity,
    'force_rls',c.relforcerowsecurity,
    'acl',c.relacl,
    'direct_privileges',jsonb_build_object(
      'anon',jsonb_build_object(
        'select',coalesce(has_table_privilege('anon',c.oid,'SELECT'),false),
        'insert',coalesce(has_table_privilege('anon',c.oid,'INSERT'),false),
        'update',coalesce(has_table_privilege('anon',c.oid,'UPDATE'),false),
        'delete',coalesce(has_table_privilege('anon',c.oid,'DELETE'),false)),
      'authenticated',jsonb_build_object(
        'select',coalesce(has_table_privilege('authenticated',c.oid,'SELECT'),false),
        'insert',coalesce(has_table_privilege('authenticated',c.oid,'INSERT'),false),
        'update',coalesce(has_table_privilege('authenticated',c.oid,'UPDATE'),false),
        'delete',coalesce(has_table_privilege('authenticated',c.oid,'DELETE'),false)),
      'service_role',jsonb_build_object(
        'select',coalesce(has_table_privilege('service_role',c.oid,'SELECT'),false),
        'insert',coalesce(has_table_privilege('service_role',c.oid,'INSERT'),false),
        'update',coalesce(has_table_privilege('service_role',c.oid,'UPDATE'),false),
        'delete',coalesce(has_table_privilege('service_role',c.oid,'DELETE'),false))),
    'all_direct_access_denied',c.oid is not null
      and not coalesce(has_table_privilege('anon',c.oid,'SELECT'),false)
      and not coalesce(has_table_privilege('anon',c.oid,'INSERT'),false)
      and not coalesce(has_table_privilege('anon',c.oid,'UPDATE'),false)
      and not coalesce(has_table_privilege('anon',c.oid,'DELETE'),false)
      and not coalesce(has_table_privilege('authenticated',c.oid,'SELECT'),false)
      and not coalesce(has_table_privilege('authenticated',c.oid,'INSERT'),false)
      and not coalesce(has_table_privilege('authenticated',c.oid,'UPDATE'),false)
      and not coalesce(has_table_privilege('authenticated',c.oid,'DELETE'),false)
      and not coalesce(has_table_privilege('service_role',c.oid,'SELECT'),false)
      and not coalesce(has_table_privilege('service_role',c.oid,'INSERT'),false)
      and not coalesce(has_table_privilege('service_role',c.oid,'UPDATE'),false)
      and not coalesce(has_table_privilege('service_role',c.oid,'DELETE'),false),
    'row_count',(select count(*) from public.vendor_master_requests),
    'is_empty',(select count(*)=0 from public.vendor_master_requests)
  ) from (select 1) seed
  left join pg_catalog.pg_class c on c.oid=to_regclass('public.vendor_master_requests')

  union all
  select 2,'save_repair_vendor_master RPC',jsonb_build_object(
    'expected_signature','public.save_repair_vendor_master(uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,text[],jsonb)',
    'overload_count',(select count(*) from vendor_master_rpc),
    'exact_signature_exists',to_regprocedure(
      'public.save_repair_vendor_master(uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,text[],jsonb)') is not null,
    'all_match_expected',coalesce((select count(*)=1 and bool_and(
      oid=to_regprocedure('public.save_repair_vendor_master(uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,text[],jsonb)')
      and prosecdef and not anon_execute and not authenticated_execute and service_role_execute)
      from vendor_master_rpc),false),
    'functions',coalesce((select jsonb_agg(jsonb_build_object(
      'schema',nspname,'name',proname,'identity_arguments',identity_arguments,
      'security_definer',prosecdef,'acl',proacl,
      'anon_execute',anon_execute,'authenticated_execute',authenticated_execute,
      'service_role_execute',service_role_execute) order by identity_arguments)
      from vendor_master_rpc),'[]'::jsonb))

  union all
  select 3,'Phase1 prerequisite relations',jsonb_build_object(
    'all_exist',bool_and(oid is not null),
    'relations',jsonb_agg(jsonb_build_object('name',relation_name,
      'exists',oid is not null,'relkind',relkind) order by ord)
  ) from phase1_catalog

  union all
  select 4,'repair_vendors identity guard',jsonb_build_object(
    'function_exists',to_regprocedure('public._vendor_master_identity_guard()') is not null,
    'function_returns_trigger',coalesce((select p.prorettype='trigger'::regtype
      from pg_catalog.pg_proc p
      where p.oid=to_regprocedure('public._vendor_master_identity_guard()')),false),
    'trigger_exists',exists(select 1 from identity_guard),
    'trigger_enabled',coalesce((select tgenabled<>'D' from identity_guard),false),
    'before_update_for_each_row',coalesce((select tgtype=19 from identity_guard),false),
    'uses_expected_function',coalesce((select tgfoid=
      to_regprocedure('public._vendor_master_identity_guard()') from identity_guard),false),
    'definition',(select definition from identity_guard))

  union all
  select 5,'vendor master table RLS',jsonb_build_object(
    'all_rls_enabled',bool_and(coalesce(relrowsecurity,false)) filter
      (where relation_name in ('repair_vendors','repair_vendor_categories','repair_vendor_areas')),
    'tables',jsonb_agg(jsonb_build_object('name',relation_name,'exists',oid is not null,
      'rls_enabled',relrowsecurity,'force_rls',relforcerowsecurity) order by ord)
      filter (where relation_name in ('repair_vendors','repair_vendor_categories','repair_vendor_areas'))
  ) from phase1_catalog

  union all
  select 6,'existing vendor dispatch and quote RPCs',jsonb_build_object(
    'all_match_expected',bool_and(function_oid is not null and overload_count=1
      and p.prosecdef
      and coalesce(has_function_privilege('anon',function_oid,'EXECUTE'),false)=expected_anon
      and coalesce(has_function_privilege('authenticated',function_oid,'EXECUTE'),false)=expected_authenticated
      and coalesce(has_function_privilege('service_role',function_oid,'EXECUTE'),false)=expected_service_role),
    'functions',jsonb_agg(jsonb_build_object('name',function_name,'signature',signature,
      'exists',function_oid is not null,'overload_count',overload_count,
      'security_definer',p.prosecdef,'acl',p.proacl,
      'expected',jsonb_build_object('anon',expected_anon,
        'authenticated',expected_authenticated,'service_role',expected_service_role),
      'actual',jsonb_build_object(
        'anon',coalesce(has_function_privilege('anon',function_oid,'EXECUTE'),false),
        'authenticated',coalesce(has_function_privilege('authenticated',function_oid,'EXECUTE'),false),
        'service_role',coalesce(has_function_privilege('service_role',function_oid,'EXECUTE'),false)),
      'matches_expected',function_oid is not null and overload_count=1 and p.prosecdef
        and coalesce(has_function_privilege('anon',function_oid,'EXECUTE'),false)=expected_anon
        and coalesce(has_function_privilege('authenticated',function_oid,'EXECUTE'),false)=expected_authenticated
        and coalesce(has_function_privilege('service_role',function_oid,'EXECUTE'),false)=expected_service_role
    ) order by ord)
  ) from phase1_rpc r left join pg_catalog.pg_proc p on p.oid=r.function_oid
)
select item,result from report order by seq;
