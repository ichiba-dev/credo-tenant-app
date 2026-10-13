-- Apply only after read-only preflight and isolated local tests. Never run automatically.
begin;
set local lock_timeout = '10s';

do $$ begin
  if not exists(select 1 from storage.buckets where id='vendor-quotes' and public is false and file_size_limit=15728640 and allowed_mime_types=array['application/pdf']::text[])
    or not exists(select 1 from storage.buckets where id='owner-estimates' and public is false and 'application/pdf'=any(allowed_mime_types))
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='organizations' and column_name='name')
    or to_regprocedure('public.prepare_vendor_quote_upload(uuid,bigint,uuid,uuid,uuid,timestamptz,text,bigint,bytea)') is null
    or to_regprocedure('public.record_vendor_quote_revision(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,date,text,text,jsonb,text,bigint,bytea)') is null then
    raise exception 'QUOTE_REQUEST_PREREQUISITES_REQUIRED';
  end if;
end $$;

create table public.vendor_quote_requests (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  repair_request_id bigint not null,
  vendor_dispatch_id uuid not null,
  vendor_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','submitted','revoked')),
  expires_at timestamptz not null,
  created_by_auth_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  submitted_at timestamptz,
  revoked_at timestamptz,
  quote_version_id uuid,
  notes text check (length(notes) <= 2000),
  unique(organization_id,id),
  foreign key(organization_id,repair_request_id) references public.repair_requests(organization_id,id),
  foreign key(organization_id,vendor_dispatch_id) references public.repair_vendor_dispatches(organization_id,id),
  foreign key(organization_id,vendor_id) references public.repair_vendors(organization_id,id),
  foreign key(organization_id,created_by_auth_user_id) references public.organization_members(organization_id,auth_user_id),
  foreign key(organization_id,quote_version_id) references public.vendor_quote_versions(organization_id,id),
  check (expires_at > created_at),
  check ((status='submitted' and submitted_at is not null and quote_version_id is not null) or (status<>'submitted' and submitted_at is null and quote_version_id is null)),
  check ((status='revoked') = (revoked_at is not null))
);
create unique index vendor_quote_requests_one_pending on public.vendor_quote_requests(organization_id,vendor_dispatch_id) where status='pending';
alter table public.vendor_quote_requests enable row level security;
revoke all on public.vendor_quote_requests from public,anon,authenticated,service_role;
grant select on public.vendor_quote_requests to service_role;

-- Every mutation follows dispatch -> request lock order, including issuance/revocation.
create function public.issue_vendor_quote_request(p_org uuid,p_repair bigint,p_dispatch uuid,p_actor uuid,p_id uuid,p_hash text)
returns public.vendor_quote_requests language plpgsql security definer set search_path='' as $$
declare d public.repair_vendor_dispatches%rowtype; r public.vendor_quote_requests%rowtype;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_org and auth_user_id=p_actor and is_active and role in ('admin','manager','staff'))
    or p_id is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'QUOTE_REQUEST_DENIED'; end if;
  select * into d from public.repair_vendor_dispatches where organization_id=p_org and id=p_dispatch for update;
  if not found or d.repair_request_id<>p_repair or d.status in ('candidate','cancelled')
    or not exists(select 1 from public.repair_vendors where id=d.vendor_id and organization_id=p_org and is_active)
    or not exists(select 1 from public.repair_requests where id=p_repair and organization_id=p_org) then raise exception 'QUOTE_REQUEST_DENIED'; end if;
  select * into r from public.vendor_quote_requests where id=p_id;
  if found then
    if row(r.organization_id,r.repair_request_id,r.vendor_dispatch_id,r.created_by_auth_user_id) is distinct from row(p_org,p_repair,p_dispatch,p_actor) then raise exception 'QUOTE_REQUEST_CONFLICT'; end if;
    return r; -- Lost response retries never create a second request or recover plaintext.
  end if;
  update public.vendor_quote_requests set status='revoked',revoked_at=clock_timestamp() where organization_id=p_org and vendor_dispatch_id=p_dispatch and status='pending';
  insert into public.vendor_quote_requests(id,organization_id,repair_request_id,vendor_dispatch_id,vendor_id,token_hash,expires_at,created_by_auth_user_id)
    values(p_id,p_org,p_repair,p_dispatch,d.vendor_id,p_hash,clock_timestamp()+interval '7 days',p_actor) returning * into r;
  return r;
