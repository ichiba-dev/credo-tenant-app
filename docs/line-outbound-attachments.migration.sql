-- Outbound LINE attachments. Manual application only; not executed by Codex.
-- Apply once, as the Supabase migration owner. Existing text RPCs are untouched.
-- Parent indexes checked against user-supplied production catalog results.
-- Image source: <=10MiB; re-encode/resize to <=10,000,000 bytes, never truncate.
-- Fixed image payload URLs: generate with 27h TTL; first claim requires >=26h.
-- Do not regenerate ciphertext/URLs/recipient/retry key on an operation retry.
begin;
set local lock_timeout = '10s';

-- Inspect actual catalog at application time. Column order/INCLUDE columns do
-- not cause duplicate UNIQUE indexes. Partial/expression/deferrable indexes
-- cannot back these FKs. The existing tenant UNIQUE is required, never created.
do $$
declare r record; cols smallint[]; found_index boolean;
begin
  for r in select * from (values
    ('tenant_accounts', array['organization_id','id'], null::text),
    ('repair_requests', array['organization_id','tenant_account_id','id'], 'outbound_repair_org_tenant_id_uq'),
    ('tenant_line_accounts', array['organization_id','tenant_account_id','id'], 'outbound_line_org_tenant_id_uq')
  ) as targets(tbl, names, new_name) loop
    select array_agg(a.attnum order by a.attnum) into cols
    from pg_catalog.pg_attribute a
    where a.attrelid = pg_catalog.to_regclass('public.' || r.tbl)
      and a.attname = any(r.names) and not a.attisdropped;
    if coalesce(cardinality(cols),0) <> cardinality(r.names) then
      raise exception 'OUTBOUND_PARENT_SCHEMA_MISMATCH';
    end if;
    select exists(select 1 from pg_catalog.pg_index i
      where i.indrelid = pg_catalog.to_regclass('public.' || r.tbl)
        and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
        and i.indpred is null and i.indexprs is null
        and i.indnkeyatts = cardinality(cols)
        and (select array_agg(k.attnum order by k.attnum)
             from unnest(i.indkey) with ordinality as k(attnum,n)
             where k.n <= i.indnkeyatts) = cols) into found_index;
    if not found_index then
      if r.new_name is null then raise exception 'OUTBOUND_EXISTING_TENANT_UNIQUE_REQUIRED'; end if;
      execute format('create unique index %I on public.%I (organization_id,tenant_account_id,id)', r.new_name,r.tbl);
    end if;
  end loop;
end $$;

