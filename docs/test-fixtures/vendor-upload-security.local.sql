-- LOCAL ONLY. Run after vendor-dispatch-phase1.migration.sql against local Supabase.
begin;
set local lock_timeout = '10s';
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare
  v_org uuid := '11111111-1111-4111-8111-111111111111';
  v_actor uuid := '22222222-2222-4222-8222-222222222222';
  v_vendor uuid := gen_random_uuid();
  v_dispatch uuid := gen_random_uuid();
  v_req uuid := gen_random_uuid();
  v_first public.vendor_quote_uploads%rowtype;
  v_retry public.vendor_quote_uploads%rowtype;
  v_hash bytea := decode(repeat('aa',32),'hex');
  v_past timestamptz := clock_timestamp() - interval '11 minutes';
  v_received timestamptz := clock_timestamp() - interval '1 day';
begin
  if has_function_privilege('authenticated',
      'public.record_vendor_quote_revision(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,date,text,text,jsonb,text,bigint,bytea)', 'execute')
    or has_function_privilege('authenticated',
      'public.prepare_vendor_quote_upload(uuid,bigint,uuid,uuid,uuid,timestamptz,text,bigint,bytea)', 'execute')
    or not has_function_privilege('service_role',
      'public.record_vendor_quote_revision(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,date,text,text,jsonb,text,bigint,bytea)', 'execute') then
    raise exception 'quote RPC ACL incorrect';
  end if;
  if (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
      and policyname like 'vendor_quotes_no_browser_%' and permissive='RESTRICTIVE') <> 3 then
    raise exception 'browser write restriction missing';
  end if;
  insert into public.repair_vendors(id,organization_id,company_name,contact_name)
    values(v_vendor,v_org,'Test vendor','Test contact');
  insert into public.repair_vendor_dispatches(id,organization_id,repair_request_id,
    vendor_id,assigned_by,request_id,instructions)
    values(v_dispatch,v_org,900000000001,v_vendor,v_actor,gen_random_uuid(),'Test');
  update public.repair_vendor_dispatches set status='dispatched',
    transition_request_id=gen_random_uuid() where id=v_dispatch;
  select * into v_first from public.prepare_vendor_quote_upload(v_org,900000000001,
    v_dispatch,v_actor,v_req,v_received,'quote.pdf',100,v_hash);
  select * into v_retry from public.prepare_vendor_quote_upload(v_org,900000000001,
    v_dispatch,v_actor,v_req,v_received,'quote.pdf',100,v_hash);
  if v_first.quote_id <> v_retry.quote_id or v_first.file_id <> v_retry.file_id
    or v_first.expires_at <> v_retry.expires_at then
    raise exception 'prepare not idempotent';
  end if;
  begin
    perform public.prepare_vendor_quote_upload(v_org,900000000001,
      v_dispatch,v_actor,v_req,v_received,'changed.pdf',100,v_hash);
    raise exception 'changed request accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm = 'changed request accepted' then raise; end if;
  end;
  update public.vendor_quote_uploads set issued_at=v_past,
    expires_at=v_past+interval '10 minutes'
    where organization_id=v_org and request_id=v_req;
  begin
    perform public.record_vendor_quote_revision(v_org,v_dispatch,v_first.quote_id,
      v_first.file_id,v_req,v_actor,v_first.issued_at,v_received,null,null,'floor',
      '[{"description":"Repair","quantity":1,"unit":"job","unit_price_ex_tax":100,"line_amount_ex_tax":100,"tax_rate":0.1}]'::jsonb,
      'quote.pdf',100,v_hash);
    raise exception 'expired finalize accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm = 'expired finalize accepted' then raise; end if;
  end;
  raise notice 'PASS vendor upload ACL, browser policies, idempotency, conflict, expiry';
end $$;
set local role authenticated;
do $$
begin
  begin
    insert into storage.objects(id,bucket_id,name,metadata)
    values(gen_random_uuid(),'vendor-quotes','browser-direct-test.pdf',
      '{"mimetype":"application/pdf","size":5}'::jsonb);
    raise exception 'authenticated direct insert accepted';
  exception when others then
    if sqlerrm = 'authenticated direct insert accepted' then raise; end if;
    raise notice 'PASS authenticated direct Storage insert denied';
  end;
end $$;
rollback;