end $$;

create function public.revoke_vendor_quote_request(p_org uuid,p_dispatch uuid,p_actor uuid,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.organization_members where organization_id=p_org and auth_user_id=p_actor and is_active and role in ('admin','manager','staff')) then raise exception 'QUOTE_REQUEST_DENIED'; end if;
  perform 1 from public.repair_vendor_dispatches where organization_id=p_org and id=p_dispatch for update;
  if not found then raise exception 'QUOTE_REQUEST_DENIED'; end if;
  update public.vendor_quote_requests set status='revoked',revoked_at=clock_timestamp() where id=p_id and organization_id=p_org and vendor_dispatch_id=p_dispatch and status='pending';
end $$;

create function public.inspect_vendor_quote_request(p_hash text,p_allow_submitted boolean default false)
returns public.vendor_quote_requests language plpgsql security definer set search_path='' as $$
declare r public.vendor_quote_requests%rowtype; d public.repair_vendor_dispatches%rowtype;
begin
  select * into r from public.vendor_quote_requests where token_hash=p_hash;
  if not found then raise exception 'QUOTE_LINK_INVALID'; end if;
  select * into d from public.repair_vendor_dispatches where id=r.vendor_dispatch_id and organization_id=r.organization_id for update;
  if not found or d.repair_request_id<>r.repair_request_id or d.vendor_id<>r.vendor_id or d.status in ('candidate','cancelled') then raise exception 'QUOTE_LINK_INVALID'; end if;
  select * into r from public.vendor_quote_requests where token_hash=p_hash for update;
  if clock_timestamp()>=r.expires_at or r.status='revoked' or (r.status='submitted' and not p_allow_submitted)
    or not exists(select 1 from public.repair_vendors where id=r.vendor_id and organization_id=r.organization_id and is_active)
    or not exists(select 1 from public.repair_requests where id=r.repair_request_id and organization_id=r.organization_id)
    or not exists(select 1 from public.organization_members where organization_id=r.organization_id and auth_user_id=r.created_by_auth_user_id and is_active and role in ('admin','manager','staff')) then raise exception 'QUOTE_LINK_INVALID'; end if;
  return r;
end $$;

create function public.prepare_requested_vendor_quote(p_hash text,p_operation uuid,p_filename text,p_size bigint,p_sha bytea)
returns public.vendor_quote_uploads language plpgsql security definer set search_path='' as $$
declare r public.vendor_quote_requests%rowtype; u public.vendor_quote_uploads%rowtype; received timestamptz;
begin
  r:=public.inspect_vendor_quote_request(p_hash,false);
  if p_filename is null or p_filename !~* '\.pdf$' then raise exception 'QUOTE_PDF_INVALID'; end if;
  select received_at into received from public.vendor_quote_uploads where organization_id=r.organization_id and request_id=p_operation;
  u:=public.prepare_vendor_quote_upload(r.organization_id,r.repair_request_id,r.vendor_dispatch_id,r.created_by_auth_user_id,p_operation,coalesce(received,clock_timestamp()),p_filename,p_size,p_sha);
  return u;
end $$;

create function public.submit_requested_vendor_quote(p_hash text,p_quote uuid,p_file uuid,p_operation uuid,p_issued timestamptz,p_received timestamptz,p_valid date,p_number text,p_lines jsonb,p_filename text,p_size bigint,p_sha bytea,p_notes text)
returns public.vendor_quote_versions language plpgsql security definer set search_path='' as $$
declare r public.vendor_quote_requests%rowtype; q public.vendor_quote_versions%rowtype;
begin
  r:=public.inspect_vendor_quote_request(p_hash,true);
  if p_notes is not null and length(p_notes)>2000 then raise exception 'QUOTE_NOTES_INVALID'; end if;
  if r.status='submitted' then
    select * into q from public.vendor_quote_versions where organization_id=r.organization_id and id=r.quote_version_id;
    if q.id is distinct from p_quote or q.request_id is distinct from p_operation or q.source_lines is distinct from p_lines
      or q.valid_until is distinct from p_valid or q.vendor_quote_number is distinct from p_number or r.notes is distinct from p_notes
      or not exists(select 1 from public.vendor_quote_files where organization_id=r.organization_id and quote_version_id=q.id and id=p_file and original_filename=p_filename and file_size=p_size and content_sha256=p_sha) then raise exception 'QUOTE_ALREADY_SUBMITTED'; end if;
    return q;
  end if;
  if p_filename is null or p_filename !~* '\.pdf$' then raise exception 'QUOTE_PDF_INVALID'; end if;
  q:=public.record_vendor_quote_revision(r.organization_id,r.vendor_dispatch_id,p_quote,p_file,p_operation,r.created_by_auth_user_id,p_issued,p_received,p_valid,p_number,'floor',p_lines,p_filename,p_size,p_sha);
  update public.vendor_quote_requests set status='submitted',submitted_at=clock_timestamp(),quote_version_id=q.id,notes=p_notes where id=r.id;
  return q;
