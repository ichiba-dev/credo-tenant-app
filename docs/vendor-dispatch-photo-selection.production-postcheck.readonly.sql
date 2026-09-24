-- Run as postgres in Supabase SQL Editor immediately after migration, BEFORE v2 use.
-- Single read-only SELECT. Nonzero attachments / true markers fail this immediate-postcheck.
-- ID preservation cannot be proved without a pre-migration ID list/hash: compare the
-- returned ID list/hash with an independent baseline. Counts alone do not prove identity.
-- Missing required tables/columns may raise an SQL error: treat that as NO-GO.
with required_relations(name) as (values
  ('repair_vendor_dispatch_messages'),('repair_vendor_dispatches'),
  ('repair_vendor_dispatch_message_attachments'),
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
  ('repair_vendor_dispatch_message_attachments','id','uuid',true),
  ('repair_vendor_dispatch_message_attachments','organization_id','uuid',true),
  ('repair_vendor_dispatch_message_attachments','message_id','uuid',true),
  ('repair_vendor_dispatch_message_attachments','dispatch_id','uuid',true),
  ('repair_vendor_dispatch_message_attachments','repair_request_id','bigint',true),
  ('repair_vendor_dispatch_message_attachments','source_type','text',true),
  ('repair_vendor_dispatch_message_attachments','repair_photo_id','bigint',false),
  ('repair_vendor_dispatch_message_attachments','tenant_line_attachment_id','uuid',false),
  ('repair_vendor_dispatch_message_attachments','legacy_source_key','text',false),
  ('repair_vendor_dispatch_message_attachments','file_name','text',false),
  ('repair_vendor_dispatch_message_attachments','mime_type','text',false),
  ('repair_vendor_dispatch_message_attachments','sort_order','integer',true),
  ('repair_vendor_dispatch_message_attachments','created_at','timestamp with time zone',true),
  ('repair_vendor_dispatch_messages','photo_selection_recorded','boolean',true),
  ('repair_photos','id','bigint',true),
  ('repair_photos','organization_id','uuid',true),
  -- Either nullable or NOT NULL is compatible; selected attachments require a repair.
  ('repair_photos','repair_id','bigint',false),
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
    exists (select 1 from pg_catalog.pg_attribute a where a.attrelid=m.oid
      and a.attname='photo_selection_recorded' and a.attnum>0 and not a.attisdropped)
      marker_present
  from message_table m
), rpc_expected(function_name,signature,authenticated_execute,service_role_execute) as (values
  ('confirm_vendor_dispatch_manual_v2',
    'public.confirm_vendor_dispatch_manual_v2(uuid,uuid,uuid,uuid,text,text,text,jsonb)',false,true),
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
), expected_added_constraints(table_name,name,kind,column_names,target_table,target_columns,expression) as (values
  ('repair_photos','vendor_dispatch_repair_photos_org_id_uq','u',array['organization_id','repair_id','id']::text[],null,null::text[],null),
  ('tenant_line_attachments','vendor_dispatch_line_attachments_org_id_uq','u',array['organization_id','repair_request_id','id']::text[],null,null::text[],null),
  ('repair_vendor_dispatches','vendor_dispatch_repair_scope_uq','u',array['organization_id','repair_request_id','id']::text[],null,null::text[],null),
  ('repair_vendor_dispatch_messages','vendor_dispatch_message_scope_uq','u',array['organization_id','id','dispatch_id']::text[],null,null::text[],null),
  ('repair_vendor_dispatch_message_attachments','repair_vendor_dispatch_message_attachments_pkey','p',array['id']::text[],null,null::text[],null),
  ('repair_vendor_dispatch_message_attachments','vendor_dispatch_message_attachment_order_uq','u',array['organization_id','message_id','sort_order']::text[],null,null::text[],null),
  ('repair_vendor_dispatch_message_attachments','vendor_dispatch_message_attachment_message_fk','f',array['organization_id','message_id','dispatch_id']::text[],'repair_vendor_dispatch_messages',array['organization_id','id','dispatch_id']::text[],null),
  ('repair_vendor_dispatch_message_attachments','vendor_dispatch_message_attachment_dispatch_fk','f',array['organization_id','repair_request_id','dispatch_id']::text[],'repair_vendor_dispatches',array['organization_id','repair_request_id','id']::text[],null),
  ('repair_vendor_dispatch_message_attachments','vendor_dispatch_message_attachment_photo_fk','f',array['organization_id','repair_request_id','repair_photo_id']::text[],'repair_photos',array['organization_id','repair_id','id']::text[],null),
  ('repair_vendor_dispatch_message_attachments','vendor_dispatch_message_attachment_line_fk','f',array['organization_id','repair_request_id','tenant_line_attachment_id']::text[],'tenant_line_attachments',array['organization_id','repair_request_id','id']::text[],null),
  ('repair_vendor_dispatch_message_attachments','repair_vendor_dispatch_message_attachments_sort_order_check','c',array['sort_order']::text[],null,null::text[],'((sort_order >= 0) AND (sort_order <= 29))'),
  ('repair_vendor_dispatch_message_attachments','vendor_dispatch_message_attachment_source_ck','c',array['source_type','repair_photo_id','tenant_line_attachment_id','legacy_source_key']::text[],null,null::text[],'(((source_type = ''repair_photo''::text) AND (repair_photo_id IS NOT NULL) AND (tenant_line_attachment_id IS NULL) AND (legacy_source_key IS NULL)) OR ((source_type = ''tenant_line_attachment''::text) AND (repair_photo_id IS NULL) AND (tenant_line_attachment_id IS NOT NULL) AND (legacy_source_key IS NULL)) OR ((source_type = ''legacy_photo''::text) AND (repair_photo_id IS NULL) AND (tenant_line_attachment_id IS NULL) AND (legacy_source_key IS NOT NULL)))'),
  ('repair_vendor_dispatch_message_attachments','vendor_dispatch_message_attachment_legacy_key_ck','c',array['legacy_source_key']::text[],null,null::text[],'((legacy_source_key IS NULL) OR ((length(legacy_source_key) >= 1) AND (length(legacy_source_key) <= 100)))'),
  ('repair_vendor_dispatch_message_attachments','vendor_dispatch_message_attachment_file_name_ck','c',array['file_name']::text[],null,null::text[],'((file_name IS NULL) OR ((length(file_name) >= 1) AND (length(file_name) <= 300)))'),
  ('repair_vendor_dispatch_message_attachments','vendor_dispatch_message_attachment_mime_ck','c',array['mime_type']::text[],null,null::text[],'((mime_type IS NULL) OR ((length(mime_type) >= 1) AND (length(mime_type) <= 100)))')
), added_constraints as (
 select e.*,exists(select 1 from pg_catalog.pg_constraint c
  where c.conrelid=to_regclass('public.'||e.table_name) and c.conname=e.name
   and c.contype::text=e.kind and c.convalidated and not c.condeferrable and not c.condeferred
   and array(select a.attname::text from unnest(c.conkey) with ordinality u(n,o)
    join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=u.n order by u.o)=e.column_names
   and case e.kind when 'f' then
    c.confrelid=to_regclass('public.'||e.target_table)
    and c.confupdtype='a' and c.confdeltype='a' and c.confmatchtype='s'
    and array(select a.attname::text from unnest(c.confkey) with ordinality u(n,o)
     join pg_catalog.pg_attribute a on a.attrelid=c.confrelid and a.attnum=u.n order by u.o)=e.target_columns
   when 'c' then not c.connoinherit and pg_catalog.pg_get_expr(c.conbin,c.conrelid)=e.expression
   else exists(select 1 from pg_catalog.pg_index i where i.indexrelid=c.conindid
    and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
    and i.indpred is null and i.indexprs is null) end) matches
 from expected_added_constraints e
), expected_indexes(name,column_name) as (values
 ('vendor_dispatch_message_attachment_photo_uq','repair_photo_id'),
 ('vendor_dispatch_message_attachment_line_uq','tenant_line_attachment_id'),
 ('vendor_dispatch_message_attachment_legacy_uq','legacy_source_key')
), added_indexes as (
 select e.*,exists(select 1 from pg_catalog.pg_index i
  where i.indexrelid=to_regclass('public.'||e.name)
   and i.indrelid=to_regclass('public.repair_vendor_dispatch_message_attachments')
   and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
   and i.indexprs is null and i.indnkeyatts=3
   and pg_catalog.pg_get_expr(i.indpred,i.indrelid)='('||e.column_name||' IS NOT NULL)'
   and array(select a.attname::text from unnest(i.indkey) with ordinality u(n,o)
    join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=u.n
    where u.o<=i.indnkeyatts order by u.o)=array['organization_id','message_id',e.column_name]) matches
 from expected_indexes e
), expected_triggers(name,type_bits,function_signature) as (values
 ('vendor_dispatch_attachment_scope_guard',7,'public._vendor_dispatch_attachment_scope_guard()'),
 ('vendor_dispatch_attachment_immutable',27,'public._vendor_phase1_no_change()')
), attachment_triggers as (
 select e.*,exists(select 1 from pg_catalog.pg_trigger t
  where t.tgrelid=to_regclass('public.repair_vendor_dispatch_message_attachments') and t.tgname=e.name
   and not t.tgisinternal and t.tgtype=e.type_bits and t.tgenabled in ('O','A')
   and t.tgfoid=to_regprocedure(e.function_signature) and t.tgqual is null and t.tgnargs=0) matches
 from expected_triggers e
), attachment_acl as (
 select r.role_name,
  has_table_privilege(r.role_name,'public.repair_vendor_dispatch_message_attachments','SELECT') can_select,
  has_any_column_privilege(r.role_name,'public.repair_vendor_dispatch_message_attachments','INSERT') can_insert,
  has_any_column_privilege(r.role_name,'public.repair_vendor_dispatch_message_attachments','UPDATE') can_update,
  has_table_privilege(r.role_name,'public.repair_vendor_dispatch_message_attachments','DELETE') can_delete,
  has_table_privilege(r.role_name,'public.repair_vendor_dispatch_message_attachments','TRUNCATE') can_truncate
 from (values ('anon'),('authenticated'),('service_role')) r(role_name)
), attachment_policy as (
 select count(*) total_count,count(*) filter(where
  policyname='vendor_dispatch_message_attachments_staff_read'
  and roles::text[]=array['authenticated']::text[] and cmd='SELECT' and permissive='PERMISSIVE'
  and qual=$policy$private.has_org_role(organization_id, ARRAY['admin'::text, 'manager'::text, 'staff'::text, 'viewer'::text])$policy$
  and with_check is null) expected_count
 from pg_catalog.pg_policies where schemaname='public' and tablename='repair_vendor_dispatch_message_attachments'
), immediate_state as (
 select (select count(*) from public.repair_vendor_dispatch_message_attachments) attachment_rows,
  count(*) message_rows,count(*) filter(where photo_selection_recorded is false) false_rows,
  count(*) filter(where photo_selection_recorded is distinct from false) non_false_rows,
  (select pg_catalog.pg_get_expr(d.adbin,d.adrelid) from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
   where a.attrelid=to_regclass('public.repair_vendor_dispatch_messages')
    and a.attname='photo_selection_recorded') marker_default
 from public.repair_vendor_dispatch_messages
), photo_snapshot as (
 select count(*) row_count,count(*) filter(where id is null) null_id_rows,
  count(distinct id) distinct_ids,min(id)::text min_id,max(id)::text max_id,
  jsonb_agg(id::text order by id) current_ids,
  md5(string_agg(id::text,',' order by id)) current_ids_md5,
  'Not provable without a pre-migration ID list/hash; compare this snapshot externally'::text id_preservation_limit
 from public.repair_photos
), photo_identity as (
 select a.attidentity='d' identity_by_default,
  exists(select 1 from pg_catalog.pg_index i where i.indrelid=a.attrelid
   and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
   and i.indpred is null and i.indexprs is null
   and array(select x.attname::text from unnest(i.indkey) with ordinality u(n,o)
    join pg_catalog.pg_attribute x on x.attrelid=i.indrelid and x.attnum=u.n
    where u.o<=i.indnkeyatts order by u.o)=array['id']) unique_id
 from pg_catalog.pg_attribute a where a.attrelid=to_regclass('public.repair_photos')
  and a.attname='id' and not a.attisdropped
), section_checks(seq,item,all_match,details) as (
 select 1,'relations and RLS',bool_and(oid is not null and coalesce(relrowsecurity,false)),
  jsonb_agg(to_jsonb(r) order by name) from relations r
 union all
 select 2,'required columns types and nullability',
  bool_and(attnum is not null and actual_type=type_name and actual_not_null=expected_not_null),
  jsonb_agg(to_jsonb(c) order by table_name,column_name) from columns c
 union all
 select 3,'added PK UNIQUE FK CHECK and partial indexes',
  (select bool_and(matches) from added_constraints) and (select bool_and(matches) from added_indexes),
  jsonb_build_object('constraints',(select jsonb_agg(to_jsonb(c)) from added_constraints c),
   'indexes',(select jsonb_agg(to_jsonb(i)) from added_indexes i))
 union all
 select 4,'attachment triggers',bool_and(matches),jsonb_agg(to_jsonb(t)) from attachment_triggers t
 union all
 select 5,'attachment policy and ACL',
  (select total_count=1 and expected_count=1 from attachment_policy)
  and bool_and(can_select=(role_name<>'anon') and not can_insert and not can_update and not can_delete and not can_truncate),
  jsonb_build_object('policy',(select to_jsonb(p) from attachment_policy p),'acl',jsonb_agg(to_jsonb(a))) from attachment_acl a
 union all
 select 6,'v2 and existing RPC signatures and ACL',
  bool_and(overload_count=1 and function_oid is not null and prosecdef and not anon_execute
   and actual_authenticated_execute=authenticated_execute and actual_service_role_execute=service_role_execute),
  jsonb_agg(to_jsonb(r) order by function_name) from rpc_checks r
 union all
 select 7,'existing message RLS policy ACL and immutable trigger',
  oid is not null and relrowsecurity and marker_present and immutable_trigger_count=1 and named_trigger_count=1
  and expected_read_policy_count=1 and total_policy_count=1 and not anon_select and authenticated_select
  and not anon_insert and not anon_update and not anon_delete
  and not authenticated_insert and not authenticated_update and not authenticated_delete,to_jsonb(m) from message_state m
 union all
 select 8,'existing keys foreign keys and checks',
  (select bool_and(matches) from key_checks) and (select bool_and(matches) from fk_checks)
   and (select bool_and(matches) from check_checks),
  jsonb_build_object('keys',(select jsonb_agg(to_jsonb(k)) from key_checks k),
   'foreign_keys',(select jsonb_agg(to_jsonb(f)) from fk_checks f),
   'checks',(select jsonb_agg(to_jsonb(c)) from check_checks c))
 union all
 select 9,'immediate post-migration messages and attachments',
  attachment_rows=0 and non_false_rows=0 and marker_default='false',
  to_jsonb(s)||jsonb_build_object('scope','Before any v2 use; all current messages must be false. No pre-migration message-ID baseline supplied.') from immediate_state s
 union all
 select 10,'repair photo count identity and data; ID comparison limited',
  s.row_count=48 and s.null_id_rows=0 and s.distinct_ids=48
  and coalesce((select identity_by_default and unique_id from photo_identity),false)
  and p.null_organization_rows=0 and p.null_repair_rows=0 and p.missing_same_org_repair_rows=0,
  to_jsonb(s)||jsonb_build_object('data',to_jsonb(p),'identity',(select to_jsonb(i) from photo_identity i))
  from photo_snapshot s cross join photo_data p
 union all
 select 11,'existing LINE dispatch and message links',
  a.null_id_rows=0 and a.null_organization_rows=0 and a.missing_same_org_repair_rows=0
  and l.dispatch_missing_same_org_repair_rows=0 and l.message_missing_same_org_dispatch_rows=0
  and l.message_missing_same_org_member_rows=0,
  jsonb_build_object('line',to_jsonb(a),'links',to_jsonb(l)) from line_data a cross join link_data l
), report as (
 select seq,item,jsonb_build_object('all_match',coalesce(all_match,false),'details',details) result from section_checks
 union all
 select 12,'overall readiness',jsonb_build_object('overall_ready',coalesce(bool_and(coalesce(all_match,false)),false),
  'section_results',jsonb_object_agg(item,coalesce(all_match,false) order by seq),
  'limit','Readiness is not proof of unchanged historical IDs; compare photo snapshot with a pre-migration baseline.') from section_checks
)
select item,result from report order by seq;
