-- Supabase SQL Editor: single read-only SELECT after applying
-- vendor-dispatch-messaging.migration.sql.
with message_table as (
  select c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='repair_vendor_dispatch_messages'
    and c.relkind in ('r','p')
), expected_columns(ord,column_name,expected_type,expected_not_null) as (values
  (1,'id','uuid',true),
  (2,'organization_id','uuid',true),
  (3,'dispatch_id','uuid',true),
  (4,'channel','text',true),
  (5,'message_body','text',true),
  (6,'recipient_label','text',true),
  (7,'recipient_address','text',false),
  (8,'sent_by','uuid',true),
  (9,'request_id','uuid',true),
  (10,'sent_at','timestamp with time zone',false),
  (11,'delivery_status','text',true),
  (12,'created_at','timestamp with time zone',true)
), column_catalog as (
  select e.*,a.attnum,pg_catalog.format_type(a.atttypid,a.atttypmod) actual_type,
    a.attnotnull actual_not_null
  from expected_columns e
  left join message_table t on true
  left join pg_catalog.pg_attribute a on a.attrelid=t.oid
    and a.attname=e.column_name and a.attnum>0 and not a.attisdropped
), attribute_numbers as (
  select
    max(attnum) filter(where column_name='id')::smallint id_attnum,
    max(attnum) filter(where column_name='organization_id')::smallint org_attnum,
    max(attnum) filter(where column_name='dispatch_id')::smallint dispatch_attnum,
    max(attnum) filter(where column_name='sent_by')::smallint sent_by_attnum,
    max(attnum) filter(where column_name='request_id')::smallint request_attnum
  from column_catalog
), constraint_catalog as (
  select k.oid,k.conname,k.contype,k.conkey,k.confrelid,k.confkey,
    pg_catalog.pg_get_constraintdef(k.oid) definition
  from pg_catalog.pg_constraint k
  where k.conrelid=to_regclass('public.repair_vendor_dispatch_messages')
), constraint_checks as (
  select
    (select count(*) from constraint_catalog where contype='p'
      and conname='repair_vendor_dispatch_messages_pkey'
      and conkey=array[a.id_attnum]::smallint[])=1 as pk_match,
    (select count(*) from constraint_catalog where contype='u'
      and conname='vendor_dispatch_messages_org_id_uq'
      and conkey=array[a.org_attnum,a.id_attnum]::smallint[])=1 as org_id_unique_match,
    (select count(*) from constraint_catalog where contype='u'
      and conname='vendor_dispatch_messages_request_uq'
      and conkey=array[a.org_attnum,a.request_attnum]::smallint[])=1 as request_unique_match,
    (select count(*) from constraint_catalog where contype='f'
      and conkey=array[a.org_attnum,a.dispatch_attnum]::smallint[]
      and confrelid=to_regclass('public.repair_vendor_dispatches')
      and confkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=
          to_regclass('public.repair_vendor_dispatches') and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=
          to_regclass('public.repair_vendor_dispatches') and attname='id')]::smallint[])=1
      as dispatch_fk_match,
    (select count(*) from constraint_catalog where contype='f'
      and conkey=array[a.org_attnum,a.sent_by_attnum]::smallint[]
      and confrelid=to_regclass('public.organization_members')
      and confkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=
          to_regclass('public.organization_members') and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=
          to_regclass('public.organization_members') and attname='auth_user_id')]::smallint[])=1
      as member_fk_match
  from attribute_numbers a
), immutable_trigger as (
  select t.oid,t.tgname,t.tgenabled,t.tgtype,t.tgfoid,
    pg_catalog.pg_get_triggerdef(t.oid) definition
  from pg_catalog.pg_trigger t
  where t.tgrelid=to_regclass('public.repair_vendor_dispatch_messages')
    and not t.tgisinternal and t.tgname='vendor_dispatch_messages_immutable'
), read_policy as (
  select p.policyname,p.permissive,p.roles,p.cmd,p.qual,p.with_check
  from pg_catalog.pg_policies p
  where p.schemaname='public' and p.tablename='repair_vendor_dispatch_messages'
    and p.policyname='repair_vendor_dispatch_messages_staff_read'
), manual_rpc as (
  select p.oid,n.nspname,p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) identity_arguments,
    p.prosecdef,p.proacl,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_role_execute
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='confirm_vendor_dispatch_manual'
), transition_rpc as (
  select p.oid,p.prosecdef,p.proacl,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_role_execute
  from pg_catalog.pg_proc p
  where p.oid=to_regprocedure(
    'public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)')
), phase1_expected(ord,relation_name) as (values
  (1,'repair_vendor_dispatches'),
  (2,'repair_vendor_dispatch_events'),
  (3,'repair_vendors')
), phase1_catalog as (
  select e.ord,e.relation_name,c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity
  from phase1_expected e
  left join pg_catalog.pg_namespace n on n.nspname='public'
  left join pg_catalog.pg_class c on c.relnamespace=n.oid
    and c.relname=e.relation_name and c.relkind in ('r','p')
), expected_indexes(ord,index_name) as (values
  (1,'repair_vendor_dispatch_messages_pkey'),
  (2,'vendor_dispatch_messages_org_id_uq'),
  (3,'vendor_dispatch_messages_request_uq'),
  (4,'repair_vendor_dispatch_messages_timeline_idx')
), index_catalog as (
  select e.ord,e.index_name,c.oid,pg_catalog.pg_get_indexdef(c.oid) definition
  from expected_indexes e
  left join pg_catalog.pg_namespace n on n.nspname='public'
  left join pg_catalog.pg_class c on c.relnamespace=n.oid
    and c.relname=e.index_name and c.relkind='i'
), section_checks(seq,item,all_match,result) as (
  select 1,'message table and required columns',
    (select count(*)=1 from message_table)
      and bool_and(attnum is not null and actual_type=expected_type
        and actual_not_null=expected_not_null),
    jsonb_build_object(
      'table_exists',(select count(*)=1 from message_table),
      'columns',jsonb_agg(jsonb_build_object(
        'name',column_name,'exists',attnum is not null,
        'expected_type',expected_type,'actual_type',actual_type,
        'expected_nullable',not expected_not_null,
        'actual_nullable',case when attnum is null then null else not actual_not_null end,
        'matches_expected',attnum is not null and actual_type=expected_type
          and actual_not_null=expected_not_null) order by ord))
  from column_catalog

  union all
  select 2,'primary, unique and foreign key constraints',
    pk_match and org_id_unique_match and request_unique_match
      and dispatch_fk_match and member_fk_match,
    jsonb_build_object('pk_match',pk_match,'organization_id_id_unique_match',org_id_unique_match,
      'organization_id_request_id_unique_match',request_unique_match,
      'dispatch_composite_fk_match',dispatch_fk_match,'member_composite_fk_match',member_fk_match,
      'constraints',coalesce((select jsonb_agg(jsonb_build_object(
        'name',conname,'type',contype,'definition',definition) order by conname)
        from constraint_catalog),'[]'::jsonb))
  from constraint_checks

  union all
  select 3,'immutable trigger and mutation guard',
    (select count(*)=1 and bool_and(tgenabled<>'D' and tgtype=27 and tgfoid=
      to_regprocedure('public._vendor_phase1_no_change()')) from immutable_trigger),
    jsonb_build_object(
      'all_match',(select count(*)=1 and bool_and(tgenabled<>'D' and tgtype=27 and tgfoid=
        to_regprocedure('public._vendor_phase1_no_change()')) from immutable_trigger),
      'expected_function_exists',to_regprocedure('public._vendor_phase1_no_change()') is not null,
      'triggers',coalesce((select jsonb_agg(jsonb_build_object(
        'name',tgname,'enabled',tgenabled<>'D','before_update_delete_for_each_row',tgtype=27,
        'uses_expected_function',tgfoid=to_regprocedure('public._vendor_phase1_no_change()'),
        'definition',definition)) from immutable_trigger),'[]'::jsonb))

  union all
  select 4,'message table RLS, privileges and policy',
    c.oid is not null and c.relrowsecurity
      and not coalesce(has_table_privilege('anon',c.oid,'SELECT'),false)
      and coalesce(has_table_privilege('authenticated',c.oid,'SELECT'),false)
      and coalesce(has_table_privilege('service_role',c.oid,'SELECT'),false)
      and not coalesce(has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE'),false)
      and not coalesce(has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE'),false)
      and not coalesce(has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE'),false)
      and (select count(*)=1 and bool_and(permissive='PERMISSIVE' and cmd='SELECT'
        and roles::text[]=array['authenticated']::text[]
        and qual like '%private.has_org_role(organization_id,%'
        and qual like '%admin%' and qual like '%manager%' and qual like '%staff%'
        and qual like '%viewer%' and with_check is null) from read_policy),
    jsonb_build_object(
      'rls_enabled',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl,
      'privileges',jsonb_build_object(
        'anon',jsonb_build_object('select',coalesce(has_table_privilege('anon',c.oid,'SELECT'),false),
          'insert',coalesce(has_table_privilege('anon',c.oid,'INSERT'),false),
          'update',coalesce(has_table_privilege('anon',c.oid,'UPDATE'),false),
          'delete',coalesce(has_table_privilege('anon',c.oid,'DELETE'),false)),
        'authenticated',jsonb_build_object('select',coalesce(has_table_privilege('authenticated',c.oid,'SELECT'),false),
          'insert',coalesce(has_table_privilege('authenticated',c.oid,'INSERT'),false),
          'update',coalesce(has_table_privilege('authenticated',c.oid,'UPDATE'),false),
          'delete',coalesce(has_table_privilege('authenticated',c.oid,'DELETE'),false)),
        'service_role',jsonb_build_object('select',coalesce(has_table_privilege('service_role',c.oid,'SELECT'),false),
          'insert',coalesce(has_table_privilege('service_role',c.oid,'INSERT'),false),
          'update',coalesce(has_table_privilege('service_role',c.oid,'UPDATE'),false),
          'delete',coalesce(has_table_privilege('service_role',c.oid,'DELETE'),false))),
      'policies',coalesce((select jsonb_agg(jsonb_build_object('name',policyname,
        'mode',permissive,'roles',roles,'command',cmd,'using',qual,'with_check',with_check))
        from read_policy),'[]'::jsonb))
  from (select 1) seed left join message_table c on true

  union all
  select 5,'confirm_vendor_dispatch_manual RPC',
    count(*)=1 and bool_and(oid=to_regprocedure(
      'public.confirm_vendor_dispatch_manual(uuid,uuid,uuid,uuid,text,text,text)')
      and prosecdef and not anon_execute and not authenticated_execute and service_role_execute),
    jsonb_build_object(
      'overload_count',count(*),
      'exact_signature_exists',to_regprocedure(
        'public.confirm_vendor_dispatch_manual(uuid,uuid,uuid,uuid,text,text,text)') is not null,
      'functions',coalesce(jsonb_agg(jsonb_build_object('schema',nspname,'name',proname,
        'identity_arguments',identity_arguments,'security_definer',prosecdef,'acl',proacl,
        'anon_execute',anon_execute,'authenticated_execute',authenticated_execute,
        'service_role_execute',service_role_execute) order by identity_arguments),'[]'::jsonb))
  from manual_rpc

  union all
  select 6,'transition_repair_vendor_dispatch Phase1 RPC',
    count(*)=1 and bool_and(prosecdef and not anon_execute
      and authenticated_execute and not service_role_execute),
    jsonb_build_object('exists',count(*)=1,
      'functions',coalesce(jsonb_agg(jsonb_build_object('security_definer',prosecdef,
        'acl',proacl,'anon_execute',anon_execute,
        'authenticated_execute',authenticated_execute,
        'service_role_execute',service_role_execute)),'[]'::jsonb))
  from transition_rpc

  union all
  select 7,'existing vendor dispatch Phase1 relations',
    bool_and(oid is not null and coalesce(relrowsecurity,false)),
    jsonb_build_object('relations',jsonb_agg(jsonb_build_object('name',relation_name,
      'exists',oid is not null,'kind',relkind,'rls_enabled',relrowsecurity,
      'force_rls',relforcerowsecurity) order by ord))
  from phase1_catalog

  union all
  select 8,'message table initial row count',count(*)=0,
    jsonb_build_object('expected_count',0,'actual_count',count(*))
  from public.repair_vendor_dispatch_messages

  union all
  select 9,'added object set',
    (select count(*)=1 from message_table)
      and bool_and(oid is not null)
      and (select count(*)=12 from constraint_catalog)
      and (select count(*)=1 from immutable_trigger)
      and (select count(*)=1 from read_policy)
      and (select count(*)=1 from manual_rpc),
    jsonb_build_object(
      'table_count',(select count(*) from message_table),
      'indexes',jsonb_agg(jsonb_build_object('name',index_name,'exists',oid is not null,
        'definition',definition) order by ord),
      'constraint_count',(select count(*) from constraint_catalog),
      'trigger_count',(select count(*) from immutable_trigger),
      'policy_count',(select count(*) from read_policy),
      'rpc_overload_count',(select count(*) from manual_rpc))
  from index_catalog
), report as (
  select seq,item,jsonb_build_object('all_match',all_match,'details',result) result
  from section_checks
  union all
  select 10,'overall readiness',jsonb_build_object(
    'overall_ready',bool_and(all_match),
    'section_results',jsonb_object_agg(item,to_jsonb(all_match) order by seq))
  from section_checks
)
select item,result from report order by seq;