create table public.staff_line_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  repair_request_id bigint not null,
  tenant_account_id uuid not null,
  staff_auth_user_id uuid not null,
  request_id uuid not null,
  tenant_line_account_id uuid not null,
  recipient_line_user_id text not null check (length(recipient_line_user_id) > 0),
  media_type text not null check (media_type in ('image', 'pdf')),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  mime_type text not null,
  source_file_size bigint not null,
  source_sha256 bytea not null check (octet_length(source_sha256) = 32),
  staging_path text not null unique,
  storage_path text unique,
  file_size bigint,
  content_sha256 bytea,
  preview_storage_path text unique,
  preview_file_size bigint,
  preview_sha256 bytea,
  upload_state text not null default 'uploading'
    check (upload_state in ('uploading', 'ready', 'rejected', 'abandoned')),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (organization_id, staff_auth_user_id, request_id),
  unique (organization_id, tenant_account_id, id),
  foreign key (organization_id, tenant_account_id)
    references public.tenant_accounts(organization_id, id),
  foreign key (organization_id, tenant_account_id, repair_request_id)
    references public.repair_requests(organization_id, tenant_account_id, id),
  foreign key (organization_id, tenant_account_id, tenant_line_account_id)
    references public.tenant_line_accounts(organization_id, tenant_account_id, id),
  foreign key (organization_id, staff_auth_user_id)
    references public.organization_members(organization_id, auth_user_id),
  check ((media_type = 'image' and mime_type in ('image/jpeg', 'image/png')
          and source_file_size between 1 and 10485760)
      or (media_type = 'pdf' and mime_type = 'application/pdf'
          and source_file_size between 1 and 15728640)),
  check (staging_path = organization_id::text || '/line-outbound-staging/' ||
    repair_request_id::text || '/' || id::text ||
    case mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.pdf' end),
  check (storage_path is null or storage_path = organization_id::text || '/line-outbound/' ||
    repair_request_id::text || '/' || id::text ||
    case mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.pdf' end),
  check (preview_storage_path is null or preview_storage_path = organization_id::text ||
    '/line-outbound/' || repair_request_id::text || '/' || id::text || '.preview.jpg'),
  check (file_size is null or file_size between 1 and
    case media_type when 'image' then 10000000 else 15728640 end),
  check (content_sha256 is null or octet_length(content_sha256) = 32),
  check (preview_file_size is null or preview_file_size between 1 and 1000000),
  check (preview_sha256 is null or octet_length(preview_sha256)=32),
  check (media_type <> 'pdf' or (preview_storage_path is null and preview_file_size is null and preview_sha256 is null)),
  check (upload_state <> 'ready' or
    (storage_path is not null and file_size is not null and content_sha256 is not null
      and finalized_at is not null and (media_type = 'pdf' or
        (preview_storage_path is not null and preview_file_size is not null and preview_sha256 is not null))))
);
create index staff_line_attachments_conversation_idx
  on public.staff_line_attachments(organization_id, repair_request_id, finalized_at, id)
  where upload_state = 'ready';

create table public.staff_line_attachment_pushes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tenant_account_id uuid not null,
  attachment_id uuid not null unique,
  tenant_line_account_id uuid not null,
  recipient_line_user_id text not null check (length(recipient_line_user_id) > 0),
  retry_key uuid not null unique default gen_random_uuid(),
  -- AES-GCM envelope containing exact UTF-8 JSON payload, nonce and tag.
  -- Encryption key is server-only, outside DB; include scope as AAD.
  payload_ciphertext bytea not null,
  payload_key_version integer not null check (payload_key_version > 0),
  payload_sha256 bytea not null check (octet_length(payload_sha256) = 32),
  payload_expires_at timestamptz not null,
  pdf_token_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'unknown', 'accepted', 'failed', 'expired')),
  first_attempt_at timestamptz,
  retry_deadline timestamptz,
  accepted_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, tenant_account_id, attachment_id)
    references public.staff_line_attachments(organization_id, tenant_account_id, id),
  foreign key (organization_id, tenant_account_id, tenant_line_account_id)
    references public.tenant_line_accounts(organization_id, tenant_account_id, id),
  check (payload_expires_at > created_at),
  check ((first_attempt_at is null) = (retry_deadline is null)),
  check (retry_deadline is null or
    (retry_deadline > first_attempt_at and retry_deadline <= first_attempt_at + interval '24 hours' - interval '1 minute'
      and retry_deadline <= payload_expires_at - interval '2 hours')),
  check (status <> 'sending' or
    (lease_id is not null and lease_until is not null and first_attempt_at is not null)),
  check (status <> 'accepted' or accepted_at is not null)
);

create table public.staff_line_attachment_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tenant_account_id uuid not null,
  attachment_id uuid not null,
  issue_request_id uuid not null,
  issued_by uuid not null,
  unique (organization_id, issued_by, issue_request_id),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, tenant_account_id, attachment_id)
    references public.staff_line_attachments(organization_id, tenant_account_id, id),
  check (expires_at > created_at)
);

alter table public.staff_line_attachment_pushes add constraint outbound_pdf_token_fk
  foreign key (pdf_token_id) references public.staff_line_attachment_tokens(id);
create unique index outbound_one_active_pdf_token
  on public.staff_line_attachment_tokens(attachment_id) where revoked_at is null;
create index outbound_token_scope_idx
  on public.staff_line_attachment_tokens(organization_id, attachment_id, created_at);
