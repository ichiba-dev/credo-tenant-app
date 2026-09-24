-- Run as postgres immediately after migration, before creating calendar events.
-- Single read-only SELECT. SQL errors (including missing required relations) mean NO-GO.
-- Catalog checks verify policy definitions, not the implementation of private.has_org_role.
-- Existing-table presence/RLS is checked; unchanged historical schema/data requires a baseline.
with target as (
 select to_regclass('public.calendar_events') oid
), expected_columns(name,type_name,not_null) as (values
 ('id','uuid',true),('organization_id','uuid',true),('title','text',true),
 ('event_type','text',true),('starts_at','timestamp with time zone',true),
 ('ends_at','timestamp with time zone',false),('all_day','boolean',true),
 ('status','text',true),('repair_request_id','bigint',false),('vendor_dispatch_id','uuid',false),
 ('notes','text',false),('source_type','text',true),('created_by','uuid',true),
 ('created_at','timestamp with time zone',true),('updated_at','timestamp with time zone',true)
), columns as (
 select e.*,pg_catalog.format_type(a.atttypid,a.atttypmod) actual_type,a.attnotnull actual_not_null,
  coalesce(a.attnum>0 and pg_catalog.format_type(a.atttypid,a.atttypmod)=e.type_name and a.attnotnull=e.not_null,false) matches
 from expected_columns e cross join target t left join pg_catalog.pg_attribute a
 on a.attrelid=t.oid and a.attname=e.name and a.attnum>0 and not a.attisdropped
), expected_indexes(name,names,is_pk) as (values
 ('calendar_events_pkey',array['id'],true),
 ('calendar_events_org_start_idx',array['organization_id','starts_at'],false),
 ('calendar_events_repair_idx',array['organization_id','repair_request_id'],false)
), indexes as (
 select e.*,exists(select 1 from pg_catalog.pg_index i
 join pg_catalog.pg_class c on c.oid=i.indexrelid join pg_catalog.pg_am am on am.oid=c.relam
 where i.indexrelid=to_regclass('public.'||e.name) and i.indrelid=t.oid
 and i.indisvalid and i.indisready and i.indimmediate and i.indisprimary=e.is_pk and i.indisunique=e.is_pk
 and am.amname='btree' and i.indpred is null and i.indexprs is null and i.indnatts=cardinality(e.names)
 and array(select a.attname::text from unnest(i.indkey) with ordinality u(n,o)
 join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=u.n order by u.o)=e.names
 and (not e.is_pk or exists(select 1 from pg_catalog.pg_constraint k where k.conrelid=t.oid
 and k.conname=e.name and k.contype='p' and k.conindid=i.indexrelid and k.convalidated
 and not k.condeferrable and not k.condeferred))) matches
 from expected_indexes e cross join target t
), expected_fks(name,names,target_table,target_names) as (values
 ('calendar_events_organization_id_fkey',array['organization_id'],'organizations',array['id']),
 ('calendar_events_repair_fk',array['organization_id','repair_request_id'],'repair_requests',array['organization_id','id']),
 ('calendar_events_dispatch_fk',array['organization_id','repair_request_id','vendor_dispatch_id'],'repair_vendor_dispatches',array['organization_id','repair_request_id','id']),
 ('calendar_events_creator_fk',array['organization_id','created_by'],'organization_members',array['organization_id','auth_user_id'])
), fks as (
 select e.*,exists(select 1 from pg_catalog.pg_constraint c where c.conrelid=t.oid
 and c.conname=e.name and c.contype='f' and c.convalidated and not c.condeferrable and not c.condeferred
 and c.confrelid=to_regclass('public.'||e.target_table) and c.confupdtype='a' and c.confdeltype='a' and c.confmatchtype='s'
 and array(select a.attname::text from unnest(c.conkey) with ordinality u(n,o)
 join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=u.n order by u.o)=e.names
 and array(select a.attname::text from unnest(c.confkey) with ordinality u(n,o)
 join pg_catalog.pg_attribute a on a.attrelid=c.confrelid and a.attnum=u.n order by u.o)=e.target_names) matches
 from expected_fks e cross join target t
), expected_checks(name,expression) as (values
 ('calendar_events_title_check',$e$((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 300))$e$),
 ('calendar_events_event_type_check',$e$(event_type ~ '^[a-z][a-z0-9_]{1,49}$'::text)$e$),
 ('calendar_events_starts_at_check',$e$isfinite(starts_at)$e$),
 -- PostgreSQL names the multi-column ends_at CHECK calendar_events_check.
 ('calendar_events_check',$e$((ends_at IS NULL) OR (isfinite(ends_at) AND (ends_at > starts_at)))$e$),
 ('calendar_events_status_check',$e$(status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text]))$e$),
 ('calendar_events_notes_check',$e$((notes IS NULL) OR (length(notes) <= 3000))$e$),
 ('calendar_events_source_type_check',$e$(source_type ~ '^[a-z][a-z0-9_]{1,49}$'::text)$e$),
 ('calendar_events_source_ck',$e$(((vendor_dispatch_id IS NULL) OR (repair_request_id IS NOT NULL)) AND ((source_type <> 'repair'::text) OR (repair_request_id IS NOT NULL)) AND ((source_type <> 'vendor_dispatch'::text) OR ((repair_request_id IS NOT NULL) AND (vendor_dispatch_id IS NOT NULL))))$e$),
 ('calendar_events_all_day_ck',$e$((NOT all_day) OR ((((starts_at AT TIME ZONE 'Asia/Tokyo'::text))::time without time zone = '00:00:00'::time without time zone) AND (ends_at IS NOT NULL) AND (((ends_at AT TIME ZONE 'Asia/Tokyo'::text))::time without time zone = '00:00:00'::time without time zone)))$e$)
), checks as (
 select e.*,exists(select 1 from pg_catalog.pg_constraint c where c.conrelid=t.oid and c.conname=e.name
 and c.contype='c' and c.convalidated and not c.connoinherit
 and pg_catalog.pg_get_expr(c.conbin,c.conrelid)=e.expression) matches
 from expected_checks e cross join target t
), guard as (
 select exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang
 where p.oid=to_regprocedure('public.calendar_events_guard()') and p.prorettype='trigger'::regtype
 and p.prokind='f' and not p.prosecdef and l.lanname='plpgsql'
 and p.proconfig=array['search_path=""']::text[]
 and not has_function_privilege('anon',p.oid,'EXECUTE')
 and not has_function_privilege('authenticated',p.oid,'EXECUTE')
 and not has_function_privilege('service_role',p.oid,'EXECUTE')) function_matches,
 exists(select 1 from pg_catalog.pg_trigger g where g.tgrelid=t.oid and not g.tgisinternal
 and g.tgname='calendar_events_guard' and g.tgtype=23 and g.tgenabled in ('O','A')
 and g.tgfoid=to_regprocedure('public.calendar_events_guard()') and g.tgqual is null and g.tgnargs=0) trigger_matches
 from target t
), expected_policies(name,command,qual,with_check) as (values
 ('calendar_events_read','SELECT',$p$private.has_org_role(organization_id, ARRAY['admin'::text, 'manager'::text, 'staff'::text, 'viewer'::text])$p$,null),
 ('calendar_events_insert','INSERT',null,$p$((created_by = auth.uid()) AND (status = 'scheduled'::text) AND private.has_org_role(organization_id, ARRAY['admin'::text, 'manager'::text, 'staff'::text]))$p$),
 ('calendar_events_update','UPDATE',$p$private.has_org_role(organization_id, ARRAY['admin'::text, 'manager'::text, 'staff'::text])$p$,$p$private.has_org_role(organization_id, ARRAY['admin'::text, 'manager'::text, 'staff'::text])$p$)
), policies as (
 select e.*,exists(select 1 from pg_catalog.pg_policies p where p.schemaname='public' and p.tablename='calendar_events'
 and p.policyname=e.name and p.cmd=e.command and p.permissive='PERMISSIVE'
 and p.roles::text[]=array['authenticated']::text[] and p.qual is not distinct from e.qual
 and p.with_check is not distinct from e.with_check) matches from expected_policies e
), acl as (
 select r.name,has_table_privilege(r.name,t.oid,'SELECT') can_select,
 has_table_privilege(r.name,t.oid,'INSERT') can_insert,has_table_privilege(r.name,t.oid,'UPDATE') can_update,
 has_table_privilege(r.name,t.oid,'DELETE') can_delete,has_table_privilege(r.name,t.oid,'TRUNCATE') can_truncate,
 has_any_column_privilege(r.name,t.oid,'SELECT') column_select,
 has_any_column_privilege(r.name,t.oid,'INSERT') column_insert,
 has_any_column_privilege(r.name,t.oid,'UPDATE') column_update
 from (values('anon'),('authenticated'),('service_role'))r(name) cross join target t
), prerequisites as (
 select e.name,c.oid,c.relkind,c.relrowsecurity,
 coalesce(c.relkind='r' and c.relrowsecurity,false) matches
 from (values('organizations'),('repair_requests'),('repair_vendor_dispatches'),('organization_members')) e(name)
 left join pg_catalog.pg_class c on c.oid=to_regclass('public.'||e.name)
), helpers as (
 select to_regprocedure('auth.uid()') is not null auth_uid_exists,
 exists(select 1 from pg_catalog.pg_proc p where p.oid=to_regprocedure('private.has_org_role(uuid,text[])')
 and p.prorettype='boolean'::regtype and p.prosecdef
 and has_function_privilege('authenticated',p.oid,'EXECUTE')) role_helper_matches,
 coalesce(has_schema_privilege('authenticated',to_regnamespace('private'),'USAGE'),false) private_usage,
 (select count(*)=2 and bool_and(not rolsuper and not rolbypassrls)
 from pg_catalog.pg_roles where rolname in ('anon','authenticated')) browser_roles_respect_rls
), object_counts as (
 select (select count(*) from pg_catalog.pg_class where oid=t.oid and relkind='r') tables,
 (select count(*) from pg_catalog.pg_index where indrelid=t.oid) indexes,
 -- NOT NULL constraints are catalog objects only on newer PostgreSQL versions.
 (select count(*) from pg_catalog.pg_constraint where conrelid=t.oid and contype<>'n') constraints,
 (select count(*) from pg_catalog.pg_trigger where tgrelid=t.oid and not tgisinternal) triggers,
 (select count(*) from pg_catalog.pg_proc where pronamespace='public'::regnamespace and proname='calendar_events_guard') functions,
 (select count(*) from pg_catalog.pg_policies where schemaname='public' and tablename='calendar_events') policies
 from target t
), table_state as (
 select t.oid,c.relkind,c.relrowsecurity,(select count(*) from public.calendar_events) initial_rows
 from target t left join pg_catalog.pg_class c on c.oid=t.oid
), sections(seq,item,all_match,details) as (
 select 1,'calendar_events table RLS and initial count',oid is not null and relkind='r' and relrowsecurity and initial_rows=0,to_jsonb(s) from table_state s
 union all select 2,'required columns',bool_and(matches),jsonb_agg(to_jsonb(c) order by name) from columns c
 union all select 3,'primary key and indexes',bool_and(matches),jsonb_agg(to_jsonb(i)) from indexes i
 union all select 4,'validated foreign keys',bool_and(matches),jsonb_agg(to_jsonb(f)) from fks f
 union all select 5,'CHECK constraints',bool_and(matches),jsonb_agg(to_jsonb(c)) from checks c
 union all select 6,'guard function and trigger',function_matches and trigger_matches,to_jsonb(g) from guard g
 union all select 7,'RLS policies',bool_and(matches) and (select policies=3 from object_counts)
 and (select role_helper_matches and auth_uid_exists and private_usage and browser_roles_respect_rls from helpers),
 jsonb_build_object('policies',jsonb_agg(to_jsonb(p)),'helpers',(select to_jsonb(h) from helpers h),
 'limit','Exact policy catalog check; assumes the existing has_org_role helper enforces active organization membership and roles.') from policies p
 union all select 8,'table and column ACL',bool_and(can_select=(name='authenticated') and can_insert=(name='authenticated')
 and can_update=(name='authenticated') and not can_delete and not can_truncate
 and column_select=(name='authenticated') and column_insert=(name='authenticated') and column_update=(name='authenticated')),
 jsonb_agg(to_jsonb(a)) from acl a
 union all select 9,'existing prerequisite tables and RLS',bool_and(matches),jsonb_agg(to_jsonb(p)) from prerequisites p
 union all select 10,'exact object counts',tables=1 and indexes=3 and constraints=14 and triggers=1 and functions=1 and policies=3,to_jsonb(c) from object_counts c
), report as (
 select seq,item,jsonb_build_object('all_match',coalesce(all_match,false),'details',details) result from sections
 union all select 11,'overall readiness',jsonb_build_object('overall_ready',bool_and(coalesce(all_match,false)),
 'section_results',jsonb_object_agg(item,coalesce(all_match,false) order by seq)) from sections
)
select item,result from report order by seq;
