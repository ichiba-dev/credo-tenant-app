-- LOCAL TEST ONLY. Run after vendor-dispatch-messaging.migration.sql.
begin;
create temporary table messaging_test_results(name text primary key);
create function pg_temp.pass(p_name text) returns void language plpgsql as $$
begin insert into messaging_test_results values(p_name); end $$;
create function pg_temp.expect_error(p_sql text,p_name text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then perform pg_temp.pass(p_name); return; end;
  raise exception 'expected error: %',p_name;
end $$;
grant all on messaging_test_results to authenticated,service_role;

do $$
begin
  if to_regclass('public.repair_vendor_dispatch_messages') is null
    or to_regprocedure('public.confirm_vendor_dispatch_manual(uuid,uuid,uuid,uuid,text,text,text)') is null then
    raise exception 'messaging objects missing';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.repair_vendor_dispatch_messages'::regclass) then
    raise exception 'messaging RLS disabled';
  end if;
  if has_table_privilege('anon','public.repair_vendor_dispatch_messages','insert')
    or has_table_privilege('authenticated','public.repair_vendor_dispatch_messages','insert')
    or has_table_privilege('authenticated','public.repair_vendor_dispatch_messages','update')
    or has_table_privilege('authenticated','public.repair_vendor_dispatch_messages','delete') then
    raise exception 'browser message write privilege';
  end if;
  if has_function_privilege('anon','public.confirm_vendor_dispatch_manual(uuid,uuid,uuid,uuid,text,text,text)','execute')
    or has_function_privilege('authenticated','public.confirm_vendor_dispatch_manual(uuid,uuid,uuid,uuid,text,text,text)','execute')
    or not has_function_privilege('service_role','public.confirm_vendor_dispatch_manual(uuid,uuid,uuid,uuid,text,text,text)','execute') then
    raise exception 'messaging RPC ACL';
  end if;
  perform pg_temp.pass('catalog_rls_acl');
end $$;

insert into public.organizations(id,is_active) values
  ('d1000000-0000-4000-8000-000000000001',true),
  ('d1000000-0000-4000-8000-000000000002',true);
insert into public.tenant_accounts(id,organization_id,is_active) values
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',true),
  ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002',true);
insert into public.repair_requests(id,organization_id,tenant_account_id) values
  (910000000001,'d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001'),
  (910000000002,'d1000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000002');
insert into public.organization_members(organization_id,auth_user_id,is_active,role) values
  ('d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',true,'admin'),
  ('d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002',true,'manager'),
  ('d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000003',true,'staff'),
  ('d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000004',true,'viewer'),
  ('d1000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000005',true,'admin');
insert into public.repair_vendors(id,organization_id,company_name,contact_name,phone,email) values
  ('d4000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','設備A','担当A','090-0000-0001','a@example.com'),
  ('d4000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','設備B','担当B','090-0000-0002','b@example.com'),
  ('d4000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000002','他社設備','担当C',null,null);

set request.jwt.claim.sub='d3000000-0000-4000-8000-000000000001';
set role authenticated;
select public.select_repair_vendor('d1000000-0000-4000-8000-000000000001',910000000001,
  'd4000000-0000-4000-8000-000000000001','admin dispatch','d5000000-0000-4000-8000-000000000001');
reset role;
set request.jwt.claim.sub='d3000000-0000-4000-8000-000000000002';
set role authenticated;
select public.select_repair_vendor('d1000000-0000-4000-8000-000000000001',910000000001,
  'd4000000-0000-4000-8000-000000000001','manager dispatch','d5000000-0000-4000-8000-000000000002');
reset role;
set request.jwt.claim.sub='d3000000-0000-4000-8000-000000000003';
set role authenticated;
select public.select_repair_vendor('d1000000-0000-4000-8000-000000000001',910000000001,
  'd4000000-0000-4000-8000-000000000002','staff dispatch','d5000000-0000-4000-8000-000000000003');
reset role;

set role service_role;
select public.confirm_vendor_dispatch_manual('d1000000-0000-4000-8000-000000000001',
  (select id from public.repair_vendor_dispatches where request_id='d5000000-0000-4000-8000-000000000001'),
  'd3000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001',
  'admin body','設備A 担当A','090-0000-0001 / a@example.com');
select pg_temp.pass('admin_candidate_to_dispatched');
select public.confirm_vendor_dispatch_manual('d1000000-0000-4000-8000-000000000001',
  (select id from public.repair_vendor_dispatches where request_id='d5000000-0000-4000-8000-000000000002'),
  'd3000000-0000-4000-8000-000000000002','d6000000-0000-4000-8000-000000000002',
  'manager body','設備A 担当A','090-0000-0001 / a@example.com');
select pg_temp.pass('manager_candidate_to_dispatched');
select public.confirm_vendor_dispatch_manual('d1000000-0000-4000-8000-000000000001',
  (select id from public.repair_vendor_dispatches where request_id='d5000000-0000-4000-8000-000000000003'),
  'd3000000-0000-4000-8000-000000000003','d6000000-0000-4000-8000-000000000003',
  'staff body','設備B 担当B','090-0000-0002 / b@example.com');
select pg_temp.pass('staff_candidate_to_dispatched');

do $$ begin
  if (select count(*) from public.repair_vendor_dispatch_messages where organization_id='d1000000-0000-4000-8000-000000000001')<>3
    or (select count(*) from public.repair_vendor_dispatch_events where organization_id='d1000000-0000-4000-8000-000000000001' and event_type='status_changed' and to_status='dispatched')<>3
    or exists (select 1 from public.repair_vendor_dispatches where organization_id='d1000000-0000-4000-8000-000000000001' and status<>'dispatched') then
    raise exception 'message/status/event atomic result mismatch';
  end if;
  perform pg_temp.pass('message_status_event_saved');
  perform pg_temp.pass('multiple_dispatches_same_repair');
  perform pg_temp.pass('multiple_vendors_same_repair');
end $$;

select public.confirm_vendor_dispatch_manual('d1000000-0000-4000-8000-000000000001',
  (select id from public.repair_vendor_dispatches where request_id='d5000000-0000-4000-8000-000000000001'),
  'd3000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001',
  'admin body','設備A 担当A','090-0000-0001 / a@example.com');
do $$ begin
  if (select count(*) from public.repair_vendor_dispatch_messages where request_id='d6000000-0000-4000-8000-000000000001')<>1
    or (select count(*) from public.repair_vendor_dispatch_events where request_id='d6000000-0000-4000-8000-000000000001')<>1 then
    raise exception 'manual retry duplicated rows';
  end if;
  perform pg_temp.pass('same_request_idempotent_after_dispatched');
end $$;
select pg_temp.expect_error($q$select public.confirm_vendor_dispatch_manual(
  'd1000000-0000-4000-8000-000000000001',
  (select id from public.repair_vendor_dispatches where request_id='d5000000-0000-4000-8000-000000000001'),
  'd3000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001',
  'changed body','設備A 担当A','090-0000-0001 / a@example.com')$q$,'same_request_changed_payload_rejected');
select pg_temp.expect_error($q$select public.confirm_vendor_dispatch_manual(
  'd1000000-0000-4000-8000-000000000001',
  (select id from public.repair_vendor_dispatches where request_id='d5000000-0000-4000-8000-000000000001'),
  'd3000000-0000-4000-8000-000000000004','d6000000-0000-4000-8000-000000000004',
  'viewer body','設備A 担当A',null)$q$,'viewer_rejected');
select pg_temp.expect_error($q$select public.confirm_vendor_dispatch_manual(
  'd1000000-0000-4000-8000-000000000002',
  (select id from public.repair_vendor_dispatches where request_id='d5000000-0000-4000-8000-000000000003'),
  'd3000000-0000-4000-8000-000000000005','d6000000-0000-4000-8000-000000000005',
  'foreign body','他社設備 担当C',null)$q$,'cross_organization_rejected');
reset role;

set role authenticated;
select pg_temp.expect_error($q$select public.confirm_vendor_dispatch_manual(
  'd1000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000007',
  'browser RPC','recipient',null)$q$,'browser_rpc_execute_rejected');
select pg_temp.expect_error($q$insert into public.repair_vendor_dispatch_messages
  (organization_id,dispatch_id,channel,message_body,recipient_label,sent_by,request_id,sent_at,delivery_status)
  select organization_id,id,'manual','browser write','recipient',assigned_by,
    'd6000000-0000-4000-8000-000000000006',clock_timestamp(),'manual_confirmed'
  from public.repair_vendor_dispatches limit 1$q$,'browser_direct_write_rejected');
reset role;

select pg_temp.expect_error($q$update public.repair_vendor_dispatch_messages set message_body='changed'
  where request_id='d6000000-0000-4000-8000-000000000001'$q$,'message_update_immutable');
select pg_temp.expect_error($q$delete from public.repair_vendor_dispatch_messages
  where request_id='d6000000-0000-4000-8000-000000000001'$q$,'message_delete_immutable');

select count(*) as passed_tests from messaging_test_results;
rollback;
