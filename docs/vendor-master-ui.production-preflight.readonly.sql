-- Supabase SQL Editor: run this single read-only SELECT before applying
-- vendor-master-ui.migration.sql. It returns one item/result result set.
with expected_columns(ord,table_name,column_name,type_name,not_null) as (
  values
    (1,'repair_vendors','organization_id','uuid',true),
    (2,'repair_vendors','id','uuid',true),
    (3,'repair_vendors','company_name','text',true),
    (4,'repair_vendors','contact_name','text',true),
    (5,'repair_vendors','phone','text',false),
    (6,'repair_vendors','email','text',false),
    (7,'repair_vendors','is_active','boolean',true),
    (8,'repair_vendors','created_at','timestamp with time zone',true),
    (9,'repair_vendors','updated_at','timestamp with time zone',true),
    (10,'repair_vendor_categories','organization_id','uuid',true),
    (11,'repair_vendor_categories','vendor_id','uuid',true),
    (12,'repair_vendor_categories','category','text',true),
    (13,'repair_vendor_areas','organization_id','uuid',true),
    (14,'repair_vendor_areas','vendor_id','uuid',true),
    (15,'repair_vendor_areas','area_code','text',true),
    (16,'repair_vendor_areas','area_label','text',true),
    (17,'organization_members','organization_id','uuid',true),
    (18,'organization_members','auth_user_id','uuid',true),
    (19,'organization_members','is_active','boolean',true),
    (20,'organization_members','role','text',true)
), actual_columns as (
  select e.*,c.oid as table_oid,a.attnum,a.attnotnull,
    pg_catalog.format_type(a.atttypid,a.atttypmod) as actual_type
  from expected_columns e
  left join pg_catalog.pg_namespace n on n.nspname='public'
  left join pg_catalog.pg_class c on c.relnamespace=n.oid
    and c.relname=e.table_name and c.relkind in ('r','p')
  left join pg_catalog.pg_attribute a on a.attrelid=c.oid
    and a.attname=e.column_name and a.attnum>0 and not a.attisdropped
), relevant_constraints as (
  select n.nspname,c.relname,k.conname,k.contype,
    pg_catalog.pg_get_constraintdef(k.oid) as definition
  from pg_catalog.pg_constraint k
  join pg_catalog.pg_class c on c.oid=k.conrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in
    ('repair_vendors','repair_vendor_categories','repair_vendor_areas','organization_members')
    and k.contype in ('p','u','f')
), same_name_functions as (
  select p.oid,n.nspname,p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.prosecdef,p.proacl,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='save_repair_vendor_master'
), identity_guard as (
  select t.oid,t.tgname,t.tgenabled,t.tgtype,t.tgfoid,
    pg_catalog.pg_get_triggerdef(t.oid) as definition,
    p.oid as function_oid,p.proname,p.prorettype
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  left join pg_catalog.pg_proc p on p.oid=t.tgfoid
  where n.nspname='public' and c.relname='repair_vendors'
    and not t.tgisinternal and t.tgname='repair_vendors_identity_guard'
), report(seq,item,result) as (
  select 1,'planned object collisions',jsonb_build_object(
    'ready',to_regclass('public.vendor_master_requests') is null
      and to_regclass('public.vendor_master_requests_pkey') is null
      and not exists(select 1 from same_name_functions),
    'vendor_master_requests',to_regclass('public.vendor_master_requests')::text,
    'vendor_master_requests_pkey',to_regclass('public.vendor_master_requests_pkey')::text,
    'save_repair_vendor_master_overload_count',(select count(*) from same_name_functions),
    'save_repair_vendor_master_overloads',coalesce((select jsonb_agg(jsonb_build_object(
      'schema',nspname,'name',proname,'identity_arguments',identity_arguments,
      'security_definer',prosecdef,'acl',proacl,'anon_execute',anon_execute,
      'authenticated_execute',authenticated_execute,'service_role_execute',service_role_execute)
      order by identity_arguments) from same_name_functions),'[]'::jsonb))

  union all
  select 2,'required columns and types',jsonb_build_object(
    'all_match',bool_and(table_oid is not null and attnum is not null
      and actual_type=type_name and attnotnull=not_null),
    'columns',jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,
      'exists',attnum is not null,'expected_type',type_name,'actual_type',actual_type,
      'expected_not_null',not_null,'actual_not_null',attnotnull,
      'matches',table_oid is not null and attnum is not null
        and actual_type=type_name and attnotnull=not_null) order by ord)
  ) from actual_columns

  union all
  select 3,'required PK UNIQUE and FK constraints',jsonb_build_object(
    'repair_vendors_id_pk',exists(select 1 from relevant_constraints
      where relname='repair_vendors' and contype='p' and definition='PRIMARY KEY (id)'),
    'repair_vendors_org_id_unique',exists(select 1 from relevant_constraints
      where relname='repair_vendors' and contype in ('p','u')
        and definition in ('UNIQUE (organization_id, id)','PRIMARY KEY (organization_id, id)')),
    'category_composite_pk',exists(select 1 from relevant_constraints
      where relname='repair_vendor_categories' and contype='p'
        and definition='PRIMARY KEY (organization_id, vendor_id, category)'),
    'category_vendor_fk',exists(select 1 from relevant_constraints
      where relname='repair_vendor_categories' and contype='f'
        and definition like 'FOREIGN KEY (organization_id, vendor_id) REFERENCES %repair_vendors(organization_id, id)%'),
    'area_composite_pk',exists(select 1 from relevant_constraints
      where relname='repair_vendor_areas' and contype='p'
        and definition='PRIMARY KEY (organization_id, vendor_id, area_code)'),
    'area_vendor_fk',exists(select 1 from relevant_constraints
      where relname='repair_vendor_areas' and contype='f'
        and definition like 'FOREIGN KEY (organization_id, vendor_id) REFERENCES %repair_vendors(organization_id, id)%'),
    'organization_members_org_user_unique',exists(select 1 from relevant_constraints
      where relname='organization_members' and contype in ('p','u')
        and definition in ('UNIQUE (organization_id, auth_user_id)',
          'PRIMARY KEY (organization_id, auth_user_id)')),
    'actual',coalesce((select jsonb_agg(jsonb_build_object('table',relname,'name',conname,
      'type',contype,'definition',definition) order by relname,conname)
      from relevant_constraints),'[]'::jsonb))

  union all
  select 4,'repair_vendors identity guard',jsonb_build_object(
    'function_exists',to_regprocedure('public._vendor_master_identity_guard()') is not null,
    'function_returns_trigger',coalesce((select p.prorettype='trigger'::regtype
      from pg_catalog.pg_proc p where p.oid=to_regprocedure('public._vendor_master_identity_guard()')),false),
    'trigger_matches',coalesce((select function_oid=to_regprocedure('public._vendor_master_identity_guard()')
      and tgenabled<>'D' and tgtype=19 and prorettype='trigger'::regtype from identity_guard),false),
    'trigger',(select jsonb_build_object('name',tgname,'enabled',tgenabled,
      'type_bits',tgtype,'definition',definition) from identity_guard))

  union all
  select 5,'existing RPC ACLs',jsonb_build_object(
    'expected_before_migration','no overloads',
    'overloads',coalesce((select jsonb_agg(jsonb_build_object('identity_arguments',identity_arguments,
      'security_definer',prosecdef,'acl',proacl,'anon_execute',anon_execute,
      'authenticated_execute',authenticated_execute,'service_role_execute',service_role_execute)
      order by identity_arguments) from same_name_functions),'[]'::jsonb))

  union all
  select 6,'vendor_master_requests RLS and ACL',jsonb_build_object(
    'expected_before_migration','table absent',
    'exists',c.oid is not null,'rls_enabled',c.relrowsecurity,
    'force_rls',c.relforcerowsecurity,'acl',c.relacl)
  from (select 1) seed
  left join pg_catalog.pg_class c on c.oid=to_regclass('public.vendor_master_requests')

  union all
  select 7,'existing Phase1 relations',jsonb_build_object(
    'repair_vendors',to_regclass('public.repair_vendors')::text,
    'repair_vendor_categories',to_regclass('public.repair_vendor_categories')::text,
    'repair_vendor_areas',to_regclass('public.repair_vendor_areas')::text,
    'organization_members',to_regclass('public.organization_members')::text)
)
select item,result from report order by seq;
