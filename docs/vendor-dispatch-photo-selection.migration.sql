-- Apply only after the read-only preflight reports ready. No Storage copies.
begin;
set local lock_timeout='10s';

-- Serialize schema inspection with writers/DDL. Existing IDs are never changed.
lock table public.repair_photos in access exclusive mode;
do $$
declare a record;
begin
  select * into a from pg_catalog.pg_attribute
    where attrelid='public.repair_photos'::regclass and attname='id'
      and attnum>0 and not attisdropped;
  if not found then
    raise exception 'Existing repair_photos.id bigint is required';
  end if;
  if a.atttypid<>'bigint'::regtype or not a.attnotnull
      or not exists (
        select 1 from pg_catalog.pg_index i where i.indrelid=a.attrelid
          and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
          and i.indpred is null and i.indexprs is null
          and (array(select x.attname::text from unnest(i.indkey) with ordinality u(n,o)
            join pg_catalog.pg_attribute x on x.attrelid=i.indrelid and x.attnum=u.n
            where u.o<=i.indnkeyatts order by u.o)
            in (array['id'],array['organization_id','id'],array['id','organization_id']))
      ) then
      raise exception 'Existing repair_photos.id must be bigint NOT NULL with an immediate valid unique key on id or organization/id; existing IDs were not modified';
  end if;
end $$;
alter table public.repair_vendor_dispatch_messages
  add column photo_selection_recorded boolean not null default false;
-- Non-deferrable keys pin both sources and the message's dispatch to the repair.
-- NO ACTION FKs plus immutable attachment rows reject reassignment/deletion of
-- referenced sources (including LINE unassignment), without copying photo data.
alter table public.repair_photos add constraint vendor_dispatch_repair_photos_org_id_uq
  unique (organization_id,repair_id,id) not deferrable;
alter table public.tenant_line_attachments add constraint vendor_dispatch_line_attachments_org_id_uq
  unique (organization_id,repair_request_id,id) not deferrable;
alter table public.repair_vendor_dispatches add constraint vendor_dispatch_repair_scope_uq
  unique (organization_id,repair_request_id,id) not deferrable;
alter table public.repair_vendor_dispatch_messages add constraint vendor_dispatch_message_scope_uq
  unique (organization_id,id,dispatch_id) not deferrable;

create table public.repair_vendor_dispatch_message_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  message_id uuid not null,
  dispatch_id uuid not null,
  repair_request_id bigint not null,
  source_type text not null,
  repair_photo_id bigint,
  tenant_line_attachment_id uuid,
  legacy_source_key text,
  file_name text,
  mime_type text,
  sort_order integer not null check (sort_order between 0 and 29),
  created_at timestamptz not null default clock_timestamp(),
  constraint vendor_dispatch_message_attachment_source_ck check (
    (source_type='repair_photo' and repair_photo_id is not null
      and tenant_line_attachment_id is null and legacy_source_key is null) or
    (source_type='tenant_line_attachment' and repair_photo_id is null
      and tenant_line_attachment_id is not null and legacy_source_key is null) or
    (source_type='legacy_photo' and repair_photo_id is null
      and tenant_line_attachment_id is null and legacy_source_key is not null)),
  constraint vendor_dispatch_message_attachment_legacy_key_ck check (
    legacy_source_key is null or (length(legacy_source_key) between 1 and 100)),
  constraint vendor_dispatch_message_attachment_file_name_ck check (
    file_name is null or length(file_name) between 1 and 300),
  constraint vendor_dispatch_message_attachment_mime_ck check (
    mime_type is null or length(mime_type) between 1 and 100),
  constraint vendor_dispatch_message_attachment_message_fk
    foreign key (organization_id,message_id,dispatch_id)
    references public.repair_vendor_dispatch_messages(organization_id,id,dispatch_id)
    on update no action on delete no action not deferrable,
  constraint vendor_dispatch_message_attachment_dispatch_fk
    foreign key (organization_id,repair_request_id,dispatch_id)
    references public.repair_vendor_dispatches(organization_id,repair_request_id,id)
    on update no action on delete no action not deferrable,
  constraint vendor_dispatch_message_attachment_photo_fk
    foreign key (organization_id,repair_request_id,repair_photo_id)
    references public.repair_photos(organization_id,repair_id,id)
    on update no action on delete no action not deferrable,
  constraint vendor_dispatch_message_attachment_line_fk
    foreign key (organization_id,repair_request_id,tenant_line_attachment_id)
    references public.tenant_line_attachments(organization_id,repair_request_id,id)
    on update no action on delete no action not deferrable,
  constraint vendor_dispatch_message_attachment_order_uq
    unique (organization_id,message_id,sort_order)
);
create unique index vendor_dispatch_message_attachment_photo_uq
  on public.repair_vendor_dispatch_message_attachments
  (organization_id,message_id,repair_photo_id) where repair_photo_id is not null;
create unique index vendor_dispatch_message_attachment_line_uq
  on public.repair_vendor_dispatch_message_attachments
  (organization_id,message_id,tenant_line_attachment_id) where tenant_line_attachment_id is not null;