end $$;

-- Explicit staff-approved disclosure, separate from vendor cost data. Safe retries use a unique source reference.
alter table public.owner_report_estimate_files add column source_vendor_quote_id uuid;
alter table public.owner_report_estimate_files add constraint owner_estimate_vendor_quote_fk foreign key(organization_id,source_vendor_quote_id) references public.vendor_quote_versions(organization_id,id);
create unique index owner_estimate_vendor_quote_once on public.owner_report_estimate_files(organization_id,owner_report_id,source_vendor_quote_id) where source_vendor_quote_id is not null;
create function public.publish_vendor_quote_to_owner(p_org uuid,p_repair bigint,p_report uuid,p_quote uuid,p_actor uuid,p_amount numeric,p_file uuid,p_path text,p_name text,p_size bigint,p_confirm boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing_id uuid;
begin
  if p_confirm is distinct from true or p_amount is null or p_amount<0 or p_amount<>trunc(p_amount)
    or not exists(select 1 from public.organization_members where organization_id=p_org and auth_user_id=p_actor and is_active and role in ('admin','manager','staff')) then raise exception 'OWNER_DISCLOSURE_DENIED'; end if;
  perform 1 from public.owner_reports where id=p_report and organization_id=p_org and repair_request_id=p_repair for update;
  if not found or not exists(select 1 from public.vendor_quote_versions q join public.repair_vendor_dispatches d on d.id=q.dispatch_id and d.organization_id=q.organization_id where q.id=p_quote and q.organization_id=p_org and d.repair_request_id=p_repair)
    or not exists(select 1 from public.vendor_quote_files where organization_id=p_org and quote_version_id=p_quote and original_filename=p_name and file_size=p_size)
    or p_path is distinct from p_org::text||'/'||p_repair::text||'/'||p_report::text||'/'||p_file::text||'.pdf' then raise exception 'OWNER_DISCLOSURE_DENIED'; end if;
  select id into existing_id from public.owner_report_estimate_files where organization_id=p_org and owner_report_id=p_report and source_vendor_quote_id=p_quote and deleted_at is null;
  if found then return existing_id; end if;
  if (select count(*) from public.owner_report_estimate_files where organization_id=p_org and owner_report_id=p_report and deleted_at is null)>=10
    or not exists(select 1 from storage.objects where bucket_id='owner-estimates' and name=p_path and metadata->>'mimetype'='application/pdf' and metadata->>'size'=p_size::text) then raise exception 'OWNER_DISCLOSURE_FILE_INVALID'; end if;
  insert into public.owner_report_estimate_files(id,organization_id,repair_request_id,owner_report_id,storage_path,original_filename,mime_type,file_size,sort_order,uploaded_by,source_vendor_quote_id)
    values(p_file,p_org,p_repair,p_report,p_path,p_name,'application/pdf',p_size,coalesce((select max(sort_order)+1 from public.owner_report_estimate_files where owner_report_id=p_report and organization_id=p_org),1),p_actor,p_quote);
  update public.owner_reports set estimated_amount=p_amount where id=p_report and organization_id=p_org;
  return p_file;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('issue_vendor_quote_request','revoke_vendor_quote_request','inspect_vendor_quote_request','prepare_requested_vendor_quote','submit_requested_vendor_quote','publish_vendor_quote_to_owner') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
