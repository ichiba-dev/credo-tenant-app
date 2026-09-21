-- Phase 1 vendor dispatch and cost quotes. Apply once after catalog and local tests.
-- The vendor-quotes bucket must already exist as private, PDF-only Storage.
begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regprocedure('private.has_org_role(uuid,text[])') is null then
    raise exception 'Confirm private.has_org_role(uuid,text[]) signature before migration';
  end if;
  if not exists (select 1 from storage.buckets
    where id = 'vendor-quotes' and public is false
      and allowed_mime_types = array['application/pdf']::text[]
      and file_size_limit = 15728640) then
    raise exception 'Private PDF vendor-quotes bucket is required';
  end if;
  if not exists (select 1 from pg_catalog.pg_class
    where oid='storage.objects'::regclass and relrowsecurity) then
    raise exception 'storage.objects RLS is required';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.repair_requests'::regclass and contype in ('p','u')
      and pg_get_constraintdef(oid) like '%(organization_id, id)%') then
    raise exception 'repair_requests(organization_id,id) UNIQUE required';
  end if;
  if exists (select 1 from unnest(array[
      'repair_vendors','repair_vendor_categories','repair_vendor_areas',
      'repair_vendor_dispatches','repair_vendor_dispatch_events',
      'vendor_quote_versions','vendor_quote_lines','vendor_quote_files','vendor_quote_uploads']) n
      where to_regclass('public.' || n) is not null) then
    raise exception 'Phase 1 table name already exists';
  end if;
  if to_regprocedure('public.select_repair_vendor(uuid,bigint,uuid,text,uuid)') is not null
    or to_regprocedure('public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)') is not null
    or to_regprocedure('public.prepare_vendor_quote_upload(uuid,bigint,uuid,uuid,uuid,timestamptz,text,bigint,bytea)') is not null
    or to_regprocedure('public.record_vendor_quote_revision(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,date,text,text,jsonb,text,bigint,bytea)') is not null then
    raise exception 'Phase 1 RPC name already exists';
  end if;
end $$;

create table public.repair_vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_name text not null check (length(btrim(company_name)) between 1 and 200),
  contact_name text not null check (length(btrim(contact_name)) between 1 and 200),
  phone text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,id),
  check (phone is null or length(phone) between 1 and 40),
  check (email is null or length(email) between 3 and 254)
);
create index repair_vendors_active_idx on public.repair_vendors(organization_id,is_active,company_name);

create table public.repair_vendor_categories (
  organization_id uuid not null,
  vendor_id uuid not null,
  category text not null check (length(btrim(category)) between 1 and 100),
  primary key (organization_id,vendor_id,category),
  foreign key (organization_id,vendor_id) references public.repair_vendors(organization_id,id)
);
create index repair_vendor_categories_lookup_idx on public.repair_vendor_categories(organization_id,category,vendor_id);

create table public.repair_vendor_areas (
  organization_id uuid not null,
  vendor_id uuid not null,
  area_code text not null check (length(btrim(area_code)) between 1 and 40),
  area_label text not null check (length(btrim(area_label)) between 1 and 100),
  primary key (organization_id,vendor_id,area_code),
  foreign key (organization_id,vendor_id) references public.repair_vendors(organization_id,id)
);
create index repair_vendor_areas_lookup_idx on public.repair_vendor_areas(organization_id,area_code,vendor_id);

create table public.repair_vendor_dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  repair_request_id bigint not null,
  vendor_id uuid not null,
  assigned_by uuid not null,
  request_id uuid not null,
  instructions text not null check (length(btrim(instructions)) between 1 and 5000),
  status text not null default 'candidate'
    check (status in ('candidate','dispatched','acknowledged','scheduling',
      'visit_scheduled','completed','cancelled')),
  selected_at timestamptz not null default now(),
  dispatched_at timestamptz,
  acknowledged_at timestamptz,
  cancelled_at timestamptz,
  transition_request_id uuid,
  transition_note text,
  updated_at timestamptz not null default now(),
  unique (organization_id,id),
  unique (organization_id,request_id),
  foreign key (organization_id,repair_request_id)
    references public.repair_requests(organization_id,id),
  foreign key (organization_id,vendor_id)
    references public.repair_vendors(organization_id,id),
  foreign key (organization_id,assigned_by)
    references public.organization_members(organization_id,auth_user_id),
  check (transition_note is null or length(transition_note) <= 2000)
);
create index repair_vendor_dispatches_repair_idx
  on public.repair_vendor_dispatches(organization_id,repair_request_id,selected_at desc);
