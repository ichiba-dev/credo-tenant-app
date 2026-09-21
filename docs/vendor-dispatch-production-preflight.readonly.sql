-- Supabase SQL Editor: paste and run this single SELECT. It returns one result
-- set with item and JSON result columns. It does not read application rows.
with expected as (
  select
    array['repair_vendors','repair_vendor_categories','repair_vendor_areas',
      'repair_vendor_dispatches','repair_vendor_dispatch_events',
      'vendor_quote_uploads','vendor_quote_versions','vendor_quote_lines',
      'vendor_quote_files']::text[] as table_names,
    array['repair_vendors_active_idx','repair_vendor_categories_lookup_idx',
      'repair_vendor_areas_lookup_idx','repair_vendor_dispatches_repair_idx',
      'repair_vendor_dispatches_vendor_idx',
      'repair_vendor_dispatch_events_timeline_idx',
      'vendor_quote_versions_latest_idx','vendor_quote_lines_version_idx']::text[] as index_names,
    array['_vendor_phase1_no_change','_vendor_master_identity_guard',
      '_vendor_dispatch_guard','_vendor_dispatch_audit',
      '_vendor_phase1_assert_writer','select_repair_vendor',
      'transition_repair_vendor_dispatch','prepare_vendor_quote_upload',
      'record_vendor_quote_revision']::text[] as function_names,
    array[
      'prepare_vendor_quote_upload(uuid,bigint,uuid,uuid,uuid,timestamptz,text,bigint,bytea)',
      'record_vendor_quote_revision(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,date,text,text,jsonb,text,bigint,bytea)'
    ]::text[] as server_rpc_signatures,
    array['vendor_quote_versions_immutable','vendor_quote_lines_immutable',
      'vendor_quote_files_immutable','vendor_dispatch_events_immutable',
      'repair_vendors_identity_guard','repair_vendor_categories_identity_guard',
      'repair_vendor_areas_identity_guard','vendor_dispatch_guard',
      'vendor_dispatch_audit']::text[] as trigger_names,
    array['vendor_quotes_no_browser_insert','vendor_quotes_no_browser_update',
      'vendor_quotes_no_browser_delete']::text[] as storage_policy_names
), report as (
  select 1 as seq, 'storage.objects policies'::text as item,
    jsonb_build_object('policies',coalesce((select jsonb_agg(jsonb_build_object(
      'name',p.policyname,'mode',p.permissive,'roles',p.roles,'command',p.cmd,
      'using',p.qual,'with_check',p.with_check) order by p.policyname)
      from pg_catalog.pg_policies p
      where p.schemaname='storage' and p.tablename='objects'),'[]'::jsonb)) as result

  union all
  select 2,'storage.objects browser privileges',jsonb_build_object(
    'rls_enabled',(select c.relrowsecurity from pg_catalog.pg_class c
      where c.oid=to_regclass('storage.objects')),
    'rls_forced',(select c.relforcerowsecurity from pg_catalog.pg_class c
      where c.oid=to_regclass('storage.objects')),
    'anon',jsonb_build_object(
      'insert',has_table_privilege('anon','storage.objects','INSERT'),
      'update',has_table_privilege('anon','storage.objects','UPDATE'),
      'delete',has_table_privilege('anon','storage.objects','DELETE')),
    'authenticated',jsonb_build_object(
      'insert',has_table_privilege('authenticated','storage.objects','INSERT'),
      'update',has_table_privilege('authenticated','storage.objects','UPDATE'),
      'delete',has_table_privilege('authenticated','storage.objects','DELETE')),
    'role_bypass_rls',coalesce((select jsonb_agg(jsonb_build_object(
      'role',r.rolname,'bypass_rls',r.rolbypassrls) order by r.rolname)
      from pg_catalog.pg_roles r where r.rolname in ('anon','authenticated')),'[]'::jsonb))

  union all
  select 3,'vendor-quotes bucket',jsonb_build_object(
    'required',jsonb_build_object('public',false,'file_size_limit',15728640,
      'allowed_mime_types',jsonb_build_array('application/pdf')),
    'exists',exists(select 1 from storage.buckets where id='vendor-quotes'),
    'actual',(select jsonb_build_object('id',b.id,'public',b.public,
      'file_size_limit',b.file_size_limit,'allowed_mime_types',b.allowed_mime_types,
      'meets_required_settings',b.public is false
        and b.file_size_limit=15728640
        and b.allowed_mime_types=array['application/pdf']::text[])
      from storage.buckets b where b.id='vendor-quotes'))

  union all
  select 4,'planned functions and RPC ACLs',jsonb_build_object(
    'planned_names',to_jsonb(e.function_names),
    'planned_server_rpc_signatures',to_jsonb(e.server_rpc_signatures),
    'existing',coalesce((select jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'name',p.proname,
      'identity_arguments',pg_get_function_identity_arguments(p.oid),
      'security_definer',p.prosecdef,'acl',p.proacl,
      'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service_role_execute',has_function_privilege('service_role',p.oid,'EXECUTE'))
      order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=any(e.function_names)),'[]'::jsonb))
  from expected e

  union all
  select 5,'planned table and index name collisions',jsonb_build_object(
    'planned_tables',to_jsonb(e.table_names),
    'planned_explicit_indexes',to_jsonb(e.index_names),
    'existing_matching_relations',coalesce((select jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'name',c.relname,'kind',c.relkind,
      'exact_planned_name',c.relname=any(e.table_names||e.index_names))
      order by c.relname)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and
        (c.relname like 'repair_vendor%' or c.relname like 'vendor_quote%')),'[]'::jsonb))
  from expected e

  union all
  select 6,'planned constraint name collisions',jsonb_build_object(
    'explicit_name','repair_vendor_dispatch_events_quote_fk',
    'existing_matching_constraints',coalesce((select jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'table',c.relname,'name',k.conname,
      'definition',pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname)
      from pg_catalog.pg_constraint k
      join pg_catalog.pg_class c on c.oid=k.conrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and
        (k.conname like 'repair_vendor%' or k.conname like 'vendor_quote%')),'[]'::jsonb))

  union all
  select 7,'planned trigger name collisions',jsonb_build_object(
    'planned_names',to_jsonb(e.trigger_names),
    'existing',coalesce((select jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'table',c.relname,'name',t.tgname,
      'definition',pg_get_triggerdef(t.oid)) order by n.nspname,c.relname,t.tgname)
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid=t.tgrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where not t.tgisinternal and n.nspname='public'
        and t.tgname=any(e.trigger_names)),'[]'::jsonb))
  from expected e

  union all
  select 8,'planned policy name collisions',jsonb_build_object(
    'planned_storage_names',to_jsonb(e.storage_policy_names),
    'existing',coalesce((select jsonb_agg(jsonb_build_object(
      'schema',p.schemaname,'table',p.tablename,'name',p.policyname,
      'mode',p.permissive,'roles',p.roles,'command',p.cmd)
      order by p.schemaname,p.tablename,p.policyname)
      from pg_catalog.pg_policies p
      where (p.schemaname='storage' and p.tablename='objects'
        and p.policyname=any(e.storage_policy_names))
        or (p.schemaname='public' and
          (p.tablename like 'repair_vendor%' or p.tablename like 'vendor_quote%'))),
      '[]'::jsonb))
  from expected e

  union all
  select 9,'migration prerequisite objects',jsonb_build_object(
    'organizations',to_regclass('public.organizations')::text,
    'organization_members',to_regclass('public.organization_members')::text,
    'repair_requests',to_regclass('public.repair_requests')::text,
    'storage_buckets',to_regclass('storage.buckets')::text,
    'storage_objects',to_regclass('storage.objects')::text,
    'has_org_role',to_regprocedure('private.has_org_role(uuid,text[])')::text,
    'auth_uid',to_regprocedure('auth.uid()')::text,
    'repair_org_id_unique',exists(select 1 from pg_catalog.pg_constraint k
      where k.conrelid=to_regclass('public.repair_requests')
        and k.contype in ('p','u')
        and pg_get_constraintdef(k.oid) like '%(organization_id, id)%'),
    'parent_constraints',coalesce((select jsonb_agg(jsonb_build_object(
      'table',c.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid))
      order by c.relname,k.conname)
      from pg_catalog.pg_constraint k
      join pg_catalog.pg_class c on c.oid=k.conrelid
      where k.conrelid in (to_regclass('public.repair_requests'),
        to_regclass('public.organization_members'))
        and k.contype in ('p','u','f','c')),'[]'::jsonb),
    'parent_columns',coalesce((select jsonb_agg(jsonb_build_object(
      'table',x.table_name,'column',x.column_name,'type',x.data_type,
      'nullable',x.is_nullable) order by x.table_name,x.ordinal_position)
      from information_schema.columns x where x.table_schema='public'
        and x.table_name in ('organizations','organization_members','repair_requests')
        and x.column_name in ('id','organization_id','auth_user_id','is_active',
          'role','tenant_account_id')),'[]'::jsonb))
)
select item,result from report order by seq;
