-- LOCAL TEST ONLY. Run after vendor-master-ui.migration.sql.
begin;
create temporary table vendor_master_test_results(label text primary key);
create function pg_temp.pass(p text) returns void language plpgsql as $$begin insert into vendor_master_test_results values(p);end$$;
create function pg_temp.expect_error(q text,p text) returns void language plpgsql as $$
begin begin execute q; exception when others then perform pg_temp.pass(p);return;end;raise exception 'Expected failure: %',p;end$$;

insert into public.organization_members(organization_id,auth_user_id,is_active,role) values
('11111111-1111-4111-8111-111111111111','77777777-0000-4000-8000-000000000001',true,'admin'),
('11111111-1111-4111-8111-111111111111','77777777-0000-4000-8000-000000000002',true,'manager'),
('11111111-1111-4111-8111-111111111111','77777777-0000-4000-8000-000000000004',true,'staff'),
('11111111-1111-4111-8111-111111111111','77777777-0000-4000-8000-000000000003',true,'viewer');

select public.save_repair_vendor_master('11111111-1111-4111-8111-111111111111',
 '77777777-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000001',
 '99999999-0000-4000-8000-000000000001',null,'甲業者','担当者','090-0000-0000','a@example.com',true,
 array['水道','設備'],
 '[{"area_code":"nishinomiya","area_label":"西宮市"},{"area_code":"amagasaki","area_label":"尼崎市"}]');
select pg_temp.pass('admin_create_multiple_categories_areas');

select public.save_repair_vendor_master('11111111-1111-4111-8111-111111111111',
 '77777777-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000001',
 '99999999-0000-4000-8000-000000000001',null,'甲業者','担当者','090-0000-0000','a@example.com',true,
 array['水道','設備'],
 '[{"area_code":"nishinomiya","area_label":"西宮市"},{"area_code":"amagasaki","area_label":"尼崎市"}]');
do $$begin
 if (select count(*) from public.repair_vendors where id='99999999-0000-4000-8000-000000000001')<>1
 or (select count(*) from public.repair_vendor_categories where vendor_id='99999999-0000-4000-8000-000000000001')<>2
 or (select count(*) from public.repair_vendor_areas where vendor_id='99999999-0000-4000-8000-000000000001')<>2 then
 raise exception 'Retry duplicated rows';end if;perform pg_temp.pass('idempotent_retry');end$$;

select public.save_repair_vendor_master('11111111-1111-4111-8111-111111111111',
 '77777777-0000-4000-8000-000000000002','88888888-0000-4000-8000-000000000002',
 '99999999-0000-4000-8000-000000000001',
 (select updated_at from public.repair_vendors where id='99999999-0000-4000-8000-000000000001'),
 '甲業者','新担当',null,null,false,array['清掃'],
 '[{"area_code":"kobe","area_label":"神戸市"}]');
do $$begin
 if (select is_active or contact_name<>'新担当' from public.repair_vendors where id='99999999-0000-4000-8000-000000000001')
 or (select count(*) from public.repair_vendor_categories where vendor_id='99999999-0000-4000-8000-000000000001')<>1
 or (select count(*) from public.repair_vendor_areas where vendor_id='99999999-0000-4000-8000-000000000001')<>1 then
 raise exception 'Edit mismatch';end if;perform pg_temp.pass('manager_edit_and_deactivate');end$$;

select public.save_repair_vendor_master('11111111-1111-4111-8111-111111111111',
 '77777777-0000-4000-8000-000000000004','88888888-0000-4000-8000-000000000005',
 '99999999-0000-4000-8000-000000000005',null,'乙業者','担当者',null,null,true,
 array['電気'],'[{"area_code":"osaka","area_label":"大阪市"}]');
select pg_temp.pass('staff_create');

select pg_temp.expect_error($q$select public.save_repair_vendor_master(
 '11111111-1111-4111-8111-111111111111','77777777-0000-4000-8000-000000000003',
 '88888888-0000-4000-8000-000000000003','99999999-0000-4000-8000-000000000003',null,
 'Viewer業者','担当',null,null,true,array[]::text[],'[]'::jsonb)$q$,'viewer_denied');
select pg_temp.expect_error($q$select public.save_repair_vendor_master(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','77777777-0000-4000-8000-000000000001',
 '88888888-0000-4000-8000-000000000004','99999999-0000-4000-8000-000000000004',null,
 '他社','担当',null,null,true,array[]::text[],'[]'::jsonb)$q$,'other_org_denied');
select pg_temp.expect_error($q$select public.save_repair_vendor_master(
 '11111111-1111-4111-8111-111111111111','77777777-0000-4000-8000-000000000001',
 '88888888-0000-4000-8000-000000000001','99999999-0000-4000-8000-000000000001',null,
 '改ざん','担当',null,null,true,array[]::text[],'[]'::jsonb)$q$,'request_payload_conflict');
do $$begin
 if has_function_privilege('anon','public.save_repair_vendor_master(uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,text[],jsonb)','execute')
 or has_function_privilege('authenticated','public.save_repair_vendor_master(uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,text[],jsonb)','execute')
 or not has_function_privilege('service_role','public.save_repair_vendor_master(uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,text[],jsonb)','execute') then
 raise exception 'RPC ACL mismatch';end if;perform pg_temp.pass('service_only_rpc');end$$;
select count(*) as passed_tests from vendor_master_test_results;
rollback;