create index repair_vendor_dispatches_vendor_idx
  on public.repair_vendor_dispatches(organization_id,vendor_id,status);

create table public.repair_vendor_dispatch_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dispatch_id uuid not null,
  quote_version_id uuid,
  event_type text not null check (event_type in ('selected','status_changed','quote_received')),
  from_status text,
  to_status text,
  note text,
  actor_auth_user_id uuid not null,
  request_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,request_id),
  foreign key (organization_id,dispatch_id)
    references public.repair_vendor_dispatches(organization_id,id),
  foreign key (organization_id,actor_auth_user_id)
    references public.organization_members(organization_id,auth_user_id)
);
create index repair_vendor_dispatch_events_timeline_idx
  on public.repair_vendor_dispatch_events(organization_id,dispatch_id,occurred_at,id);

-- One immutable reservation per request. Only the service role may call prepare.
create table public.vendor_quote_uploads (
  organization_id uuid not null,
  request_id uuid not null,
  repair_request_id bigint not null,
  dispatch_id uuid not null,
  actor_auth_user_id uuid not null,
  quote_id uuid not null unique,
  file_id uuid not null unique,
  original_filename text not null,
  file_size bigint not null,
  content_sha256 bytea not null,
  received_at timestamptz not null,
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  primary key (organization_id,request_id),
  unique (organization_id,quote_id,file_id),
  foreign key (organization_id,dispatch_id)
    references public.repair_vendor_dispatches(organization_id,id),
  check (expires_at = issued_at + interval '10 minutes'),
  check (file_size between 1 and 15728640),
  check (octet_length(content_sha256)=32)
);

create table public.vendor_quote_versions (
  id uuid primary key,
  organization_id uuid not null,
  dispatch_id uuid not null,
  revision_no integer not null check (revision_no > 0),
  request_id uuid not null,
  vendor_quote_number text,
  received_at timestamptz not null,
  valid_until date,
  currency_code text not null default 'JPY' check (currency_code = 'JPY'),
  tax_rounding text not null check (tax_rounding in ('floor','round','ceil')),
  source_lines jsonb not null check (jsonb_typeof(source_lines) = 'array'
    and jsonb_array_length(source_lines) between 1 and 100),
  amount_ex_tax numeric(18,0) not null check (amount_ex_tax >= 0),
  tax_amount numeric(18,0) not null check (tax_amount >= 0),
  amount_inc_tax numeric(18,0) not null,
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id,id),
  unique (organization_id,dispatch_id,id),
  unique (organization_id,dispatch_id,revision_no),
  unique (organization_id,request_id),
  foreign key (organization_id,dispatch_id)
    references public.repair_vendor_dispatches(organization_id,id),
  foreign key (organization_id,recorded_by)
    references public.organization_members(organization_id,auth_user_id),
  check (amount_inc_tax = amount_ex_tax + tax_amount),
  check (valid_until is null or valid_until >= received_at::date),
  check (vendor_quote_number is null or length(vendor_quote_number) <= 100)
);
create index vendor_quote_versions_latest_idx
  on public.vendor_quote_versions(organization_id,dispatch_id,revision_no desc);

alter table public.repair_vendor_dispatch_events
  add constraint repair_vendor_dispatch_events_quote_fk
  foreign key (organization_id,dispatch_id,quote_version_id)
  references public.vendor_quote_versions(organization_id,dispatch_id,id);

