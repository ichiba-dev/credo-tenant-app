-- Supabase SQL Editor: paste and run this single read-only SELECT after applying
-- vendor-dispatch-phase1.migration.sql. It returns one item/result result set.
with expected_tables(ord, table_name) as (
  values
    (1, 'repair_vendors'),
    (2, 'repair_vendor_categories'),
    (3, 'repair_vendor_areas'),
    (4, 'repair_vendor_dispatches'),
    (5, 'repair_vendor_dispatch_events'),
    (6, 'vendor_quote_uploads'),
    (7, 'vendor_quote_versions'),
    (8, 'vendor_quote_lines'),
    (9, 'vendor_quote_files')
), table_catalog as (
  select e.ord,e.table_name,c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity
  from expected_tables e
  left join pg_catalog.pg_namespace n on n.nspname='public'
  left join pg_catalog.pg_class c on c.relnamespace=n.oid
    and c.relname=e.table_name and c.relkind in ('r','p')
), rpc_expected(ord,function_name,signature,expected_anon,
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
), rpc_catalog as (
  select e.*,to_regprocedure(e.signature) as function_oid
  from rpc_expected e
), policy_expected(ord,policy_name,command_name,needs_using,needs_check) as (
  values
    (1,'vendor_quotes_no_browser_insert','INSERT',false,true),
    (2,'vendor_quotes_no_browser_update','UPDATE',true,true),
    (3,'vendor_quotes_no_browser_delete','DELETE',true,false)
), policy_catalog as (
  select e.*,p.permissive,p.roles,p.cmd,p.qual,p.with_check
  from policy_expected e
  left join pg_catalog.pg_policies p on p.schemaname='storage'
    and p.tablename='objects' and p.policyname=e.policy_name
), vendor_counts(table_name,row_count) as (
  select 'repair_vendors',count(*) from public.repair_vendors
  union all select 'repair_vendor_categories',count(*) from public.repair_vendor_categories
  union all select 'repair_vendor_areas',count(*) from public.repair_vendor_areas
  union all select 'repair_vendor_dispatches',count(*) from public.repair_vendor_dispatches
  union all select 'repair_vendor_dispatch_events',count(*) from public.repair_vendor_dispatch_events
  union all select 'vendor_quote_uploads',count(*) from public.vendor_quote_uploads
  union all select 'vendor_quote_versions',count(*) from public.vendor_quote_versions
  union all select 'vendor_quote_lines',count(*) from public.vendor_quote_lines
  union all select 'vendor_quote_files',count(*) from public.vendor_quote_files
), expected_existing_objects(ord,object_name) as (
  values
    (1,'repair_requests'),
    (2,'repair_photos'),
    (3,'tenant_line_attachments'),
    (4,'owner_reports'),
    (5,'owner_report_estimate_files'),
    (6,'staff_line_attachments'),
    (7,'staff_line_attachment_pushes'),
    (8,'staff_line_attachment_tokens')
), existing_object_catalog as (
  select e.ord,e.object_name,c.oid,c.relkind
  from expected_existing_objects e
  left join pg_catalog.pg_namespace n on n.nspname='public'
  left join pg_catalog.pg_class c on c.relnamespace=n.oid
    and c.relname=e.object_name and c.relkind in ('r','p','v','m','f')
), report(seq,item,result) as (
  select 1,'vendor tables: existence and RLS',jsonb_build_object(
    'all_exist',bool_and(oid is not null),
    'all_rls_enabled',bool_and(coalesce(relrowsecurity,false)),
    'tables',jsonb_agg(jsonb_build_object(
      'name',table_name,
      'exists',oid is not null,
      'relkind',relkind,
      'relrowsecurity',relrowsecurity,
      'relforcerowsecurity',relforcerowsecurity
    ) order by ord)
  ) from table_catalog

  union all
  select 2,'RPC definitions and EXECUTE privileges',jsonb_build_object(
    'all_match_expected',bool_and(function_oid is not null
      and coalesce(has_function_privilege('anon',function_oid,'EXECUTE'),false)=expected_anon
      and coalesce(has_function_privilege('authenticated',function_oid,'EXECUTE'),false)=expected_authenticated
      and coalesce(has_function_privilege('service_role',function_oid,'EXECUTE'),false)=expected_service_role),
    'functions',jsonb_agg(jsonb_build_object(
      'name',function_name,
      'signature',signature,
      'exists',function_oid is not null,
      'security_definer',p.prosecdef,
      'owner',pg_catalog.pg_get_userbyid(p.proowner),
      'acl',p.proacl,
      'expected',jsonb_build_object('anon',expected_anon,
        'authenticated',expected_authenticated,'service_role',expected_service_role),
      'actual',jsonb_build_object(
        'anon',coalesce(has_function_privilege('anon',function_oid,'EXECUTE'),false),
        'authenticated',coalesce(has_function_privilege('authenticated',function_oid,'EXECUTE'),false),
        'service_role',coalesce(has_function_privilege('service_role',function_oid,'EXECUTE'),false)),
      'matches_expected',function_oid is not null
        and coalesce(has_function_privilege('anon',function_oid,'EXECUTE'),false)=expected_anon
        and coalesce(has_function_privilege('authenticated',function_oid,'EXECUTE'),false)=expected_authenticated
        and coalesce(has_function_privilege('service_role',function_oid,'EXECUTE'),false)=expected_service_role
    ) order by ord)
  ) from rpc_catalog r left join pg_catalog.pg_proc p on p.oid=r.function_oid

  union all
  select 3,'storage.objects browser-block policies',jsonb_build_object(
    'all_match_expected',bool_and(permissive is not null and permissive='RESTRICTIVE'
      and cmd=command_name and roles::text[] @> array['anon','authenticated']::text[]
      and cardinality(roles)=2
      and (not needs_using or regexp_replace(coalesce(qual,''),'[[:space:]()]','','g')=
        'bucket_id<>''vendor-quotes''::text')
      and (not needs_check or regexp_replace(coalesce(with_check,''),'[[:space:]()]','','g')=
        'bucket_id<>''vendor-quotes''::text')),
    'policies',jsonb_agg(jsonb_build_object(
      'name',policy_name,
      'exists',permissive is not null,
      'permissive',permissive,
      'roles',roles,
      'command',cmd,
      'using',qual,
      'with_check',with_check,
      'matches_expected',coalesce(permissive='RESTRICTIVE' and cmd=command_name
        and roles::text[] @> array['anon','authenticated']::text[]
        and cardinality(roles)=2
        and (not needs_using or regexp_replace(coalesce(qual,''),'[[:space:]()]','','g')=
          'bucket_id<>''vendor-quotes''::text')
        and (not needs_check or regexp_replace(coalesce(with_check,''),'[[:space:]()]','','g')=
          'bucket_id<>''vendor-quotes''::text'),false)
    ) order by ord)
  ) from policy_catalog

  union all
  select 4,'vendor-quotes bucket',jsonb_build_object(
    'exists',b.id is not null,
    'expected',jsonb_build_object('public',false,'file_size_limit',15728640,
      'allowed_mime_types',jsonb_build_array('application/pdf')),
    'actual',case when b.id is null then null else jsonb_build_object(
      'public',b.public,'file_size_limit',b.file_size_limit,
      'allowed_mime_types',b.allowed_mime_types) end,
    'matches_expected',coalesce(b.public=false and b.file_size_limit=15728640
      and b.allowed_mime_types=array['application/pdf']::text[],false)
  ) from (select 1) seed left join storage.buckets b on b.id='vendor-quotes'

  union all
  select 5,'vendor table row counts',jsonb_build_object(
    'all_zero',bool_and(row_count=0),
    'counts',jsonb_object_agg(table_name,to_jsonb(row_count))
  ) from vendor_counts

  union all
  select 6,'existing major objects',jsonb_build_object(
    'all_exist',bool_and(oid is not null),
    'objects',jsonb_agg(jsonb_build_object(
      'name',object_name,'exists',oid is not null,'relkind',relkind
    ) order by ord)
  ) from existing_object_catalog
)
select item,result from report order by seq;
