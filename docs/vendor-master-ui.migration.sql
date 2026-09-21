-- Atomic, idempotent vendor-master writes for the server-side admin UI.
-- Apply once after vendor-dispatch-phase1.migration.sql.
begin;
set local lock_timeout='10s';

do $$
declare
  v_vendor regclass:=to_regclass('public.repair_vendors');
  v_category regclass:=to_regclass('public.repair_vendor_categories');
  v_area regclass:=to_regclass('public.repair_vendor_areas');
  v_member regclass:=to_regclass('public.organization_members');
  v_guard regprocedure:=to_regprocedure('public._vendor_master_identity_guard()');
begin
  if v_vendor is null or v_category is null or v_area is null or v_member is null then
    raise exception 'Vendor Phase 1 tables are required';
  end if;
  if to_regclass('public.vendor_master_requests') is not null
    or to_regclass('public.vendor_master_requests_pkey') is not null
    or exists (select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='save_repair_vendor_master') then
    raise exception 'Vendor master UI objects already exist';
  end if;
  if (select count(*) from pg_catalog.pg_attribute a where a.attrelid=v_vendor
      and not a.attisdropped and a.attnum>0 and (
        (a.attname='organization_id' and a.atttypid='uuid'::regtype and a.attnotnull) or
        (a.attname='id' and a.atttypid='uuid'::regtype and a.attnotnull) or
        (a.attname='company_name' and a.atttypid='text'::regtype and a.attnotnull) or
        (a.attname='contact_name' and a.atttypid='text'::regtype and a.attnotnull) or
        (a.attname='phone' and a.atttypid='text'::regtype and not a.attnotnull) or
        (a.attname='email' and a.atttypid='text'::regtype and not a.attnotnull) or
        (a.attname='is_active' and a.atttypid='boolean'::regtype and a.attnotnull) or
        (a.attname='created_at' and a.atttypid='timestamptz'::regtype and a.attnotnull) or
        (a.attname='updated_at' and a.atttypid='timestamptz'::regtype and a.attnotnull)))<>9 then
    raise exception 'repair_vendors column contract mismatch';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint k where k.conrelid=v_vendor
      and k.contype='p' and k.conkey=array[(select attnum from pg_catalog.pg_attribute
        where attrelid=v_vendor and attname='id')]::smallint[])
    or not exists (select 1 from pg_catalog.pg_constraint k where k.conrelid=v_vendor
      and k.contype in ('p','u') and k.conkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=v_vendor and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=v_vendor and attname='id')]::smallint[]) then
    raise exception 'repair_vendors key contract mismatch';
  end if;
  if v_guard is null or not exists (select 1 from pg_catalog.pg_proc p
      where p.oid=v_guard and p.prorettype='trigger'::regtype)
    or not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid=v_vendor
      and t.tgname='repair_vendors_identity_guard' and not t.tgisinternal
      and t.tgenabled<>'D' and t.tgfoid=v_guard and t.tgtype=19) then
    raise exception 'repair_vendors identity guard contract mismatch';
  end if;
  if (select count(*) from pg_catalog.pg_attribute a where a.attrelid=v_category
      and not a.attisdropped and a.attnum>0 and (
        (a.attname='organization_id' and a.atttypid='uuid'::regtype and a.attnotnull) or
        (a.attname='vendor_id' and a.atttypid='uuid'::regtype and a.attnotnull) or
        (a.attname='category' and a.atttypid='text'::regtype and a.attnotnull)))<>3
    or not exists (select 1 from pg_catalog.pg_constraint k where k.conrelid=v_category
      and k.contype='p' and k.conkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=v_category and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=v_category and attname='vendor_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=v_category and attname='category')]::smallint[])
    or not exists (select 1 from pg_catalog.pg_constraint k where k.conrelid=v_category
      and k.confrelid=v_vendor and k.contype='f' and k.conkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=v_category and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=v_category and attname='vendor_id')]::smallint[]
      and k.confkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=v_vendor and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=v_vendor and attname='id')]::smallint[]) then
    raise exception 'repair_vendor_categories contract mismatch';
  end if;
  if (select count(*) from pg_catalog.pg_attribute a where a.attrelid=v_area
      and not a.attisdropped and a.attnum>0 and (
        (a.attname='organization_id' and a.atttypid='uuid'::regtype and a.attnotnull) or
        (a.attname='vendor_id' and a.atttypid='uuid'::regtype and a.attnotnull) or
        (a.attname='area_code' and a.atttypid='text'::regtype and a.attnotnull) or
        (a.attname='area_label' and a.atttypid='text'::regtype and a.attnotnull)))<>4
    or not exists (select 1 from pg_catalog.pg_constraint k where k.conrelid=v_area
      and k.contype='p' and k.conkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=v_area and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=v_area and attname='vendor_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=v_area and attname='area_code')]::smallint[])
    or not exists (select 1 from pg_catalog.pg_constraint k where k.conrelid=v_area
      and k.confrelid=v_vendor and k.contype='f' and k.conkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=v_area and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=v_area and attname='vendor_id')]::smallint[]
      and k.confkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=v_vendor and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=v_vendor and attname='id')]::smallint[]) then
    raise exception 'repair_vendor_areas contract mismatch';
  end if;
  if (select count(*) from pg_catalog.pg_attribute a where a.attrelid=v_member
      and not a.attisdropped and a.attnum>0 and (
        (a.attname='organization_id' and a.atttypid='uuid'::regtype and a.attnotnull) or
        (a.attname='auth_user_id' and a.atttypid='uuid'::regtype and a.attnotnull) or
        (a.attname='is_active' and a.atttypid='boolean'::regtype and a.attnotnull) or
        (a.attname='role' and a.atttypid='text'::regtype and a.attnotnull)))<>4
    or not exists (select 1 from pg_catalog.pg_constraint k where k.conrelid=v_member
      and k.contype in ('p','u') and k.conkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=v_member and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=v_member and attname='auth_user_id')]::smallint[]) then
    raise exception 'organization_members contract mismatch';
  end if;
