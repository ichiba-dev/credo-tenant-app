-- Supabase SQL Editor: one read-only SELECT before photo-selection migration.
with required_relations(name) as (values
  ('repair_vendor_dispatch_messages'),('repair_vendor_dispatches'),
  ('repair_vendor_dispatch_events'),('repair_photos'),
  ('tenant_line_attachments'),('repair_requests'),('organization_members')
), relations as (
  select r.name,c.oid,c.relkind,c.relrowsecurity
  from required_relations r left join pg_catalog.pg_class c
    on c.oid=to_regclass('public.'||r.name) and c.relkind in ('r','p')
), required_columns(table_name,column_name,type_name,expected_not_null) as (values
  ('repair_vendor_dispatch_messages','id','uuid',true),
  ('repair_vendor_dispatch_messages','organization_id','uuid',true),
  ('repair_vendor_dispatch_messages','dispatch_id','uuid',true),
  ('repair_vendor_dispatch_messages','sent_by','uuid',true),
  ('repair_vendor_dispatch_messages','request_id','uuid',true),
  ('repair_vendor_dispatch_messages','message_body','text',true),
  ('repair_vendor_dispatch_messages','recipient_label','text',true),
  ('repair_vendor_dispatch_messages','recipient_address','text',false),
  ('repair_vendor_dispatch_messages','channel','text',true),
  ('repair_vendor_dispatch_messages','delivery_status','text',true),
  ('repair_vendor_dispatch_messages','sent_at','timestamp with time zone',false),
  ('repair_vendor_dispatch_messages','created_at','timestamp with time zone',true),
  ('repair_vendor_dispatches','id','uuid',true),
  ('repair_vendor_dispatches','organization_id','uuid',true),
  ('repair_vendor_dispatches','repair_request_id','bigint',true),
  ('repair_vendor_dispatches','status','text',true),
  ('repair_photos','organization_id','uuid',true),
  -- Either nullable or NOT NULL is compatible; selected attachments require a repair.
  ('repair_photos','repair_id','bigint',null::boolean),
  ('tenant_line_attachments','id','uuid',true),
  ('tenant_line_attachments','organization_id','uuid',true),
  ('tenant_line_attachments','repair_request_id','bigint',false),
  ('tenant_line_attachments','media_type','text',true),
  ('repair_requests','id','bigint',true),
  ('repair_requests','organization_id','uuid',true),
  ('repair_requests','photo_url','text',false),
  ('repair_requests','storage_path','text',false),
  ('organization_members','organization_id','uuid',true),
  ('organization_members','auth_user_id','uuid',true),
  ('organization_members','is_active','boolean',true),
  ('organization_members','role','text',true)
), columns as (
  select e.*,a.attnum,pg_catalog.format_type(a.atttypid,a.atttypmod) actual_type,
    a.attnotnull actual_not_null
  from required_columns e left join pg_catalog.pg_attribute a
    on a.attrelid=to_regclass('public.'||e.table_name)
      and a.attname=e.column_name and a.attnum>0 and not a.attisdropped
), photo_data as (
  select count(*) total_rows,
    count(*) filter (where p.organization_id is null) null_organization_rows,
    count(*) filter (where p.repair_id is null) null_repair_rows,
    count(*) filter (where p.repair_id is not null and not exists
      (select 1 from public.repair_requests x where x.id=p.repair_id)) orphan_rows,
    count(*) filter (where p.repair_id is not null and r.id is null and exists
      (select 1 from public.repair_requests x where x.id=p.repair_id)) cross_org_rows,
    count(*) filter (where p.organization_id is not null and p.repair_id is not null
      and r.id is null) missing_same_org_repair_rows
  from public.repair_photos p left join public.repair_requests r
    on r.organization_id=p.organization_id and r.id=p.repair_id
), line_data as (
  select count(*) total_rows,
    count(*) filter (where a.repair_request_id is not null) linked_rows,
    count(*) filter (where a.id is null) null_id_rows,
    count(*) filter (where a.organization_id is null) null_organization_rows,
    count(*) filter (where a.repair_request_id is not null and r.id is null)
      missing_same_org_repair_rows
  from public.tenant_line_attachments a left join public.repair_requests r
    on r.organization_id=a.organization_id and r.id=a.repair_request_id
), link_data as (
  select
    (select count(*) from public.repair_vendor_dispatches d
      left join public.repair_requests r
        on r.organization_id=d.organization_id and r.id=d.repair_request_id
      where r.id is null) dispatch_missing_same_org_repair_rows,
    (select count(*) from public.repair_vendor_dispatch_messages m
      left join public.repair_vendor_dispatches d
        on d.organization_id=m.organization_id and d.id=m.dispatch_id
      where d.id is null) message_missing_same_org_dispatch_rows,
    (select count(*) from public.repair_vendor_dispatch_messages m
      left join public.organization_members u
        on u.organization_id=m.organization_id and u.auth_user_id=m.sent_by
      where u.auth_user_id is null) message_missing_same_org_member_rows
), message_table as (
  select oid,relrowsecurity from relations
  where name='repair_vendor_dispatch_messages'
), message_state as (
  select (select count(*) from public.repair_vendor_dispatch_messages) total_rows,
    m.oid,m.relrowsecurity,
    coalesce(has_table_privilege('anon',m.oid,'SELECT'),false) anon_select,
    coalesce(has_table_privilege('authenticated',m.oid,'SELECT'),false) authenticated_select,
    coalesce(has_table_privilege('anon',m.oid,'INSERT'),false) anon_insert,
    coalesce(has_table_privilege('anon',m.oid,'UPDATE'),false) anon_update,
    coalesce(has_table_privilege('anon',m.oid,'DELETE'),false) anon_delete,
    coalesce(has_table_privilege('authenticated',m.oid,'INSERT'),false) authenticated_insert,
    coalesce(has_table_privilege('authenticated',m.oid,'UPDATE'),false) authenticated_update,
    coalesce(has_table_privilege('authenticated',m.oid,'DELETE'),false) authenticated_delete,
    (select count(*) from pg_catalog.pg_trigger t where t.tgrelid=m.oid
      and not t.tgisinternal and t.tgname='vendor_dispatch_messages_immutable'
      and t.tgtype=27 and t.tgenabled in ('O','A')
      and t.tgfoid=to_regprocedure('public._vendor_phase1_no_change()')) immutable_trigger_count,
    (select count(*) from pg_catalog.pg_trigger t where t.tgrelid=m.oid
      and not t.tgisinternal and t.tgname='vendor_dispatch_messages_immutable')
      named_trigger_count,
    (select count(*) from pg_catalog.pg_policies p
      where p.schemaname='public' and p.tablename='repair_vendor_dispatch_messages'
        and p.policyname='repair_vendor_dispatch_messages_staff_read'
        and p.cmd='SELECT' and p.permissive='PERMISSIVE'
        and p.roles::text[]=array['authenticated']::text[]
        -- Exact deparsed expression: no substring/whitespace stripping that could
        -- hide extra predicates or alter string literals. Unknown forms fail closed.
        and p.qual = $policy$private.has_org_role(organization_id, ARRAY['admin'::text, 'manager'::text, 'staff'::text, 'viewer'::text])$policy$
        and p.with_check is null) expected_read_policy_count,
    (select count(*) from pg_catalog.pg_policies p
      where p.schemaname='public' and p.tablename='repair_vendor_dispatch_messages')
      total_policy_count,
    not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid=m.oid
      and a.attname='photo_selection_recorded' and a.attnum>0 and not a.attisdropped)
      marker_absent
  from message_table m
), rpc_expected(function_name,signature,authenticated_execute,service_role_execute) as (values
  ('confirm_vendor_dispatch_manual',
    'public.confirm_vendor_dispatch_manual(uuid,uuid,uuid,uuid,text,text,text)',false,true),
  ('transition_repair_vendor_dispatch',
    'public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)',true,false)
), rpc_state as (
  select e.*,
    (select count(*) from pg_catalog.pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname=e.function_name) overload_count,
    to_regprocedure(e.signature) function_oid
  from rpc_expected e
), rpc_checks as (
  select r.*,p.prosecdef,
    coalesce(has_function_privilege('anon',r.function_oid,'EXECUTE'),false) anon_execute,
    coalesce(has_function_privilege('authenticated',r.function_oid,'EXECUTE'),false)
      actual_authenticated_execute,
    coalesce(has_function_privilege('service_role',r.function_oid,'EXECUTE'),false)
      actual_service_role_execute
  from rpc_state r left join pg_catalog.pg_proc p on p.oid=r.function_oid
), required_keys(item,table_name,column_names) as (values
  ('message id','repair_vendor_dispatch_messages',array['id']),
  ('dispatch id','repair_vendor_dispatches',array['id']),
  ('message organization/id','repair_vendor_dispatch_messages',array['organization_id','id']),
  ('message organization/request_id','repair_vendor_dispatch_messages',array['organization_id','request_id']),
  ('dispatch organization/id','repair_vendor_dispatches',array['organization_id','id']),
  ('LINE attachment id','tenant_line_attachments',array['id']),
  ('repair request id','repair_requests',array['id']),
  ('member organization/auth_user_id','organization_members',array['organization_id','auth_user_id'])
), key_checks as (
  select e.item,exists (select 1 from pg_catalog.pg_constraint k
    where k.conrelid=to_regclass('public.'||e.table_name) and k.contype in ('p','u')
      and k.convalidated and not k.condeferrable and not k.condeferred
      and exists (select 1 from pg_catalog.pg_index i where i.indexrelid=k.conindid
        and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
        and i.indpred is null and i.indexprs is null)
      and k.conkey=array(select a.attnum::smallint from unnest(e.column_names)
        with ordinality u(column_name,ord)
        join pg_catalog.pg_attribute a on a.attrelid=k.conrelid
          and a.attname=u.column_name and a.attnum>0 and not a.attisdropped
        order by u.ord)::smallint[]) matches
  from required_keys e
), fk_checks as (
  select 'message organization/dispatch to dispatch organization/id' item,
    exists (select 1 from pg_catalog.pg_constraint k where k.contype='f'
      and k.convalidated and not k.condeferrable and not k.condeferred
      and k.confupdtype='a' and k.confdeltype='a' and k.confmatchtype='s'
      and k.conrelid=to_regclass('public.repair_vendor_dispatch_messages')
      and k.confrelid=to_regclass('public.repair_vendor_dispatches')
      and k.conkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=k.conrelid and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=k.conrelid and attname='dispatch_id')]::smallint[]
      and k.confkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=k.confrelid and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=k.confrelid and attname='id')]::smallint[]) matches
  union all
  select 'message organization/sent_by to member organization/auth_user_id',
    exists (select 1 from pg_catalog.pg_constraint k where k.contype='f'
      and k.convalidated and not k.condeferrable and not k.condeferred
      and k.confupdtype='a' and k.confdeltype='a' and k.confmatchtype='s'
      and k.conrelid=to_regclass('public.repair_vendor_dispatch_messages')
      and k.confrelid=to_regclass('public.organization_members')
      and k.conkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=k.conrelid and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=k.conrelid and attname='sent_by')]::smallint[]
      and k.confkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=k.confrelid and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=k.confrelid and attname='auth_user_id')]::smallint[])
), required_checks(table_name,column_names,expression) as (values
  ('repair_vendor_dispatches',array['status'],
    $e$(status = ANY (ARRAY['candidate'::text, 'dispatched'::text, 'acknowledged'::text, 'scheduling'::text, 'visit_scheduled'::text, 'completed'::text, 'cancelled'::text]))$e$),
  ('repair_vendor_dispatch_messages',array['channel'],
    $e$(channel ~ '^[a-z][a-z0-9_]{1,39}$'::text)$e$),
  ('repair_vendor_dispatch_messages',array['message_body'],
    $e$((length(btrim(message_body)) >= 1) AND (length(btrim(message_body)) <= 10000))$e$),
  ('repair_vendor_dispatch_messages',array['recipient_label'],
    $e$((length(btrim(recipient_label)) >= 1) AND (length(btrim(recipient_label)) <= 300))$e$),
  ('repair_vendor_dispatch_messages',array['recipient_address'],
    $e$((recipient_address IS NULL) OR ((length(btrim(recipient_address)) >= 1) AND (length(btrim(recipient_address)) <= 500)))$e$),
  ('repair_vendor_dispatch_messages',array['delivery_status'],
    $e$(delivery_status ~ '^[a-z][a-z0-9_]{1,39}$'::text)$e$),
  ('repair_vendor_dispatch_messages',array['channel','delivery_status','sent_at'],
    $e$((channel <> 'manual'::text) OR ((delivery_status = 'manual_confirmed'::text) AND (sent_at IS NOT NULL)))$e$),
  ('repair_vendor_dispatch_messages',array['sent_at','created_at'],
    $e$((sent_at IS NULL) OR (sent_at <= created_at))$e$)
), check_checks as (
  select e.table_name,e.column_names,exists (
    select 1 from pg_catalog.pg_constraint k
    where k.conrelid=to_regclass('public.'||e.table_name) and k.contype='c'
      and k.convalidated and not k.condeferrable and not k.condeferred
      and not k.connoinherit
      and array(select a.attname::text from unnest(k.conkey) with ordinality u(n,ord)
        join pg_catalog.pg_attribute a on a.attrelid=k.conrelid and a.attnum=u.n
        order by u.ord)=e.column_names
      and pg_catalog.pg_get_expr(k.conbin,k.conrelid)=e.expression
  ) matches from required_checks e
), planned_objects(kind,name) as (values
  ('relation','repair_vendor_dispatch_message_attachments'),
  ('relation','repair_vendor_dispatch_message_attachments_pkey'),
  ('constraint','repair_vendor_dispatch_message_attachments_pkey'),
  ('constraint','repair_vendor_dispatch_message_attachments_sort_order_check'),
  ('relation','vendor_dispatch_repair_photos_org_id_uq'),
  ('constraint','vendor_dispatch_repair_photos_org_id_uq'),
  ('relation','vendor_dispatch_line_attachments_org_id_uq'),
  ('constraint','vendor_dispatch_line_attachments_org_id_uq'),
  ('relation','vendor_dispatch_repair_scope_uq'),
  ('constraint','vendor_dispatch_repair_scope_uq'),
  ('relation','vendor_dispatch_message_scope_uq'),
  ('constraint','vendor_dispatch_message_scope_uq'),
  ('relation','vendor_dispatch_message_attachment_photo_uq'),
  ('relation','vendor_dispatch_message_attachment_line_uq'),
  ('relation','vendor_dispatch_message_attachment_legacy_uq'),
  ('relation','vendor_dispatch_message_attachment_order_uq'),
  ('constraint','vendor_dispatch_message_attachment_order_uq'),
  ('constraint','vendor_dispatch_message_attachment_source_ck'),
  ('constraint','vendor_dispatch_message_attachment_legacy_key_ck'),
  ('constraint','vendor_dispatch_message_attachment_file_name_ck'),
  ('constraint','vendor_dispatch_message_attachment_mime_ck'),
  ('constraint','vendor_dispatch_message_attachment_message_fk'),
  ('constraint','vendor_dispatch_message_attachment_dispatch_fk'),
  ('constraint','vendor_dispatch_message_attachment_photo_fk'),
  ('constraint','vendor_dispatch_message_attachment_line_fk'),
  ('trigger','vendor_dispatch_attachment_scope_guard'),
  ('trigger','vendor_dispatch_attachment_immutable'),
  ('policy','vendor_dispatch_message_attachments_staff_read'),
  ('function','_vendor_dispatch_attachment_scope_guard'),
  ('function','confirm_vendor_dispatch_manual_v2')
), collisions as (
  select p.kind,p.name,case p.kind
    when 'relation' then to_regclass('public.'||p.name) is not null
    when 'constraint' then exists (select 1 from pg_catalog.pg_constraint c where c.conname=p.name)
    when 'trigger' then exists (select 1 from pg_catalog.pg_trigger t where t.tgname=p.name)
    when 'policy' then exists (select 1 from pg_catalog.pg_policies x where x.policyname=p.name)
    else exists (select 1 from pg_catalog.pg_proc f
      where f.pronamespace='public'::regnamespace and f.proname=p.name) end collision
  from planned_objects p
), photo_identity as (
  select a.attnum is not null id_exists,
    pg_catalog.format_type(a.atttypid,a.atttypmod) actual_type,
    a.attnotnull actual_not_null,a.attgenerated,a.attidentity,
    pg_catalog.pg_get_expr(d.adbin,d.adrelid) default_expression,
    coalesce((select jsonb_agg(jsonb_build_object(
      'name',ic.relname,'unique',i.indisunique,'valid',i.indisvalid,
      'ready',i.indisready,'immediate',i.indimmediate,
      'definition',pg_catalog.pg_get_indexdef(i.indexrelid)) order by ic.relname)
      from pg_catalog.pg_index i join pg_catalog.pg_class ic on ic.oid=i.indexrelid
      where i.indrelid=a.attrelid),'[]'::jsonb) existing_indexes,
    exists (select 1 from pg_catalog.pg_index i where i.indrelid=a.attrelid
      and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
      and i.indpred is null and i.indexprs is null
      and (array(select x.attname::text from unnest(i.indkey) with ordinality u(n,o)
        join pg_catalog.pg_attribute x on x.attrelid=i.indrelid and x.attnum=u.n
        where u.o<=i.indnkeyatts order by u.o)
        in (array['id'],array['organization_id','id'],array['id','organization_id']))) compatible_unique_key
  from (values (1)) seed(n) left join pg_catalog.pg_attribute a
    on a.attrelid=to_regclass('public.repair_photos') and a.attname='id'
      and a.attnum>0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
), photo_identity_check as (
  select p.*,coalesce(id_exists and actual_type='bigint' and actual_not_null
    and compatible_unique_key,false) compatible
  from photo_identity p
), prerequisites as (
  select to_regprocedure('public._vendor_phase1_no_change()') is not null immutable_guard_exists,
    to_regprocedure('private.has_org_role(uuid,text[])') is not null role_guard_exists,
    to_regprocedure('gen_random_uuid()') is not null uuid_generator_exists,
    (select compatible from photo_identity_check) repair_photo_id_compatible,
    (select to_jsonb(p) from photo_identity_check p) repair_photo_identity,
    not exists (select 1 from pg_catalog.pg_attribute where
      attrelid=to_regclass('public.repair_vendor_dispatch_messages')
      and attname='photo_selection_recorded' and attnum>0 and not attisdropped)
      selection_marker_absent
), section_checks(seq,item,all_match,details) as (
  select 1,'required relations and RLS',bool_and(oid is not null and coalesce(relrowsecurity,false)),
    jsonb_agg(jsonb_build_object('name',name,'exists',oid is not null,
      'relkind',relkind,'rls_enabled',relrowsecurity) order by name) from relations
  union all
  select 2,'required columns: type and nullability',
    bool_and(attnum is not null and actual_type=type_name
      and (expected_not_null is null or actual_not_null=expected_not_null)),
    jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,
      'exists',attnum is not null,'expected_type',type_name,'actual_type',actual_type,
      'expected_not_null',expected_not_null,'actual_not_null',actual_not_null,
      'matches_expected',attnum is not null and actual_type=type_name
        and (expected_not_null is null or actual_not_null=expected_not_null)) order by table_name,column_name) from columns
  union all
  select 3,'repair_photos existing data',
    null_organization_rows=0 and missing_same_org_repair_rows=0,
    to_jsonb(p) from photo_data p
  union all
  select 4,'tenant LINE attachment existing data',
    null_id_rows=0 and null_organization_rows=0 and missing_same_org_repair_rows=0,
    to_jsonb(l) from line_data l
  union all
  select 5,'existing message security and history',
    oid is not null and relrowsecurity and marker_absent
      and immutable_trigger_count=1 and named_trigger_count=1
      and expected_read_policy_count=1 and total_policy_count=1
      and not anon_select and authenticated_select
      and not anon_insert and not anon_update and not anon_delete
      and not authenticated_insert and not authenticated_update and not authenticated_delete,
    to_jsonb(m) from message_state m
  union all
  select 6,'existing RPC signatures and ACL',
    bool_and(overload_count=1 and function_oid is not null and prosecdef
      and not anon_execute
      and actual_authenticated_execute=authenticated_execute
      and actual_service_role_execute=service_role_execute),
    jsonb_agg(to_jsonb(r) order by function_name) from rpc_checks r
  union all
  select 7,'existing composite keys and foreign keys',
    (select bool_and(matches) from key_checks) and
      (select bool_and(matches) from fk_checks) and
      (select bool_and(matches) from check_checks),
    jsonb_build_object('keys',(select jsonb_agg(to_jsonb(k) order by item) from key_checks k),
      'foreign_keys',(select jsonb_agg(to_jsonb(f) order by item) from fk_checks f),
      'checks',(select jsonb_agg(to_jsonb(c) order by table_name,column_names) from check_checks c))
  union all
  select 8,'planned object collisions',not bool_or(collision),
    jsonb_agg(to_jsonb(c) order by kind,name) from collisions c
  union all
  select 9,'existing dispatch and message links',
    dispatch_missing_same_org_repair_rows=0
      and message_missing_same_org_dispatch_rows=0
      and message_missing_same_org_member_rows=0,
    to_jsonb(l) from link_data l
  union all
  select 10,'migration prerequisites',
    immutable_guard_exists and role_guard_exists and uuid_generator_exists
      and repair_photo_id_compatible and selection_marker_absent,
    to_jsonb(p) from prerequisites p
), report as (
  select seq,item,jsonb_build_object('all_match',coalesce(all_match,false),
    'details',details) result from section_checks
  union all
  select 11,'overall readiness',jsonb_build_object('overall_ready',
    coalesce(bool_and(coalesce(all_match,false)),false),
    'section_results',jsonb_object_agg(item,to_jsonb(coalesce(all_match,false)) order by seq))
  from section_checks
)
select item,result from report order by seq;