create table public.vendor_quote_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_version_id uuid not null,
  line_no integer not null check (line_no > 0),
  description text not null check (length(btrim(description)) between 1 and 1000),
  quantity numeric(18,3) not null check (quantity > 0),
  unit text not null check (length(btrim(unit)) between 1 and 30),
  unit_price_ex_tax numeric(18,4) not null check (unit_price_ex_tax >= 0),
  line_amount_ex_tax numeric(18,0) not null check (line_amount_ex_tax >= 0),
  tax_rate numeric(5,4) not null check (tax_rate >= 0 and tax_rate <= 1),
  unique (organization_id,id),
  unique (organization_id,quote_version_id,line_no),
  foreign key (organization_id,quote_version_id)
    references public.vendor_quote_versions(organization_id,id)
);
create index vendor_quote_lines_version_idx
  on public.vendor_quote_lines(organization_id,quote_version_id,line_no);

create table public.vendor_quote_files (
  id uuid primary key,
  organization_id uuid not null,
  quote_version_id uuid not null,
  bucket_id text not null default 'vendor-quotes' check (bucket_id = 'vendor-quotes'),
  storage_path text not null,
  original_filename text not null check (length(btrim(original_filename)) between 1 and 255),
  mime_type text not null check (mime_type = 'application/pdf'),
  file_size bigint not null check (file_size between 1 and 15728640),
  content_sha256 bytea not null check (octet_length(content_sha256) = 32),
  uploaded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id,id),
  unique (organization_id,quote_version_id),
  unique (bucket_id,storage_path),
  foreign key (organization_id,quote_version_id)
    references public.vendor_quote_versions(organization_id,id),
  foreign key (organization_id,uploaded_by)
    references public.organization_members(organization_id,auth_user_id),
  check (storage_path like organization_id::text || '/%')
);

-- Quote content and event history never change. A correction is another revision.
create function public._vendor_phase1_no_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'VENDOR_HISTORY_IMMUTABLE';
end $$;
create trigger vendor_quote_versions_immutable before update or delete on public.vendor_quote_versions
  for each row execute function public._vendor_phase1_no_change();
create trigger vendor_quote_lines_immutable before update or delete on public.vendor_quote_lines
  for each row execute function public._vendor_phase1_no_change();
create trigger vendor_quote_files_immutable before update or delete on public.vendor_quote_files
  for each row execute function public._vendor_phase1_no_change();
create trigger vendor_dispatch_events_immutable before update or delete on public.repair_vendor_dispatch_events
  for each row execute function public._vendor_phase1_no_change();

create function public._vendor_master_identity_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id
    or (tg_table_name = 'repair_vendors' and
      (to_jsonb(new)->>'id') is distinct from (to_jsonb(old)->>'id'))
    or (tg_table_name = 'repair_vendor_categories' and
      ((to_jsonb(new)->>'vendor_id') is distinct from (to_jsonb(old)->>'vendor_id')
        or (to_jsonb(new)->>'category') is distinct from (to_jsonb(old)->>'category')))
    or (tg_table_name = 'repair_vendor_areas' and
      ((to_jsonb(new)->>'vendor_id') is distinct from (to_jsonb(old)->>'vendor_id')
        or (to_jsonb(new)->>'area_code') is distinct from (to_jsonb(old)->>'area_code'))) then
    raise exception 'VENDOR_MASTER_IDENTITY_IMMUTABLE';
  end if;
  if tg_table_name = 'repair_vendors' then
    new.created_at := old.created_at;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end $$;
create trigger repair_vendors_identity_guard before update on public.repair_vendors
  for each row execute function public._vendor_master_identity_guard();
create trigger repair_vendor_categories_identity_guard before update on public.repair_vendor_categories
  for each row execute function public._vendor_master_identity_guard();
create trigger repair_vendor_areas_identity_guard before update on public.repair_vendor_areas
  for each row execute function public._vendor_master_identity_guard();