end $$;

create table public.vendor_master_requests (
  organization_id uuid not null,
  request_id uuid not null,
  actor_auth_user_id uuid not null,
  vendor_id uuid not null,
  payload jsonb not null,
  completed_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,request_id),
  foreign key (organization_id,actor_auth_user_id)
    references public.organization_members(organization_id,auth_user_id),
  foreign key (organization_id,vendor_id)
    references public.repair_vendors(organization_id,id)
);
alter table public.vendor_master_requests enable row level security;
revoke all on public.vendor_master_requests from public,anon,authenticated,service_role;

create function public.save_repair_vendor_master(
  p_org uuid,p_actor uuid,p_request_id uuid,p_vendor_id uuid,
  p_expected_updated_at timestamptz,p_company_name text,p_contact_name text,
  p_phone text,p_email text,p_is_active boolean,p_categories text[],p_areas jsonb)
returns public.repair_vendors
language plpgsql security definer set search_path='' as $$
declare
  v_vendor public.repair_vendors%rowtype;
  v_request public.vendor_master_requests%rowtype;
  v_payload jsonb;
  v_area jsonb;
begin
  if p_org is null or p_actor is null or p_request_id is null or p_vendor_id is null
    or not exists (select 1 from public.organization_members
      where organization_id=p_org and auth_user_id=p_actor and is_active is true
        and role in ('admin','manager','staff')) then
    raise exception 'VENDOR_MASTER_SCOPE_DENIED';
  end if;
  if nullif(btrim(p_company_name),'') is null or length(btrim(p_company_name))>200
    or nullif(btrim(p_contact_name),'') is null or length(btrim(p_contact_name))>200
    or (p_phone is not null and (length(p_phone) not between 1 and 40 or p_phone~'[[:cntrl:]]'))
    or (p_email is not null and (length(p_email) not between 3 and 254 or p_email~'[[:cntrl:]]'))
    or p_is_active is null or p_categories is null or cardinality(p_categories)>20
    or p_areas is null or jsonb_typeof(p_areas)<>'array' or jsonb_array_length(p_areas)>30
    or exists (select 1 from unnest(p_categories) x
      where nullif(btrim(x),'') is null or length(btrim(x))>100 or x~'[[:cntrl:]]')
    or (select count(*)<>count(distinct btrim(x)) from unnest(p_categories) x)
    or exists (select 1 from jsonb_array_elements(p_areas) a
      where jsonb_typeof(a)<>'object' or nullif(btrim(a->>'area_code'),'') is null
        or length(btrim(a->>'area_code'))>40 or nullif(btrim(a->>'area_label'),'') is null
        or length(btrim(a->>'area_label'))>100
        or (a->>'area_code')~'[[:cntrl:]]' or (a->>'area_label')~'[[:cntrl:]]')
    or (select count(*)<>count(distinct btrim(a->>'area_code')) from jsonb_array_elements(p_areas) a) then
    raise exception 'VENDOR_MASTER_INPUT_INVALID';
  end if;
  v_payload:=jsonb_build_object('vendor_id',p_vendor_id,'expected_updated_at',p_expected_updated_at,
    'company_name',btrim(p_company_name),'contact_name',btrim(p_contact_name),
    'phone',p_phone,'email',p_email,'is_active',p_is_active,
    'categories',to_jsonb(p_categories),'areas',p_areas);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text||p_request_id::text,0));
  select * into v_request from public.vendor_master_requests
    where organization_id=p_org and request_id=p_request_id;
  if found then
    if v_request.actor_auth_user_id is distinct from p_actor
      or v_request.vendor_id is distinct from p_vendor_id
      or v_request.payload is distinct from v_payload then
      raise exception 'VENDOR_MASTER_REQUEST_CONFLICT';
    end if;
    select * into v_vendor from public.repair_vendors
      where organization_id=p_org and id=p_vendor_id;
    if not found then raise exception 'VENDOR_MASTER_REQUEST_CORRUPT'; end if;
    return v_vendor;
  end if;
  select * into v_vendor from public.repair_vendors
    where organization_id=p_org and id=p_vendor_id for update;
  if found then
    if p_expected_updated_at is null or v_vendor.updated_at is distinct from p_expected_updated_at then
      raise exception 'VENDOR_MASTER_CONFLICT';
    end if;
    update public.repair_vendors set company_name=btrim(p_company_name),
      contact_name=btrim(p_contact_name),phone=p_phone,email=p_email,is_active=p_is_active
      where organization_id=p_org and id=p_vendor_id returning * into v_vendor;
  else
    if p_expected_updated_at is not null then raise exception 'VENDOR_MASTER_CONFLICT'; end if;
    insert into public.repair_vendors(id,organization_id,company_name,contact_name,phone,email,is_active)
    values(p_vendor_id,p_org,btrim(p_company_name),btrim(p_contact_name),p_phone,p_email,p_is_active)
    returning * into v_vendor;
  end if;
  delete from public.repair_vendor_categories where organization_id=p_org and vendor_id=p_vendor_id;
  insert into public.repair_vendor_categories(organization_id,vendor_id,category)
    select p_org,p_vendor_id,btrim(x) from unnest(p_categories) x;
  delete from public.repair_vendor_areas where organization_id=p_org and vendor_id=p_vendor_id;
  for v_area in select value from jsonb_array_elements(p_areas) loop
    insert into public.repair_vendor_areas(organization_id,vendor_id,area_code,area_label)
    values(p_org,p_vendor_id,btrim(v_area->>'area_code'),btrim(v_area->>'area_label'));
  end loop;
  insert into public.vendor_master_requests
    (organization_id,request_id,actor_auth_user_id,vendor_id,payload)
  values(p_org,p_request_id,p_actor,p_vendor_id,v_payload);
  return v_vendor;
end $$;

revoke all on function public.save_repair_vendor_master(
  uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,text[],jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.save_repair_vendor_master(
  uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,boolean,text[],jsonb)
  to service_role;
notify pgrst,'reload schema';
commit;
