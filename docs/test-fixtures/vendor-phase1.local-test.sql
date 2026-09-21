-- LOCAL TEST ONLY. Run with psql -v ON_ERROR_STOP=1 against local Supabase.
begin;
create temporary table vendor_test_results (label text primary key);
create function pg_temp.pass(p_label text) returns void language plpgsql as $$
begin insert into vendor_test_results values (p_label); end $$;
create function pg_temp.expect_error(p_sql text,p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    insert into vendor_test_results values (p_label);
    return;
  end;
  raise exception 'Expected failure: %',p_label;
end $$;
create function pg_temp.expect_state(p_sql text,p_state text,p_label text) returns void language plpgsql as $$
declare v_state text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> p_state then raise exception 'Expected SQLSTATE %, got %: %',p_state,v_state,p_label; end if;
    insert into vendor_test_results values (p_label);
    return;
  end;
  raise exception 'Expected failure: %',p_label;
end $$;
create function pg_temp.test_quote(p_quote uuid,p_file uuid,p_req uuid,p_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_dispatch uuid; v_issued timestamptz; v_received timestamptz; v_result uuid;
begin
  select id into v_dispatch from public.repair_vendor_dispatches
    where request_id='dddddddd-0000-4000-8000-000000000001';
  v_issued := clock_timestamp();
  v_received := v_issued - interval '1 day';
  insert into public.vendor_quote_uploads(organization_id,request_id,repair_request_id,
    dispatch_id,actor_auth_user_id,quote_id,file_id,original_filename,file_size,
    content_sha256,received_at,issued_at,expires_at)
  values('11111111-1111-4111-8111-111111111111',p_req,900000000001,
    v_dispatch,'22222222-2222-4222-8222-222222222222',p_quote,p_file,'quote.pdf',100,
    decode(p_hash,'hex'),v_received,v_issued,v_issued+interval '10 minutes')
  on conflict (organization_id,request_id) do nothing;
  select issued_at,received_at into v_issued,v_received from public.vendor_quote_uploads
    where organization_id='11111111-1111-4111-8111-111111111111' and request_id=p_req;
  select id into v_result from public.record_vendor_quote_revision(
    '11111111-1111-4111-8111-111111111111',v_dispatch,p_quote,p_file,p_req,
    '22222222-2222-4222-8222-222222222222',v_issued,v_received,null,null,'floor',
    '[{"description":"Repair","quantity":1,"unit":"job","unit_price_ex_tax":80000,"line_amount_ex_tax":80000,"tax_rate":0.1}]'::jsonb,
    'quote.pdf',100,decode(p_hash,'hex'));
  return v_result;
end;
$$;
grant all on vendor_test_results to authenticated;

do $$
declare n int;
begin
  select count(*) into n from pg_class where relnamespace='public'::regnamespace
    and relname=any(array['repair_vendors','repair_vendor_categories','repair_vendor_areas',
      'repair_vendor_dispatches','repair_vendor_dispatch_events','vendor_quote_versions',
      'vendor_quote_lines','vendor_quote_files','vendor_quote_uploads']);
  if n<>9 then raise exception '9 tables: %',n; end if;
  perform pg_temp.pass('nine_tables');
  select count(*) into n from pg_constraint where conrelid in
    (select oid from pg_class where relnamespace='public'::regnamespace
      and relname like 'repair_vendor%' or relname like 'vendor_quote%')
    and contype in ('p','u','f','c');
  if n<40 then raise exception 'constraint count: %',n; end if;
  perform pg_temp.pass('pk_unique_fk_check');
  select count(*) into n from pg_indexes where schemaname='public'
    and tablename=any(array['repair_vendors','repair_vendor_categories','repair_vendor_areas',
      'repair_vendor_dispatches','repair_vendor_dispatch_events','vendor_quote_versions',
      'vendor_quote_lines','vendor_quote_files']);
  if n<20 then raise exception 'index count: %',n; end if;
  perform pg_temp.pass('indexes');
  select count(*) into n from pg_class where relnamespace='public'::regnamespace
    and relname=any(array['repair_vendors','repair_vendor_categories','repair_vendor_areas',
      'repair_vendor_dispatches','repair_vendor_dispatch_events','vendor_quote_versions',
      'vendor_quote_lines','vendor_quote_files','vendor_quote_uploads']) and relrowsecurity;
  if n<>9 then raise exception 'RLS count: %',n; end if;
  perform pg_temp.pass('rls_all');
  select count(*) into n from pg_policies where schemaname='public'
    and tablename=any(array['repair_vendors','repair_vendor_categories','repair_vendor_areas',
      'repair_vendor_dispatches','repair_vendor_dispatch_events','vendor_quote_versions',
      'vendor_quote_lines','vendor_quote_files'])
    and cmd='SELECT' and qual like '%private.has_org_role(organization_id,%';
  if n<>8 then raise exception 'role policy count: %',n; end if;
  perform pg_temp.pass('has_org_role_policies');
  if to_regprocedure('private.has_org_role(uuid,text[])') is null then raise exception 'role signature'; end if;
  perform pg_temp.pass('has_org_role_signature');
  select count(*) into n from pg_proc where oid in (
    'public.select_repair_vendor(uuid,bigint,uuid,text,uuid)'::regprocedure,
    'public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)'::regprocedure,
    'public.prepare_vendor_quote_upload(uuid,bigint,uuid,uuid,uuid,timestamptz,text,bigint,bytea)'::regprocedure,
    'public.record_vendor_quote_revision(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,date,text,text,jsonb,text,bigint,bytea)'::regprocedure)
    and prosecdef and proconfig::text like '%search_path=%';
  if n<>4 then raise exception 'RPC definer/search_path count: %',n; end if;
  perform pg_temp.pass('rpc_definer_search_path');
  if has_function_privilege('anon','public.select_repair_vendor(uuid,bigint,uuid,text,uuid)','execute')
    or has_function_privilege('anon','public._vendor_phase1_assert_writer(uuid)','execute')
    or not has_function_privilege('authenticated','public.select_repair_vendor(uuid,bigint,uuid,text,uuid)','execute')
    or has_function_privilege('authenticated','public._vendor_phase1_assert_writer(uuid)','execute')
    or has_function_privilege('authenticated','public.record_vendor_quote_revision(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,date,text,text,jsonb,text,bigint,bytea)','execute')
    or has_function_privilege('authenticated','public.prepare_vendor_quote_upload(uuid,bigint,uuid,uuid,uuid,timestamptz,text,bigint,bytea)','execute') then
    raise exception 'RPC execute ACL'; end if;
  perform pg_temp.pass('rpc_execute_acl');
  select count(*) into n from pg_proc where oid in (
    'public._vendor_phase1_no_change()'::regprocedure,
    'public._vendor_master_identity_guard()'::regprocedure,
    'public._vendor_dispatch_guard()'::regprocedure,
    'public._vendor_dispatch_audit()'::regprocedure,
    'public._vendor_phase1_assert_writer(uuid)'::regprocedure)
    and (has_function_privilege('anon',oid,'execute')
      or has_function_privilege('authenticated',oid,'execute'));
  if n<>0 then raise exception 'helper function executable by anon/authenticated'; end if;
  perform pg_temp.pass('helper_execute_denied');
  if has_table_privilege('authenticated','public.vendor_quote_versions','insert')
    or has_table_privilege('anon','public.repair_vendors','select') then raise exception 'table ACL'; end if;
  perform pg_temp.pass('table_acl');
  if not exists (select 1 from storage.buckets where id='vendor-quotes' and public=false
    and file_size_limit=15728640 and allowed_mime_types=array['application/pdf']::text[]) then
    raise exception 'bucket'; end if;
  perform pg_temp.pass('bucket_config');
end $$;

insert into public.organizations(id,is_active)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
insert into public.tenant_accounts(id,organization_id,is_active)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
insert into public.repair_requests(id,organization_id,tenant_account_id)
values (900000000002,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.organization_members(organization_id,auth_user_id,is_active,role) values
('11111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000001',true,'admin'),
('11111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000002',true,'manager'),
('11111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000003',true,'viewer');

set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
set role authenticated;
insert into public.repair_vendors(id,organization_id,company_name,contact_name)
values ('cccccccc-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Local vendor','Contact');
select pg_temp.pass('admin_master_write');
select pg_temp.expect_error($q$update public.repair_vendors set organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where id='cccccccc-0000-4000-8000-000000000001'$q$,'vendor_org_change_denied');
select pg_temp.expect_error($q$insert into public.repair_vendor_dispatches(organization_id,repair_request_id,vendor_id,assigned_by,request_id,instructions) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',900000000002,'cccccccc-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',gen_random_uuid(),'wrong org')$q$,'cross_org_fk_denied');
reset role;

set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000002';
set role authenticated;
update public.repair_vendors set contact_name='Manager contact' where id='cccccccc-0000-4000-8000-000000000001';
select pg_temp.pass('manager_master_write');
reset role;

set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
set role authenticated;
update public.repair_vendors set contact_name='Staff contact' where id='cccccccc-0000-4000-8000-000000000001';
select pg_temp.pass('staff_master_write');
select public.select_repair_vendor('11111111-1111-4111-8111-111111111111',900000000001,
  'cccccccc-0000-4000-8000-000000000001','Inspect leak','dddddddd-0000-4000-8000-000000000001');
select pg_temp.pass('dispatch_created');
select public.select_repair_vendor('11111111-1111-4111-8111-111111111111',900000000001,
  'cccccccc-0000-4000-8000-000000000001','Inspect leak','dddddddd-0000-4000-8000-000000000001');
do $$ begin
 if (select count(*) from public.repair_vendor_dispatches where request_id='dddddddd-0000-4000-8000-000000000001')<>1
 or (select count(*) from public.repair_vendor_dispatch_events where request_id='dddddddd-0000-4000-8000-000000000001')<>1 then
 raise exception 'dispatch idempotency'; end if;
 perform pg_temp.pass('dispatch_idempotency');
end $$;
select pg_temp.expect_error($q$select public.select_repair_vendor('11111111-1111-4111-8111-111111111111',900000000001,'cccccccc-0000-4000-8000-000000000001','different','dddddddd-0000-4000-8000-000000000001')$q$,'request_conflict_denied');
select pg_temp.expect_error($q$select public.transition_repair_vendor_dispatch('11111111-1111-4111-8111-111111111111',(select id from public.repair_vendor_dispatches where request_id='dddddddd-0000-4000-8000-000000000001'),'completed','dddddddd-0000-4000-8000-000000000002')$q$,'invalid_transition_denied');
select public.transition_repair_vendor_dispatch('11111111-1111-4111-8111-111111111111',
  (select id from public.repair_vendor_dispatches where request_id='dddddddd-0000-4000-8000-000000000001'),
  'dispatched','dddddddd-0000-4000-8000-000000000003','sent manually');
select pg_temp.pass('status_transition_and_audit');
select public.transition_repair_vendor_dispatch('11111111-1111-4111-8111-111111111111',
  (select id from public.repair_vendor_dispatches where request_id='dddddddd-0000-4000-8000-000000000001'),
  'dispatched','dddddddd-0000-4000-8000-000000000003','sent manually');
do $$ begin
 if (select count(*) from public.repair_vendor_dispatch_events
   where request_id='dddddddd-0000-4000-8000-000000000003')<>1 then
   raise exception 'transition idempotency'; end if;
 perform pg_temp.pass('transition_idempotency');
end $$;
select pg_temp.expect_error($q$update public.repair_vendor_dispatch_events set note='edit' where request_id='dddddddd-0000-4000-8000-000000000003'$q$,'audit_update_denied');
select pg_temp.expect_error($q$delete from public.repair_vendor_dispatch_events where request_id='dddddddd-0000-4000-8000-000000000003'$q$,'audit_delete_denied');
select pg_temp.expect_error($q$select pg_temp.test_quote('eeeeeeee-0000-4000-8000-000000000001','ffffffff-0000-4000-8000-000000000001','99999999-0000-4000-8000-000000000001',repeat('aa',32))$q$,'missing_pdf_rollback');
reset role;

set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000003';
set role authenticated;
do $$ begin
 if (select count(*) from public.repair_vendors where organization_id='11111111-1111-4111-8111-111111111111')<>1 then raise exception 'viewer select'; end if;
 perform pg_temp.pass('viewer_select');
end $$;
do $$ declare n integer;
begin
 update public.repair_vendors set contact_name='viewer edit'
   where id='cccccccc-0000-4000-8000-000000000001';
 get diagnostics n = row_count;
 if n<>0 then raise exception 'viewer changed rows'; end if;
 perform pg_temp.pass('viewer_write_denied');
end $$;
select pg_temp.expect_error($q$select public.select_repair_vendor('11111111-1111-4111-8111-111111111111',900000000001,'cccccccc-0000-4000-8000-000000000001','no','dddddddd-0000-4000-8000-000000000010')$q$,'viewer_rpc_denied');
reset role;

-- These checks run as the local DB owner to test FK and trigger enforcement,
-- independent of authenticated table ACLs.
select pg_temp.expect_state($q$insert into public.repair_vendor_dispatches
  (organization_id,repair_request_id,vendor_id,assigned_by,request_id,instructions)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',900000000002,
    'cccccccc-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',
    'dddddddd-0000-4000-8000-000000000011','cross')$q$,'23503','cross_org_composite_fk');
select pg_temp.expect_state($q$update public.repair_vendors
  set organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  where id='cccccccc-0000-4000-8000-000000000001'$q$,'P0001','vendor_org_guard');

-- Storage metadata is a local test double; no real Storage policy or upload.
insert into storage.objects(id,bucket_id,name,metadata,user_metadata)
select 'ab000000-0000-4000-8000-000000000001','vendor-quotes',
  '11111111-1111-4111-8111-111111111111/900000000001/' || d.id::text ||
  '/eeeeeeee-0000-4000-8000-000000000001/ffffffff-0000-4000-8000-000000000001.pdf',
  '{"mimetype":"application/pdf","size":100}'::jsonb,
  jsonb_build_object('sha256',repeat('aa',32))
from public.repair_vendor_dispatches d where d.request_id='dddddddd-0000-4000-8000-000000000001';
insert into storage.objects(id,bucket_id,name,metadata,user_metadata)
select 'ab000000-0000-4000-8000-000000000002','vendor-quotes',
  '11111111-1111-4111-8111-111111111111/900000000001/' || d.id::text ||
  '/eeeeeeee-0000-4000-8000-000000000002/ffffffff-0000-4000-8000-000000000002.pdf',
  '{"mimetype":"application/pdf","size":100}'::jsonb,
  jsonb_build_object('sha256',repeat('aa',32))
from public.repair_vendor_dispatches d where d.request_id='dddddddd-0000-4000-8000-000000000001';
insert into storage.objects(id,bucket_id,name,metadata,user_metadata)
values ('ab000000-0000-4000-8000-000000000003','vendor-quotes',
  '11111111-1111-4111-8111-111111111111/wrong-path.pdf',
  '{"mimetype":"application/pdf","size":100}'::jsonb,
  jsonb_build_object('sha256',repeat('aa',32)));

set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
set role authenticated;
select pg_temp.expect_error($q$select pg_temp.test_quote(
  'eeeeeeee-0000-4000-8000-000000000002','ffffffff-0000-4000-8000-000000000002',
  '99999999-0000-4000-8000-000000000002',repeat('bb',32))$q$,'hash_mismatch_rollback');
select pg_temp.expect_error($q$select pg_temp.test_quote(
  'eeeeeeee-0000-4000-8000-000000000003','ffffffff-0000-4000-8000-000000000003',
  '99999999-0000-4000-8000-000000000003',repeat('aa',32))$q$,'path_mismatch_rollback');
do $$ begin
 if (select count(*) from public.vendor_quote_versions where organization_id='11111111-1111-4111-8111-111111111111')<>0 then
   raise exception 'failed quote left rows'; end if;
 perform pg_temp.pass('failed_quote_no_rows');
end $$;
select pg_temp.test_quote('eeeeeeee-0000-4000-8000-000000000001',
  'ffffffff-0000-4000-8000-000000000001','99999999-0000-4000-8000-000000000001',repeat('aa',32));
select pg_temp.pass('quote_revision_one');
reset role;
do $$ begin
 if not exists (select 1 from public.vendor_quote_versions q
   join public.vendor_quote_uploads u using (organization_id,request_id)
   where q.request_id='99999999-0000-4000-8000-000000000001'
     and q.received_at=u.received_at and q.received_at<>u.issued_at) then
   raise exception 'received_at was not kept separate from upload issued_at'; end if;
 perform pg_temp.pass('received_at_distinct_from_upload_issued_at');
end $$;
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
set role authenticated;
select pg_temp.test_quote('eeeeeeee-0000-4000-8000-000000000001',
  'ffffffff-0000-4000-8000-000000000001','99999999-0000-4000-8000-000000000001',repeat('aa',32));
do $$ begin
 if (select count(*) from public.vendor_quote_versions where request_id='99999999-0000-4000-8000-000000000001')<>1 then
   raise exception 'quote idempotency'; end if;
 perform pg_temp.pass('quote_idempotency');
end $$;
select pg_temp.test_quote('eeeeeeee-0000-4000-8000-000000000002',
  'ffffffff-0000-4000-8000-000000000002','99999999-0000-4000-8000-000000000002',repeat('aa',32));
do $$ begin
 if (select count(*) from public.vendor_quote_versions where dispatch_id=(select id from public.repair_vendor_dispatches where request_id='dddddddd-0000-4000-8000-000000000001'))<>2
 or (select max(revision_no) from public.vendor_quote_versions)<>2 then raise exception 'revision numbering'; end if;
 perform pg_temp.pass('quote_revision_two');
end $$;
select public.select_repair_vendor('11111111-1111-4111-8111-111111111111',900000000001,
  'cccccccc-0000-4000-8000-000000000001','Second dispatch','dddddddd-0000-4000-8000-000000000020');
reset role;

select pg_temp.expect_state($q$insert into public.repair_vendor_dispatch_events
 (organization_id,dispatch_id,quote_version_id,event_type,actor_auth_user_id,request_id)
 select '11111111-1111-4111-8111-111111111111',d.id,
 'eeeeeeee-0000-4000-8000-000000000001','quote_received',
 '22222222-2222-4222-8222-222222222222','99999999-0000-4000-8000-000000000020'
 from public.repair_vendor_dispatches d where d.request_id='dddddddd-0000-4000-8000-000000000020'$q$,
 '23503','other_dispatch_quote_fk');
select pg_temp.expect_state($q$update public.vendor_quote_versions set vendor_quote_number='changed'
 where id='eeeeeeee-0000-4000-8000-000000000001'$q$,'P0001','quote_version_immutable');
select pg_temp.expect_state($q$delete from public.vendor_quote_versions
 where id='eeeeeeee-0000-4000-8000-000000000001'$q$,'P0001','quote_version_delete_denied');
select pg_temp.expect_state($q$update public.vendor_quote_lines set description='changed'
 where quote_version_id='eeeeeeee-0000-4000-8000-000000000001'$q$,'P0001','quote_line_immutable');
select pg_temp.expect_state($q$delete from public.vendor_quote_lines
 where quote_version_id='eeeeeeee-0000-4000-8000-000000000001'$q$,'P0001','quote_line_delete_denied');
select pg_temp.expect_state($q$update public.vendor_quote_files set original_filename='changed'
 where quote_version_id='eeeeeeee-0000-4000-8000-000000000001'$q$,'P0001','quote_file_immutable');
select pg_temp.expect_state($q$delete from public.vendor_quote_files
 where quote_version_id='eeeeeeee-0000-4000-8000-000000000001'$q$,'P0001','quote_file_delete_denied');
select pg_temp.expect_state($q$update public.repair_vendor_dispatch_events set note='changed'
 where request_id='99999999-0000-4000-8000-000000000001'$q$,'P0001','audit_append_only');

select count(*) as passed_tests from vendor_test_results;
rollback;