create function public._vendor_dispatch_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'DISPATCH_DELETE_FORBIDDEN'; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'candidate' or new.transition_request_id is not null
      or new.dispatched_at is not null then raise exception 'DISPATCH_INITIAL_STATE'; end if;
  else
    if (to_jsonb(new) - array['status','dispatched_at','acknowledged_at',
        'cancelled_at','transition_request_id','transition_note','updated_at'])
      is distinct from
      (to_jsonb(old) - array['status','dispatched_at','acknowledged_at',
        'cancelled_at','transition_request_id','transition_note','updated_at'])
      or new.status = old.status or new.transition_request_id is null
      or new.transition_request_id is not distinct from old.transition_request_id
      or not (
        (old.status = 'candidate' and new.status in ('dispatched','cancelled')) or
        (old.status = 'dispatched' and new.status in ('acknowledged','cancelled')) or
        (old.status = 'acknowledged' and new.status in ('scheduling','cancelled')) or
        (old.status = 'scheduling' and new.status in ('visit_scheduled','cancelled')) or
        (old.status = 'visit_scheduled' and new.status in ('completed','cancelled'))
      ) then raise exception 'DISPATCH_TRANSITION_DENIED'; end if;
    if new.status = 'dispatched' then new.dispatched_at := clock_timestamp(); end if;
    if new.status = 'acknowledged' then new.acknowledged_at := clock_timestamp(); end if;
    if new.status = 'cancelled' then new.cancelled_at := clock_timestamp(); end if;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end $$;
create trigger vendor_dispatch_guard before insert or update or delete on public.repair_vendor_dispatches
  for each row execute function public._vendor_dispatch_guard();

create function public._vendor_dispatch_audit() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.repair_vendor_dispatch_events
    (organization_id,dispatch_id,event_type,from_status,to_status,note,actor_auth_user_id,request_id)
  values (new.organization_id,new.id,
    case when tg_op = 'INSERT' then 'selected' else 'status_changed' end,
    case when tg_op = 'INSERT' then null else old.status end,new.status,
    new.transition_note,
    case when tg_op = 'INSERT' then new.assigned_by else auth.uid() end,
    case when tg_op = 'INSERT' then new.request_id else new.transition_request_id end);
  return null;
end $$;
create trigger vendor_dispatch_audit after insert or update of status on public.repair_vendor_dispatches
  for each row execute function public._vendor_dispatch_audit();

-- Explicit grants: staff can read by RLS; all writes use authenticated RPCs.
alter table public.repair_vendors enable row level security;
alter table public.repair_vendor_categories enable row level security;
alter table public.repair_vendor_areas enable row level security;
alter table public.repair_vendor_dispatches enable row level security;
alter table public.repair_vendor_dispatch_events enable row level security;
alter table public.vendor_quote_versions enable row level security;
alter table public.vendor_quote_uploads enable row level security;
alter table public.vendor_quote_lines enable row level security;
alter table public.vendor_quote_files enable row level security;
revoke all on public.repair_vendors,public.repair_vendor_categories,public.repair_vendor_areas,
  public.repair_vendor_dispatches,public.repair_vendor_dispatch_events,
  public.vendor_quote_versions,public.vendor_quote_lines,public.vendor_quote_files
  from public,anon,authenticated,service_role;
grant select on public.repair_vendors,public.repair_vendor_categories,public.repair_vendor_areas,
  public.repair_vendor_dispatches,public.repair_vendor_dispatch_events,
  public.vendor_quote_versions,public.vendor_quote_lines,public.vendor_quote_files
  to authenticated,service_role;
revoke all on public.vendor_quote_uploads from public,anon,authenticated,service_role;

do $$
declare r text;
begin
  foreach r in array array['repair_vendors','repair_vendor_categories','repair_vendor_areas',
    'repair_vendor_dispatches','repair_vendor_dispatch_events','vendor_quote_versions',
    'vendor_quote_lines','vendor_quote_files'] loop
    execute format('create policy %I on public.%I for select to authenticated using
      (private.has_org_role(organization_id, array[''admin'',''manager'',''staff'',''viewer'']::text[]))',
      r || '_staff_read',r);
  end loop;
