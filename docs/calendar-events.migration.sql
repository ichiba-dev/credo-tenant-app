-- Apply only after calendar-events.production-preflight.readonly.sql is ready.
begin;
set local lock_timeout='10s';
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  title text not null check (length(btrim(title)) between 1 and 300),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  starts_at timestamptz not null check (isfinite(starts_at)),
  ends_at timestamptz check (ends_at is null or (isfinite(ends_at) and ends_at > starts_at)),
  all_day boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  repair_request_id bigint,
  vendor_dispatch_id uuid,
  notes text check (notes is null or length(notes)<=3000),
  source_type text not null check (source_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint calendar_events_repair_fk foreign key (organization_id,repair_request_id)
    references public.repair_requests(organization_id,id) on update no action on delete no action,
  constraint calendar_events_dispatch_fk foreign key (organization_id,repair_request_id,vendor_dispatch_id)
    references public.repair_vendor_dispatches(organization_id,repair_request_id,id) on update no action on delete no action,
  constraint calendar_events_creator_fk foreign key (organization_id,created_by)
    references public.organization_members(organization_id,auth_user_id) on update no action on delete no action,
  constraint calendar_events_source_ck check (
    (vendor_dispatch_id is null or repair_request_id is not null) and
    (source_type <> 'repair' or repair_request_id is not null) and
    (source_type <> 'vendor_dispatch' or (repair_request_id is not null and vendor_dispatch_id is not null))),
  constraint calendar_events_all_day_ck check (not all_day or (
    (starts_at at time zone 'Asia/Tokyo')::time=time '00:00' and ends_at is not null and
    (ends_at at time zone 'Asia/Tokyo')::time=time '00:00'))
);
create index calendar_events_org_start_idx on public.calendar_events(organization_id,starts_at);
create index calendar_events_repair_idx on public.calendar_events(organization_id,repair_request_id);
create function public.calendar_events_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='UPDATE' then
    if (new.id,new.organization_id,new.created_by,new.created_at,new.source_type,new.repair_request_id,new.vendor_dispatch_id)
      is distinct from (old.id,old.organization_id,old.created_by,old.created_at,old.source_type,old.repair_request_id,old.vendor_dispatch_id) then
      raise exception 'CALENDAR_IDENTITY_IMMUTABLE';
    end if;
    if old.status<>'scheduled' then raise exception 'CALENDAR_EVENT_CLOSED'; end if;
  else
    new.created_at:=clock_timestamp();
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;
revoke all on function public.calendar_events_guard() from public,anon,authenticated,service_role;
create trigger calendar_events_guard before insert or update on public.calendar_events
  for each row execute function public.calendar_events_guard();
alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from public,anon,authenticated,service_role;
grant select,insert,update on public.calendar_events to authenticated;
create policy calendar_events_read on public.calendar_events for select to authenticated
  using (private.has_org_role(organization_id,array['admin','manager','staff','viewer']::text[]));
create policy calendar_events_insert on public.calendar_events for insert to authenticated
  with check (created_by=auth.uid() and status='scheduled' and
    private.has_org_role(organization_id,array['admin','manager','staff']::text[]));
create policy calendar_events_update on public.calendar_events for update to authenticated
  using (private.has_org_role(organization_id,array['admin','manager','staff']::text[]))
  with check (private.has_org_role(organization_id,array['admin','manager','staff']::text[]));
notify pgrst,'reload schema';
commit;