create index outbound_push_status_idx
  on public.staff_line_attachment_pushes(organization_id, status, lease_until);

alter table public.staff_line_attachments enable row level security;
alter table public.staff_line_attachment_pushes enable row level security;
alter table public.staff_line_attachment_tokens enable row level security;
revoke all on public.staff_line_attachments, public.staff_line_attachment_pushes,
  public.staff_line_attachment_tokens from public, anon, authenticated, service_role;
grant select on public.staff_line_attachments, public.staff_line_attachment_pushes,
  public.staff_line_attachment_tokens to service_role;

-- Trusted backend supplies staff ID only after auth.getUser(). Service role is
-- not an end-user identity. Never expose these RPCs through an unverified proxy.
create function public._outbound_assert_scope(
  p_org uuid, p_repair bigint, p_staff uuid,
  p_tenant uuid default null, p_link uuid default null, p_recipient text default null
) returns table(tenant_id uuid, link_id uuid, recipient text)
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_links uuid[]; v_link public.tenant_line_accounts%rowtype;
begin
  perform 1 from public.organizations where id=p_org and is_active is true for share;
  if not found then raise exception 'OUTBOUND_SCOPE_DENIED'; end if;
  perform 1 from public.organization_members where organization_id=p_org
    and auth_user_id=p_staff and is_active is true and role in ('admin','manager','staff') for share;
  if not found then raise exception 'OUTBOUND_SCOPE_DENIED'; end if;
  select tenant_account_id into v_tenant from public.repair_requests
    where id=p_repair and organization_id=p_org for share;
  if not found or v_tenant is null or (p_tenant is not null and v_tenant<>p_tenant) then
    raise exception 'OUTBOUND_SCOPE_DENIED';
  end if;
  perform 1 from public.tenant_accounts where id=v_tenant and organization_id=p_org and is_active is true for share;
  if not found then raise exception 'OUTBOUND_SCOPE_DENIED'; end if;
  select array_agg(l.id) into v_links from public.tenant_line_accounts l
    where l.organization_id=p_org and l.tenant_account_id=v_tenant
      and l.is_active is true and l.unlinked_at is null;
  if coalesce(cardinality(v_links),0)<>1 then raise exception 'OUTBOUND_SCOPE_DENIED'; end if;
  select * into v_link from public.tenant_line_accounts where id=v_links[1]
    and organization_id=p_org and tenant_account_id=v_tenant and is_active is true and unlinked_at is null for share;
  if not found or nullif(btrim(v_link.line_user_id),'') is null
    or (p_link is not null and v_link.id<>p_link)
    or (p_recipient is not null and v_link.line_user_id<>p_recipient) then
    raise exception 'OUTBOUND_SCOPE_DENIED';
  end if;
  return query select v_tenant,v_link.id,v_link.line_user_id;
end $$;