end $$;

-- RPCs below require auth.uid() and an active write-capable membership.
create function public._vendor_phase1_assert_writer(p_org uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not private.has_org_role(p_org,array['admin','manager','staff']::text[])
    or not exists (select 1 from public.organization_members
      where organization_id=p_org and auth_user_id=v_user and is_active is true
        and role in ('admin','manager','staff')) then
    raise exception 'VENDOR_SCOPE_DENIED';
  end if;
  return v_user;
end $$;

create function public.select_repair_vendor(
  p_org uuid,p_repair bigint,p_vendor uuid,p_instructions text,p_request_id uuid)
returns public.repair_vendor_dispatches
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_row public.repair_vendor_dispatches%rowtype;
begin
  v_actor := public._vendor_phase1_assert_writer(p_org);
  if p_request_id is null or nullif(btrim(p_instructions),'') is null
    or not exists (select 1 from public.repair_requests
      where organization_id=p_org and id=p_repair)
    or not exists (select 1 from public.repair_vendors
      where organization_id=p_org and id=p_vendor and is_active) then
    raise exception 'VENDOR_SELECTION_INVALID';
  end if;
  insert into public.repair_vendor_dispatches
    (organization_id,repair_request_id,vendor_id,assigned_by,request_id,instructions)
  values (p_org,p_repair,p_vendor,v_actor,p_request_id,p_instructions)
  on conflict (organization_id,request_id) do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.repair_vendor_dispatches
      where organization_id=p_org and request_id=p_request_id;
    if v_row.repair_request_id is distinct from p_repair
      or v_row.vendor_id is distinct from p_vendor
      or v_row.assigned_by is distinct from v_actor
      or v_row.instructions is distinct from p_instructions then
      raise exception 'VENDOR_REQUEST_CONFLICT';
    end if;
  end if;
  return v_row;
end $$;

create function public.transition_repair_vendor_dispatch(
  p_org uuid,p_dispatch uuid,p_status text,p_request_id uuid,p_note text default null)
returns public.repair_vendor_dispatches
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_row public.repair_vendor_dispatches%rowtype;
begin
  v_actor := public._vendor_phase1_assert_writer(p_org);
  if p_request_id is null or p_status not in ('dispatched','acknowledged','scheduling',
      'visit_scheduled','completed','cancelled') then raise exception 'DISPATCH_INPUT_INVALID'; end if;
  select * into v_row from public.repair_vendor_dispatches
    where organization_id=p_org and id=p_dispatch for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if exists (select 1 from public.repair_vendor_dispatch_events
    where organization_id=p_org and request_id=p_request_id
      and dispatch_id=p_dispatch and event_type='status_changed'
      and to_status=p_status and note is not distinct from p_note
      and actor_auth_user_id=v_actor) then return v_row; end if;
  update public.repair_vendor_dispatches set status=p_status,
    transition_request_id=p_request_id,transition_note=p_note
    where organization_id=p_org and id=p_dispatch returning * into v_row;
  return v_row;
end $$;

create function public.prepare_vendor_quote_upload(
  p_org uuid,p_repair bigint,p_dispatch uuid,p_actor uuid,p_request_id uuid,
  p_received_at timestamptz,p_filename text,p_file_size bigint,p_content_sha256 bytea)
returns public.vendor_quote_uploads
language plpgsql security definer set search_path = '' as $$
declare v_row public.vendor_quote_uploads%rowtype; v_now timestamptz;
begin
  if p_request_id is null or p_actor is null or p_received_at is null or p_filename is null
    or length(p_filename) not between 1 and 255 or p_filename ~ '[[:cntrl:]]'
    or p_file_size not between 1 and 15728640
    or octet_length(p_content_sha256) <> 32
    or not exists (select 1 from public.organization_members
      where organization_id=p_org and auth_user_id=p_actor and is_active
        and role in ('admin','manager','staff'))
    or not exists (select 1 from public.repair_vendor_dispatches
      where organization_id=p_org and repair_request_id=p_repair and id=p_dispatch
        and status not in ('candidate','cancelled')) then
    raise exception 'VENDOR_UPLOAD_INPUT_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text||p_request_id::text,0));
  select * into v_row from public.vendor_quote_uploads
    where organization_id=p_org and request_id=p_request_id;
  if found then
    if row(v_row.repair_request_id,v_row.dispatch_id,v_row.actor_auth_user_id,
      v_row.received_at,v_row.original_filename,v_row.file_size,v_row.content_sha256)
      is distinct from row(p_repair,p_dispatch,p_actor,p_received_at,p_filename,p_file_size,p_content_sha256) then
      raise exception 'VENDOR_UPLOAD_REQUEST_CONFLICT';
    end if;
  else
    v_now := clock_timestamp();
    insert into public.vendor_quote_uploads(organization_id,request_id,repair_request_id,
      dispatch_id,actor_auth_user_id,quote_id,file_id,original_filename,file_size,
      content_sha256,received_at,issued_at,expires_at)
    values(p_org,p_request_id,p_repair,p_dispatch,p_actor,gen_random_uuid(),gen_random_uuid(),
      p_filename,p_file_size,p_content_sha256,p_received_at,v_now,v_now+interval '10 minutes')
    returning * into v_row;
  end if;
  return v_row;
end $$;

-- Upload and verify the PDF through the server first. The RPC atomically records
-- one immutable revision, its lines, its file reference, and an audit event.
create function public.record_vendor_quote_revision(
  p_org uuid,p_dispatch uuid,p_quote_id uuid,p_file_id uuid,p_request_id uuid,p_actor uuid,
  p_upload_issued_at timestamptz,p_received_at timestamptz,
  p_valid_until date,p_vendor_quote_number text,
  p_tax_rounding text,p_lines jsonb,p_original_filename text,
  p_file_size bigint,p_content_sha256 bytea)
returns public.vendor_quote_versions
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_dispatch public.repair_vendor_dispatches%rowtype;
  v_quote public.vendor_quote_versions%rowtype; v_file public.vendor_quote_files%rowtype;
  v_upload public.vendor_quote_uploads%rowtype;
  v_path text; v_line jsonb; v_i integer; v_subtotal numeric(18,0);
  v_tax numeric(18,0);
begin
  v_actor := p_actor;
  if not exists (select 1 from public.organization_members
    where organization_id=p_org and auth_user_id=p_actor and is_active
      and role in ('admin','manager','staff')) then
    raise exception 'VENDOR_SCOPE_DENIED';
  end if;
  if p_quote_id is null or p_file_id is null or p_request_id is null
    or p_upload_issued_at is null or p_received_at is null
    or p_tax_rounding not in ('floor','round','ceil')
    or p_lines is null or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 1 and 100
    or p_file_size not between 1 and 15728640
    or octet_length(p_content_sha256) <> 32
    or nullif(btrim(p_original_filename),'') is null then
    raise exception 'VENDOR_QUOTE_INPUT_INVALID';
  end if;
  select * into v_upload from public.vendor_quote_uploads
    where organization_id=p_org and request_id=p_request_id for update;
  if not found or clock_timestamp() >= v_upload.expires_at
    or v_upload.actor_auth_user_id is distinct from p_actor
    or v_upload.dispatch_id is distinct from p_dispatch
    or v_upload.quote_id is distinct from p_quote_id
    or v_upload.file_id is distinct from p_file_id
    or v_upload.issued_at is distinct from p_upload_issued_at
    or v_upload.received_at is distinct from p_received_at
    or v_upload.original_filename is distinct from p_original_filename
    or v_upload.file_size is distinct from p_file_size
    or v_upload.content_sha256 is distinct from p_content_sha256 then
    raise exception 'VENDOR_UPLOAD_EXPIRED_OR_MISMATCH';
  end if;
  select * into v_dispatch from public.repair_vendor_dispatches
    where organization_id=p_org and id=p_dispatch for update;
  if not found or v_dispatch.status in ('candidate','cancelled') then
    raise exception 'VENDOR_QUOTE_DISPATCH_INVALID';
  end if;
  v_path := p_org::text || '/' || v_dispatch.repair_request_id::text || '/' ||
    p_dispatch::text || '/' || p_quote_id::text || '/' || p_file_id::text || '.pdf';
  select * into v_quote from public.vendor_quote_versions
    where organization_id=p_org and request_id=p_request_id;
  if found then
    select * into v_file from public.vendor_quote_files
      where organization_id=p_org and quote_version_id=v_quote.id;
    if v_quote.id is distinct from p_quote_id or v_quote.dispatch_id is distinct from p_dispatch
      or v_quote.recorded_by is distinct from v_actor
      or v_quote.received_at is distinct from p_received_at
      or v_quote.valid_until is distinct from p_valid_until
      or v_quote.vendor_quote_number is distinct from p_vendor_quote_number
      or v_quote.tax_rounding is distinct from p_tax_rounding
      or v_quote.source_lines is distinct from p_lines
      or v_file.id is distinct from p_file_id
      or v_file.original_filename is distinct from p_original_filename
      or v_file.file_size is distinct from p_file_size
      or v_file.content_sha256 is distinct from p_content_sha256 then
      raise exception 'VENDOR_QUOTE_REQUEST_CONFLICT';
    end if;
    return v_quote;
  end if;
  if not exists (select 1 from storage.objects
    where bucket_id='vendor-quotes' and name=v_path
      and coalesce(is_delete_marker,false) is false and archived_at is null
      and metadata->>'mimetype' = 'application/pdf'
      and metadata->>'size' = p_file_size::text
      and user_metadata->>'sha256' = encode(p_content_sha256,'hex')) then
    raise exception 'VENDOR_QUOTE_PDF_MISSING_OR_MISMATCH';
  end if;
  v_subtotal := 0;
  for v_i in 0..jsonb_array_length(p_lines)-1 loop
    v_line := p_lines->v_i;
    if jsonb_typeof(v_line) <> 'object'
      or nullif(btrim(v_line->>'description'),'') is null
      or nullif(btrim(v_line->>'unit'),'') is null
      or (v_line->>'quantity')::numeric <= 0
      or (v_line->>'unit_price_ex_tax')::numeric < 0
      or (v_line->>'tax_rate')::numeric not in (0,0.08,0.1)
      or (v_line->>'line_amount_ex_tax')::numeric < 0
      or (v_line->>'line_amount_ex_tax')::numeric <>
        round((v_line->>'quantity')::numeric * (v_line->>'unit_price_ex_tax')::numeric,0) then
      raise exception 'VENDOR_QUOTE_LINE_INVALID';
    end if;
    v_subtotal := v_subtotal + (v_line->>'line_amount_ex_tax')::numeric;
  end loop;
  select coalesce(sum(case p_tax_rounding
    when 'floor' then floor(t.subtotal*t.tax_rate)
    when 'ceil' then ceil(t.subtotal*t.tax_rate)
    else round(t.subtotal*t.tax_rate,0) end),0)
    into v_tax from (
      select (x->>'tax_rate')::numeric tax_rate,
        sum((x->>'line_amount_ex_tax')::numeric) subtotal
      from jsonb_array_elements(p_lines) x group by 1) t;
  insert into public.vendor_quote_versions
    (id,organization_id,dispatch_id,revision_no,request_id,vendor_quote_number,
     received_at,valid_until,tax_rounding,source_lines,amount_ex_tax,tax_amount,
     amount_inc_tax,recorded_by)
  values (p_quote_id,p_org,p_dispatch,
    (select coalesce(max(revision_no),0)+1 from public.vendor_quote_versions
      where organization_id=p_org and dispatch_id=p_dispatch),
    p_request_id,p_vendor_quote_number,p_received_at,p_valid_until,p_tax_rounding,
    p_lines,v_subtotal,v_tax,v_subtotal+v_tax,v_actor)
  returning * into v_quote;
  for v_i in 0..jsonb_array_length(p_lines)-1 loop
    v_line := p_lines->v_i;
    insert into public.vendor_quote_lines
      (organization_id,quote_version_id,line_no,description,quantity,unit,
       unit_price_ex_tax,line_amount_ex_tax,tax_rate)
    values (p_org,p_quote_id,v_i+1,v_line->>'description',
      (v_line->>'quantity')::numeric,v_line->>'unit',
      (v_line->>'unit_price_ex_tax')::numeric,
      (v_line->>'line_amount_ex_tax')::numeric,(v_line->>'tax_rate')::numeric);
  end loop;
  insert into public.vendor_quote_files
    (id,organization_id,quote_version_id,storage_path,original_filename,
     mime_type,file_size,content_sha256,uploaded_by)
  values (p_file_id,p_org,p_quote_id,v_path,p_original_filename,
    'application/pdf',p_file_size,p_content_sha256,v_actor);
  insert into public.repair_vendor_dispatch_events
    (organization_id,dispatch_id,quote_version_id,event_type,actor_auth_user_id,request_id)
  values (p_org,p_dispatch,p_quote_id,'quote_received',v_actor,p_request_id);
  return v_quote;
end $$;

-- Master editing uses a server-side staff-authenticated client. RLS is defense
-- in depth; only these master tables receive authenticated DML grants.
grant insert,update on public.repair_vendors,public.repair_vendor_categories,
  public.repair_vendor_areas to authenticated;
do $$
declare r text;
begin
  foreach r in array array['repair_vendors','repair_vendor_categories','repair_vendor_areas'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check
      (private.has_org_role(organization_id,array[''admin'',''manager'',''staff'']::text[]))',
      r || '_staff_insert',r);
    execute format('create policy %I on public.%I for update to authenticated using
      (private.has_org_role(organization_id,array[''admin'',''manager'',''staff'']::text[]))
      with check (private.has_org_role(organization_id,array[''admin'',''manager'',''staff'']::text[]))',
      r || '_staff_update',r);
  end loop;
end $$;

revoke all on function public._vendor_phase1_no_change(),
  public._vendor_master_identity_guard(),public._vendor_dispatch_guard(),public._vendor_dispatch_audit(),
  public._vendor_phase1_assert_writer(uuid) from public,anon,authenticated,service_role;
revoke all on function public.select_repair_vendor(uuid,bigint,uuid,text,uuid),
  public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text),
  public.prepare_vendor_quote_upload(uuid,bigint,uuid,uuid,uuid,timestamptz,text,bigint,bytea),
  public.record_vendor_quote_revision(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,date,text,text,jsonb,text,bigint,bytea)
  from public,anon,authenticated,service_role;
grant execute on function public.select_repair_vendor(uuid,bigint,uuid,text,uuid),
  public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)
  to authenticated;
grant execute on function
  public.prepare_vendor_quote_upload(uuid,bigint,uuid,uuid,uuid,timestamptz,text,bigint,bytea),
  public.record_vendor_quote_revision(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,date,text,text,jsonb,text,bigint,bytea)
  to service_role;
-- Restrictive policies intersect any existing broad browser policies.
create policy vendor_quotes_no_browser_insert on storage.objects as restrictive
  for insert to anon,authenticated with check (bucket_id <> 'vendor-quotes');
create policy vendor_quotes_no_browser_update on storage.objects as restrictive
  for update to anon,authenticated using (bucket_id <> 'vendor-quotes')
  with check (bucket_id <> 'vendor-quotes');
create policy vendor_quotes_no_browser_delete on storage.objects as restrictive
  for delete to anon,authenticated using (bucket_id <> 'vendor-quotes');
notify pgrst, 'reload schema';
commit;