create unique index vendor_dispatch_message_attachment_legacy_uq
  on public.repair_vendor_dispatch_message_attachments
  (organization_id,message_id,legacy_source_key) where legacy_source_key is not null;

create function public._vendor_dispatch_attachment_scope_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_repair bigint; v_source_repair bigint; v_media text;
begin
  select d.repair_request_id into v_repair
  from public.repair_vendor_dispatch_messages m
  join public.repair_vendor_dispatches d
    on d.organization_id=m.organization_id and d.id=m.dispatch_id
  where m.organization_id=new.organization_id and m.id=new.message_id
    and m.dispatch_id=new.dispatch_id;
  if v_repair is null or new.repair_request_id is distinct from v_repair then
    raise exception 'VENDOR_ATTACHMENT_SCOPE_DENIED';
  end if;
  if new.source_type='repair_photo' then
    select repair_id into v_source_repair from public.repair_photos
      where organization_id=new.organization_id and id=new.repair_photo_id
        and repair_id=new.repair_request_id;
  elsif new.source_type='tenant_line_attachment' then
    select repair_request_id,media_type into v_source_repair,v_media
    from public.tenant_line_attachments where organization_id=new.organization_id
      and id=new.tenant_line_attachment_id;
    if v_media is distinct from 'image' then
      raise exception 'VENDOR_ATTACHMENT_SCOPE_DENIED';
    end if;
  elsif new.source_type='legacy_photo' then
    if new.legacy_source_key is distinct from 'repair_request:'||v_repair::text
      or not exists (select 1 from public.repair_requests
        where organization_id=new.organization_id and id=v_repair
          and (nullif(storage_path,'') is not null or nullif(photo_url,'') is not null)) then
      raise exception 'VENDOR_ATTACHMENT_SCOPE_DENIED';
    end if;
    v_source_repair:=v_repair;
  else
    raise exception 'VENDOR_ATTACHMENT_SCOPE_DENIED';
  end if;
  if v_source_repair is distinct from v_repair then
    raise exception 'VENDOR_ATTACHMENT_SCOPE_DENIED';
  end if;
  return new;
end $$;
revoke all on function public._vendor_dispatch_attachment_scope_guard()
  from public,anon,authenticated,service_role;
create trigger vendor_dispatch_attachment_scope_guard
  before insert on public.repair_vendor_dispatch_message_attachments
  for each row execute function public._vendor_dispatch_attachment_scope_guard();
create trigger vendor_dispatch_attachment_immutable
  before update or delete on public.repair_vendor_dispatch_message_attachments
  for each row execute function public._vendor_phase1_no_change();

alter table public.repair_vendor_dispatch_message_attachments enable row level security;
revoke all on public.repair_vendor_dispatch_message_attachments from public,anon,authenticated,service_role;
grant select on public.repair_vendor_dispatch_message_attachments to authenticated,service_role;
create policy vendor_dispatch_message_attachments_staff_read
  on public.repair_vendor_dispatch_message_attachments for select to authenticated
  using (private.has_org_role(organization_id,
    array['admin','manager','staff','viewer']::text[]));

create function public.confirm_vendor_dispatch_manual_v2(
  p_org uuid,p_dispatch uuid,p_actor uuid,p_request_id uuid,
  p_message_body text,p_recipient_label text,p_recipient_address text,p_photos jsonb)
returns public.repair_vendor_dispatch_messages
language plpgsql security definer set search_path='' as $$
declare
  v_dispatch public.repair_vendor_dispatches%rowtype;
  v_message public.repair_vendor_dispatch_messages%rowtype;
  v_photo jsonb; v_index integer; v_count integer;
  v_existing jsonb; v_requested jsonb;
  v_source text; v_id uuid; v_photo_id bigint;
  v_sent_at timestamptz;