create function public.reserve_staff_line_attachment(
  p_organization_id uuid, p_repair_request_id bigint, p_staff_auth_user_id uuid,
  p_request_id uuid, p_media_type text, p_original_filename text,
  p_mime_type text, p_source_file_size bigint, p_source_sha256 bytea
) returns public.staff_line_attachments
language plpgsql security definer set search_path = '' as $$
declare a public.staff_line_attachments%rowtype; s record; v_id uuid; v_ext text;
begin
  if p_request_id is null or p_organization_id is null or p_staff_auth_user_id is null
    or p_repair_request_id is null or p_repair_request_id<=0
    or p_media_type is null or p_mime_type is null or p_source_file_size is null
    or p_source_sha256 is null or octet_length(p_source_sha256)<>32
    or p_original_filename is null or char_length(p_original_filename) not between 1 and 255
    or p_original_filename ~ '[[:cntrl:]/\\]' or p_original_filename in ('.','..')
    or not ((p_media_type='image' and p_mime_type in ('image/jpeg','image/png') and p_source_file_size between 1 and 10485760)
      or (p_media_type='pdf' and p_mime_type='application/pdf' and p_source_file_size between 1 and 15728640)) then
    raise exception 'OUTBOUND_INPUT_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || p_staff_auth_user_id::text || p_request_id::text,0));
  select * into a from public.staff_line_attachments where organization_id=p_organization_id
    and staff_auth_user_id=p_staff_auth_user_id and request_id=p_request_id for update;
  if found then
    perform public._outbound_assert_scope(a.organization_id,a.repair_request_id,p_staff_auth_user_id,
      a.tenant_account_id,a.tenant_line_account_id,a.recipient_line_user_id);
    if row(a.repair_request_id,a.media_type,a.original_filename,a.mime_type,a.source_file_size,a.source_sha256)
      is distinct from row(p_repair_request_id,p_media_type,p_original_filename,p_mime_type,p_source_file_size,p_source_sha256) then
      raise exception 'OUTBOUND_OPERATION_MISMATCH';
    end if;
    return a;
  end if;
  select * into s from public._outbound_assert_scope(p_organization_id,p_repair_request_id,p_staff_auth_user_id);
  v_id:=gen_random_uuid();
  v_ext:=case p_mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.pdf' end;
  insert into public.staff_line_attachments(id,organization_id,repair_request_id,tenant_account_id,
    staff_auth_user_id,request_id,tenant_line_account_id,recipient_line_user_id,media_type,
    original_filename,mime_type,source_file_size,source_sha256,staging_path)
  values(v_id,p_organization_id,p_repair_request_id,s.tenant_id,p_staff_auth_user_id,p_request_id,
    s.link_id,s.recipient,p_media_type,p_original_filename,p_mime_type,p_source_file_size,p_source_sha256,
    p_organization_id::text||'/line-outbound-staging/'||p_repair_request_id::text||'/'||v_id::text||v_ext)
  returning * into a;
  return a;
end $$;

