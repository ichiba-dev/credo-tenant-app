-- Atomic manual vendor dispatch confirmation and immutable delivery history.
-- Apply once after vendor-dispatch-phase1.migration.sql.
begin;
set local lock_timeout='10s';

do $$
declare
  v_dispatch regclass:=to_regclass('public.repair_vendor_dispatches');
  v_vendor regclass:=to_regclass('public.repair_vendors');
  v_member regclass:=to_regclass('public.organization_members');
begin
  if v_dispatch is null or v_vendor is null or v_member is null
    or to_regprocedure('public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text)') is null
    or to_regprocedure('public._vendor_phase1_no_change()') is null then
    raise exception 'Vendor dispatch Phase 1 objects are required';
  end if;
  if to_regclass('public.repair_vendor_dispatch_messages') is not null
    or to_regclass('public.repair_vendor_dispatch_messages_pkey') is not null
    or to_regclass('public.vendor_dispatch_messages_org_id_uq') is not null
    or to_regclass('public.vendor_dispatch_messages_request_uq') is not null
    or to_regclass('public.repair_vendor_dispatch_messages_timeline_idx') is not null
    or exists (select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='confirm_vendor_dispatch_manual')
    or exists (select 1 from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid=t.tgrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and t.tgname='vendor_dispatch_messages_immutable')
    or exists (select 1 from pg_catalog.pg_policies p
      where p.schemaname='public' and p.policyname='repair_vendor_dispatch_messages_staff_read') then
    raise exception 'Vendor dispatch messaging objects already exist';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint k where k.conrelid=v_dispatch
      and k.contype in ('p','u') and k.conkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=v_dispatch and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=v_dispatch and attname='id')]::smallint[])
    or not exists (select 1 from pg_catalog.pg_constraint k where k.conrelid=v_member
      and k.contype in ('p','u') and k.conkey=array[
        (select attnum from pg_catalog.pg_attribute where attrelid=v_member and attname='organization_id'),
        (select attnum from pg_catalog.pg_attribute where attrelid=v_member and attname='auth_user_id')]::smallint[]) then
    raise exception 'Vendor dispatch messaging key prerequisites mismatch';
  end if;
end $$;

create table public.repair_vendor_dispatch_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dispatch_id uuid not null,
  channel text not null check (channel ~ '^[a-z][a-z0-9_]{1,39}$'),
  message_body text not null check (length(btrim(message_body)) between 1 and 10000),
  recipient_label text not null check (length(btrim(recipient_label)) between 1 and 300),
  recipient_address text check (recipient_address is null or length(btrim(recipient_address)) between 1 and 500),
  sent_by uuid not null,
  request_id uuid not null,
  sent_at timestamptz,
  delivery_status text not null check (delivery_status ~ '^[a-z][a-z0-9_]{1,39}$'),
  created_at timestamptz not null default clock_timestamp(),
  constraint vendor_dispatch_messages_org_id_uq unique (organization_id,id),
  constraint vendor_dispatch_messages_request_uq unique (organization_id,request_id),
  foreign key (organization_id,dispatch_id)
    references public.repair_vendor_dispatches(organization_id,id),
  foreign key (organization_id,sent_by)
    references public.organization_members(organization_id,auth_user_id),
  check (channel<>'manual' or (delivery_status='manual_confirmed' and sent_at is not null)),
  check (sent_at is null or sent_at<=created_at)
);
create index repair_vendor_dispatch_messages_timeline_idx
  on public.repair_vendor_dispatch_messages(organization_id,dispatch_id,sent_at,id);

create trigger vendor_dispatch_messages_immutable
  before update or delete on public.repair_vendor_dispatch_messages
  for each row execute function public._vendor_phase1_no_change();

alter table public.repair_vendor_dispatch_messages enable row level security;
revoke all on public.repair_vendor_dispatch_messages from public,anon,authenticated,service_role;
grant select on public.repair_vendor_dispatch_messages to authenticated,service_role;
create policy repair_vendor_dispatch_messages_staff_read
  on public.repair_vendor_dispatch_messages for select to authenticated
  using (private.has_org_role(organization_id,
    array['admin','manager','staff','viewer']::text[]));

create function public.confirm_vendor_dispatch_manual(
  p_org uuid,p_dispatch uuid,p_actor uuid,p_request_id uuid,
  p_message_body text,p_recipient_label text,p_recipient_address text)
returns public.repair_vendor_dispatch_messages
language plpgsql security definer set search_path='' as $$
declare
  v_dispatch public.repair_vendor_dispatches%rowtype;
  v_message public.repair_vendor_dispatch_messages%rowtype;
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
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org::text||p_request_id::text,0));
  select * into v_message from public.repair_vendor_dispatch_messages
    where organization_id=p_org and request_id=p_request_id;
  if found then
    if v_message.dispatch_id is distinct from p_dispatch
      or v_message.sent_by is distinct from p_actor
      or v_message.channel is distinct from 'manual'
      or v_message.delivery_status is distinct from 'manual_confirmed'
      or v_message.message_body is distinct from btrim(p_message_body)
      or v_message.recipient_label is distinct from btrim(p_recipient_label)
      or v_message.recipient_address is distinct from
        (case when p_recipient_address is null then null else btrim(p_recipient_address) end) then
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
     recipient_address,sent_by,request_id,sent_at,delivery_status,created_at)
  values (p_org,p_dispatch,'manual',btrim(p_message_body),btrim(p_recipient_label),
    case when p_recipient_address is null then null else btrim(p_recipient_address) end,
    p_actor,p_request_id,v_sent_at,'manual_confirmed',v_sent_at)
  returning * into v_message;
  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor::text,true);
  perform public.transition_repair_vendor_dispatch(
    p_org,p_dispatch,'dispatched',p_request_id,'手動送信をスタッフが確認');
  return v_message;
end $$;

revoke all on function public.confirm_vendor_dispatch_manual(
  uuid,uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.confirm_vendor_dispatch_manual(
  uuid,uuid,uuid,uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