begin
  if p_org is null or p_dispatch is null or p_actor is null or p_request_id is null
    or nullif(btrim(p_message_body),'') is null or length(btrim(p_message_body))>10000
    or nullif(btrim(p_recipient_label),'') is null or length(btrim(p_recipient_label))>300
    or (p_recipient_address is not null and
      (nullif(btrim(p_recipient_address),'') is null or length(btrim(p_recipient_address))>500))
    or not exists (select 1 from public.organization_members
      where organization_id=p_org and auth_user_id=p_actor and is_active is true
        and role in ('admin','manager','staff')) then
    raise exception 'VENDOR_DISPATCH_MESSAGE_SCOPE_DENIED';
  end if;
  if p_photos is null or jsonb_typeof(p_photos)<>'array'
    or jsonb_array_length(p_photos)>30 then
    raise exception 'VENDOR_ATTACHMENT_PAYLOAD_INVALID';
  end if;
  v_requested:='[]'::jsonb;
  for v_photo,v_index in select value,ordinality::integer-1
    from jsonb_array_elements(p_photos) with ordinality loop
    if jsonb_typeof(v_photo)<>'object' or
      (select count(*) from jsonb_object_keys(v_photo))<>2 or
      not (v_photo ? 'source_type' and v_photo ? 'source_id') then
      raise exception 'VENDOR_ATTACHMENT_PAYLOAD_INVALID';
    end if;
    v_source:=v_photo->>'source_type';
    if v_source is null or v_source not in ('repair_photo','tenant_line_attachment','legacy_photo') then
      raise exception 'VENDOR_ATTACHMENT_PAYLOAD_INVALID';
    end if;
    if v_source='legacy_photo' then
      if v_photo->'source_id'<>'null'::jsonb then
        raise exception 'VENDOR_ATTACHMENT_PAYLOAD_INVALID';
      end if;
    elsif v_source='repair_photo' then
      if coalesce(v_photo->>'source_id','') !~ '^-?(0|[1-9][0-9]*)$' then
        raise exception 'VENDOR_ATTACHMENT_PAYLOAD_INVALID';
      end if;
      begin v_photo_id:=(v_photo->>'source_id')::bigint;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'VENDOR_ATTACHMENT_PAYLOAD_INVALID'; end;
    else
      begin v_id:=(v_photo->>'source_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'VENDOR_ATTACHMENT_PAYLOAD_INVALID'; end;
      if v_id is null then raise exception 'VENDOR_ATTACHMENT_PAYLOAD_INVALID'; end if;
    end if;
    v_requested:=v_requested || jsonb_build_array(
      jsonb_build_object('source_type',v_source,'source_id',
        case when v_source='legacy_photo' then null
          when v_source='repair_photo' then v_photo_id::text else v_id::text end));
  end loop;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org::text||p_request_id::text,0));
  select * into v_message from public.repair_vendor_dispatch_messages
    where organization_id=p_org and request_id=p_request_id;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('source_type',source_type,
      'source_id',case source_type when 'repair_photo' then repair_photo_id::text
        when 'tenant_line_attachment' then tenant_line_attachment_id::text else null end)
      order by sort_order),'[]'::jsonb) into v_existing
    from public.repair_vendor_dispatch_message_attachments
    where organization_id=p_org and message_id=v_message.id;
    if v_message.dispatch_id is distinct from p_dispatch
      or v_message.photo_selection_recorded is distinct from true
      or v_message.sent_by is distinct from p_actor
      or v_message.channel is distinct from 'manual'
      or v_message.delivery_status is distinct from 'manual_confirmed'
      or v_message.message_body is distinct from btrim(p_message_body)
      or v_message.recipient_label is distinct from btrim(p_recipient_label)
      or v_message.recipient_address is distinct from
        (case when p_recipient_address is null then null else btrim(p_recipient_address) end)
      or v_existing is distinct from v_requested then
      raise exception 'VENDOR_DISPATCH_MESSAGE_REQUEST_CONFLICT';
    end if;
    return v_message;
  end if;
  select * into v_dispatch from public.repair_vendor_dispatches
    where organization_id=p_org and id=p_dispatch for update;
  if not found then raise exception 'VENDOR_DISPATCH_MESSAGE_SCOPE_DENIED'; end if;
  if v_dispatch.status<>'candidate' then
    raise exception 'VENDOR_DISPATCH_MESSAGE_STATUS_CONFLICT';
  end if;
  v_sent_at:=clock_timestamp();
  insert into public.repair_vendor_dispatch_messages
    (organization_id,dispatch_id,channel,message_body,recipient_label,
     recipient_address,sent_by,request_id,sent_at,delivery_status,created_at,
     photo_selection_recorded)
  values (p_org,p_dispatch,'manual',btrim(p_message_body),btrim(p_recipient_label),
    case when p_recipient_address is null then null else btrim(p_recipient_address) end,
    p_actor,p_request_id,v_sent_at,'manual_confirmed',v_sent_at,true)
  returning * into v_message;
  for v_photo,v_index in select value,ordinality::integer-1
    from jsonb_array_elements(v_requested) with ordinality loop
    v_source:=v_photo->>'source_type';
    v_id:=case when v_source='tenant_line_attachment' then (v_photo->>'source_id')::uuid else null end;
    v_photo_id:=case when v_source='repair_photo' then (v_photo->>'source_id')::bigint else null end;
    insert into public.repair_vendor_dispatch_message_attachments
      (organization_id,message_id,dispatch_id,repair_request_id,source_type,repair_photo_id,
       tenant_line_attachment_id,legacy_source_key,sort_order)
    values (p_org,v_message.id,p_dispatch,v_dispatch.repair_request_id,v_source,
      v_photo_id,
      case when v_source='tenant_line_attachment' then v_id else null end,
      case when v_source='legacy_photo' then 'repair_request:'||v_dispatch.repair_request_id::text else null end,
      v_index);
  end loop;
  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor::text,true);
  perform public.transition_repair_vendor_dispatch(
    p_org,p_dispatch,'dispatched',p_request_id,'手動送信をスタッフが確認');
  return v_message;
end $$;
revoke all on function public.confirm_vendor_dispatch_manual_v2(
  uuid,uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.confirm_vendor_dispatch_manual_v2(
  uuid,uuid,uuid,uuid,text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