-- Metadata existence check is additional defense, NOT a substitute for backend
-- stream byte counts, SHA256, MIME/magic/decoder checks and immutable final upload.
create function public._outbound_assert_object(p_path text,p_size bigint,p_mime text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from storage.buckets where id='staff-line-files' and public is false for share;
  if not found then raise exception 'OUTBOUND_STORAGE_UNAVAILABLE'; end if;
  perform 1 from storage.objects where bucket_id='staff-line-files' and name=p_path
    and metadata->>'size'=p_size::text and metadata->>'mimetype'=p_mime for share;
  if not found then raise exception 'OUTBOUND_FILE_NOT_VERIFIED'; end if;
end $$;

create function public.finalize_staff_line_attachment_upload(
  p_organization_id uuid,p_attachment_id uuid,p_staff_auth_user_id uuid,
  p_verified_source_sha256 bytea,p_file_size bigint,p_content_sha256 bytea,
  p_preview_file_size bigint default null,p_preview_sha256 bytea default null
) returns public.staff_line_attachments
language plpgsql security definer set search_path = '' as $$
declare a public.staff_line_attachments%rowtype; v_path text; v_preview text;
begin
  select * into a from public.staff_line_attachments where id=p_attachment_id and organization_id=p_organization_id for update;
  if not found or a.staff_auth_user_id<>p_staff_auth_user_id or p_staff_auth_user_id is null then raise exception 'OUTBOUND_SCOPE_DENIED'; end if;
  perform public._outbound_assert_scope(a.organization_id,a.repair_request_id,p_staff_auth_user_id,
    a.tenant_account_id,a.tenant_line_account_id,a.recipient_line_user_id);
  if p_verified_source_sha256 is distinct from a.source_sha256
    or p_file_size is null or p_file_size<1 or p_content_sha256 is null or octet_length(p_content_sha256)<>32
    or (a.media_type='image' and (p_file_size>10000000 or p_preview_file_size is null or p_preview_file_size not between 1 and 1000000
      or p_preview_sha256 is null or octet_length(p_preview_sha256)<>32))
    or (a.media_type='pdf' and (p_file_size<>a.source_file_size or p_content_sha256<>a.source_sha256 or p_preview_file_size is not null or p_preview_sha256 is not null)) then
    raise exception 'OUTBOUND_FILE_NOT_VERIFIED';
  end if;
  if a.upload_state='ready' then
    if row(a.file_size,a.content_sha256,a.preview_file_size,a.preview_sha256) is distinct from row(p_file_size,p_content_sha256,p_preview_file_size,p_preview_sha256) then
      raise exception 'OUTBOUND_OPERATION_MISMATCH'; end if;
    return a;
  end if;
  if a.upload_state<>'uploading' then raise exception 'OUTBOUND_UPLOAD_CLOSED'; end if;
  v_path:=a.organization_id::text||'/line-outbound/'||a.repair_request_id::text||'/'||a.id::text||
    case a.mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.pdf' end;
  if a.media_type='image' then
    v_preview:=a.organization_id::text||'/line-outbound/'||a.repair_request_id::text||'/'||a.id::text||'.preview.jpg';
    perform public._outbound_assert_object(v_preview,p_preview_file_size,'image/jpeg');
  end if;
  perform public._outbound_assert_object(v_path,p_file_size,a.mime_type);
  update public.staff_line_attachments set storage_path=v_path,file_size=p_file_size,content_sha256=p_content_sha256,
    preview_storage_path=v_preview,preview_file_size=p_preview_file_size,preview_sha256=p_preview_sha256,upload_state='ready',finalized_at=clock_timestamp()
    where id=a.id returning * into a;
  return a;
end $$;

create function public.issue_staff_line_attachment_pdf_token(
  p_organization_id uuid,p_attachment_id uuid,p_staff_auth_user_id uuid,
  p_request_id uuid,p_token_hash bytea,p_expires_at timestamptz
) returns public.staff_line_attachment_tokens
language plpgsql security definer set search_path = '' as $$
declare a public.staff_line_attachments%rowtype; t public.staff_line_attachment_tokens%rowtype;
begin
  if p_request_id is null or p_token_hash is null or octet_length(p_token_hash)<>32 or p_expires_at is null then raise exception 'OUTBOUND_TOKEN_INVALID'; end if;
  select * into a from public.staff_line_attachments where id=p_attachment_id and organization_id=p_organization_id for update;
  if not found then raise exception 'OUTBOUND_SCOPE_DENIED'; end if;
  perform public._outbound_assert_scope(a.organization_id,a.repair_request_id,p_staff_auth_user_id,
    a.tenant_account_id,a.tenant_line_account_id,a.recipient_line_user_id);
  if a.media_type<>'pdf' or a.upload_state<>'ready' then raise exception 'OUTBOUND_PDF_REQUIRED'; end if;
  select * into t from public.staff_line_attachment_tokens where organization_id=p_organization_id
    and issued_by=p_staff_auth_user_id and issue_request_id=p_request_id for update;
  if found then
    if row(t.attachment_id,t.token_hash,t.expires_at) is distinct from row(a.id,p_token_hash,p_expires_at) then raise exception 'OUTBOUND_OPERATION_MISMATCH'; end if;
    return t; -- Retries never resurrect revoked/expired tokens.
  end if;
  if p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '7 days' then raise exception 'OUTBOUND_TOKEN_INVALID'; end if;
  perform 1 from public.staff_line_attachment_pushes where attachment_id=a.id and status in ('pending','sending','unknown') for update;
  if found then raise exception 'OUTBOUND_PUSH_UNRESOLVED'; end if;
  update public.staff_line_attachment_tokens set revoked_at=clock_timestamp() where attachment_id=a.id and revoked_at is null;
  insert into public.staff_line_attachment_tokens(organization_id,tenant_account_id,attachment_id,issue_request_id,issued_by,token_hash,expires_at)
    values(a.organization_id,a.tenant_account_id,a.id,p_request_id,p_staff_auth_user_id,p_token_hash,p_expires_at) returning * into t;
  return t;
end $$;

-- Freeze the exact encrypted request BEFORE any network send. This additional
-- RPC separates file finalization from PDF token issuance / payload construction.
create function public.prepare_staff_line_attachment_push(
  p_organization_id uuid,p_attachment_id uuid,p_staff_auth_user_id uuid,
  p_payload_ciphertext bytea,p_payload_key_version integer,p_payload_sha256 bytea,
  p_payload_expires_at timestamptz,p_pdf_token_id uuid default null
) returns public.staff_line_attachment_pushes
language plpgsql security definer set search_path = '' as $$
declare a public.staff_line_attachments%rowtype; q public.staff_line_attachment_pushes%rowtype; t public.staff_line_attachment_tokens%rowtype;
begin
  select * into a from public.staff_line_attachments where id=p_attachment_id and organization_id=p_organization_id for update;
  if not found or p_staff_auth_user_id is null or a.staff_auth_user_id<>p_staff_auth_user_id then raise exception 'OUTBOUND_SCOPE_DENIED'; end if;
  perform public._outbound_assert_scope(a.organization_id,a.repair_request_id,p_staff_auth_user_id,
    a.tenant_account_id,a.tenant_line_account_id,a.recipient_line_user_id);
  if a.upload_state<>'ready' then raise exception 'OUTBOUND_FILE_NOT_VERIFIED'; end if;
  select * into q from public.staff_line_attachment_pushes where attachment_id=a.id for update;
  if found then
    if row(q.payload_ciphertext,q.payload_key_version,q.payload_sha256,q.payload_expires_at,q.pdf_token_id)
      is distinct from row(p_payload_ciphertext,p_payload_key_version,p_payload_sha256,p_payload_expires_at,p_pdf_token_id) then raise exception 'OUTBOUND_OPERATION_MISMATCH'; end if;
    return q;
  end if;
  if p_payload_ciphertext is null or octet_length(p_payload_ciphertext) not between 32 and 65536
    or p_payload_key_version is null or p_payload_key_version<1 or p_payload_sha256 is null or octet_length(p_payload_sha256)<>32
    or p_payload_expires_at is null or p_payload_expires_at<clock_timestamp()+interval '26 hours' then raise exception 'OUTBOUND_PAYLOAD_INVALID'; end if;
  if a.media_type='pdf' then
    select * into t from public.staff_line_attachment_tokens where id=p_pdf_token_id and attachment_id=a.id
      and organization_id=a.organization_id and tenant_account_id=a.tenant_account_id and revoked_at is null for update;
    if not found or t.expires_at<>p_payload_expires_at then raise exception 'OUTBOUND_TOKEN_INVALID'; end if;
  elsif p_pdf_token_id is not null or p_payload_expires_at>clock_timestamp()+interval '28 hours' then
    raise exception 'OUTBOUND_PAYLOAD_INVALID';
  end if;
  insert into public.staff_line_attachment_pushes(organization_id,tenant_account_id,attachment_id,tenant_line_account_id,
    recipient_line_user_id,payload_ciphertext,payload_key_version,payload_sha256,payload_expires_at,pdf_token_id)
  values(a.organization_id,a.tenant_account_id,a.id,a.tenant_line_account_id,a.recipient_line_user_id,
    p_payload_ciphertext,p_payload_key_version,p_payload_sha256,p_payload_expires_at,p_pdf_token_id) returning * into q;
  return q;
end $$;

create function public.claim_staff_line_attachment_push(
  p_organization_id uuid,p_attachment_id uuid,p_staff_auth_user_id uuid
) returns setof public.staff_line_attachment_pushes
language plpgsql security definer set search_path = '' as $$
declare a public.staff_line_attachments%rowtype; q public.staff_line_attachment_pushes%rowtype; v_now timestamptz;
begin
  select * into a from public.staff_line_attachments where id=p_attachment_id and organization_id=p_organization_id for update;
  if not found or p_staff_auth_user_id is null or a.staff_auth_user_id<>p_staff_auth_user_id then raise exception 'OUTBOUND_SCOPE_DENIED'; end if;
  perform public._outbound_assert_scope(a.organization_id,a.repair_request_id,p_staff_auth_user_id,
    a.tenant_account_id,a.tenant_line_account_id,a.recipient_line_user_id);
  select * into q from public.staff_line_attachment_pushes where attachment_id=a.id for update;
  if not found then raise exception 'OUTBOUND_PUSH_MISSING'; end if;
  if q.status in ('accepted','failed','expired') then return; end if;
  v_now:=clock_timestamp();
  if q.status='sending' and q.lease_until>v_now then return; end if;
  if (q.first_attempt_at is null and q.payload_expires_at<v_now+interval '26 hours')
    or (q.retry_deadline is not null and q.retry_deadline<=v_now+interval '1 minute')
    or q.payload_expires_at<=v_now+interval '2 hours' then
    update public.staff_line_attachment_pushes set status='expired',lease_id=null,lease_until=null,updated_at=v_now where id=q.id;
    return;
  end if;
  if a.media_type='pdf' then
    perform 1 from public.staff_line_attachment_tokens where id=q.pdf_token_id and attachment_id=a.id
      and revoked_at is null and expires_at>v_now+interval '2 hours' for share;
    if not found then
      update public.staff_line_attachment_pushes set status='expired',lease_id=null,lease_until=null,updated_at=v_now where id=q.id;
      return;
    end if;
  end if;
  update public.staff_line_attachment_pushes set status='sending',lease_id=gen_random_uuid(),lease_until=v_now+interval '60 seconds',
    first_attempt_at=coalesce(first_attempt_at,v_now),
    retry_deadline=coalesce(retry_deadline,least(v_now+interval '24 hours'-interval '1 minute',payload_expires_at-interval '2 hours')),
    attempt_count=attempt_count+1,updated_at=v_now where id=q.id returning * into q;
  return next q;
end $$;

create function public.finish_staff_line_attachment_push(
  p_organization_id uuid,p_attachment_id uuid,p_staff_auth_user_id uuid,p_lease_id uuid,p_result text
) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.staff_line_attachments%rowtype; q public.staff_line_attachment_pushes%rowtype; v_now timestamptz;
begin
  if p_result is null or p_result not in ('accepted','failed','unknown') or p_lease_id is null then raise exception 'OUTBOUND_RESULT_INVALID'; end if;
  select * into a from public.staff_line_attachments where id=p_attachment_id and organization_id=p_organization_id for update;
  if not found or p_staff_auth_user_id is null or a.staff_auth_user_id<>p_staff_auth_user_id then raise exception 'OUTBOUND_SCOPE_DENIED'; end if;
  perform public._outbound_assert_scope(a.organization_id,a.repair_request_id,p_staff_auth_user_id,
    a.tenant_account_id,a.tenant_line_account_id,a.recipient_line_user_id);
  select * into q from public.staff_line_attachment_pushes where attachment_id=a.id for update;
  if not found then raise exception 'OUTBOUND_PUSH_MISSING'; end if;
  if q.status='accepted' then return 'accepted'; end if;
  v_now:=clock_timestamp();
  if q.status<>'sending' or q.lease_id is distinct from p_lease_id or q.lease_until<=v_now then return 'stale'; end if;
  update public.staff_line_attachment_pushes set status=p_result,
    accepted_at=case when p_result='accepted' then v_now else accepted_at end,
    lease_id=null,lease_until=null,updated_at=v_now where id=q.id;
  return p_result;
end $$;

create function public.revoke_staff_line_attachment_pdf_token(
  p_organization_id uuid,p_attachment_id uuid,p_staff_auth_user_id uuid,p_token_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare a public.staff_line_attachments%rowtype; t public.staff_line_attachment_tokens%rowtype;
begin
  select * into a from public.staff_line_attachments where id=p_attachment_id and organization_id=p_organization_id for update;
  if not found then raise exception 'OUTBOUND_SCOPE_DENIED'; end if;
  -- Revocation must remain possible after tenant/LINE deactivation. This is an
  -- administrative denial of access, not sending; validate active staff only.
  perform 1 from public.organization_members where organization_id=p_organization_id and auth_user_id=p_staff_auth_user_id
    and is_active is true and role in ('admin','manager','staff') for share;
  if not found then raise exception 'OUTBOUND_SCOPE_DENIED'; end if;
  if a.media_type<>'pdf' then raise exception 'OUTBOUND_PDF_REQUIRED'; end if;
  select * into t from public.staff_line_attachment_tokens where id=p_token_id and attachment_id=a.id and organization_id=a.organization_id for update;
  if not found then raise exception 'OUTBOUND_TOKEN_INVALID'; end if;
  update public.staff_line_attachment_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=t.id;
  -- Keep any accepted result. A claim already in flight can still send a link,
  -- but redemption will deny it. Never turn unknown acceptance into a new push.
  return true;
end $$;

-- No direct DML grants: enforce immutable rows even for an accidental owner edit.
create function public._outbound_immutable_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then raise exception 'OUTBOUND_HISTORY_IMMUTABLE'; end if;
  if tg_table_name='staff_line_attachments' then
    if (to_jsonb(new)-array['storage_path','file_size','content_sha256','preview_storage_path','preview_file_size','preview_sha256','upload_state','finalized_at'])
      is distinct from (to_jsonb(old)-array['storage_path','file_size','content_sha256','preview_storage_path','preview_file_size','preview_sha256','upload_state','finalized_at'])
      or (old.upload_state<>'uploading' and to_jsonb(new) is distinct from to_jsonb(old)) then raise exception 'OUTBOUND_HISTORY_IMMUTABLE'; end if;
  elsif tg_table_name='staff_line_attachment_pushes' then
    if (to_jsonb(new)-array['status','first_attempt_at','retry_deadline','accepted_at','lease_id','lease_until','attempt_count','updated_at'])
      is distinct from (to_jsonb(old)-array['status','first_attempt_at','retry_deadline','accepted_at','lease_id','lease_until','attempt_count','updated_at'])
      or (old.status in ('accepted','failed','expired') and to_jsonb(new) is distinct from to_jsonb(old))
      or (old.first_attempt_at is not null and row(new.first_attempt_at,new.retry_deadline) is distinct from row(old.first_attempt_at,old.retry_deadline))
      or new.attempt_count<old.attempt_count then raise exception 'OUTBOUND_HISTORY_IMMUTABLE'; end if;
  else
    if (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at')
      or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then raise exception 'OUTBOUND_HISTORY_IMMUTABLE'; end if;
  end if;
  return new;
end $$;
create trigger outbound_attachment_immutable before update or delete on public.staff_line_attachments
  for each row execute function public._outbound_immutable_guard();
create trigger outbound_push_immutable before update or delete on public.staff_line_attachment_pushes
  for each row execute function public._outbound_immutable_guard();
create trigger outbound_token_immutable before update or delete on public.staff_line_attachment_tokens
  for each row execute function public._outbound_immutable_guard();

-- Explicit signature-safe ACLs. Internal helpers are not RPCs for service_role.
do $$
declare r record;
begin
  for r in select p.oid,p.proname from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      '_outbound_assert_scope','_outbound_assert_object','_outbound_immutable_guard',
      'reserve_staff_line_attachment','finalize_staff_line_attachment_upload',
      'issue_staff_line_attachment_pdf_token','prepare_staff_line_attachment_push',
      'claim_staff_line_attachment_push','finish_staff_line_attachment_push','revoke_staff_line_attachment_pdf_token')
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.oid::regprocedure);
    if left(r.proname,1)<>'_' then
      execute format('grant execute on function %s to service_role',r.oid::regprocedure);
    end if;
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
