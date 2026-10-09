begin;
set local lock_timeout='10s';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'Owner Auth Phase1 migration requires reviewed RLS-bypass execution';
  end if;
  if to_regclass('public.owners') is null or to_regclass('public.organizations') is null then
    raise exception 'Expected owners and organizations tables are required';
  end if;
  if (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) <> 3 then
    raise exception 'Missing expected Supabase API roles';
  end if;
  if not (select rolbypassrls from pg_roles where rolname='service_role') then
    raise exception 'service_role must retain BYPASSRLS';
  end if;
  if exists (select 1 from pg_attribute where attrelid='public.owners'::regclass and attname='email'
      and attnum > 0 and not attisdropped and atttypid <> 'text'::regtype) then
    raise exception 'Existing owners.email must be text';
  end if;
end $$;

alter table public.owners add column if not exists email text;

create table public.owner_auth_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  owner_id uuid not null,
  request_id uuid not null unique,
  operation_type text not null check (operation_type in ('link_existing','invite','correct_link')),
  requested_email text not null,
  previous_auth_user_id uuid,
  target_auth_user_id uuid,
  status text not null check (status in ('started','auth_created_db_pending','needs_review','completed')),
  actor_auth_user_id uuid not null,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint owner_auth_operations_owner_org_fk foreign key (organization_id, owner_id)
    references public.owners(organization_id, id),
  constraint owner_auth_operations_completed_at_check check ((status='completed') = (completed_at is not null)),
  constraint owner_auth_operations_target_required_check check (status not in ('auth_created_db_pending','completed') or target_auth_user_id is not null),
  constraint owner_auth_operations_email_check check (length(btrim(requested_email)) > 0),
  constraint owner_auth_operations_error_code_check check (error_code is null or length(error_code) <= 128)
);

create index owner_auth_operations_org_owner_created_idx
  on public.owner_auth_operations (organization_id, owner_id, created_at desc);

create function public.guard_owner_auth_operation_identity()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'OWNER_AUTH_AUDIT_DELETE_FORBIDDEN';
  end if;
  if row(new.id, new.organization_id, new.owner_id, new.request_id, new.operation_type,
         new.requested_email, new.previous_auth_user_id, new.actor_auth_user_id, new.created_at)
     is distinct from
     row(old.id, old.organization_id, old.owner_id, old.request_id, old.operation_type,
         old.requested_email, old.previous_auth_user_id, old.actor_auth_user_id, old.created_at) then
    raise exception 'OWNER_AUTH_AUDIT_IDENTITY_IMMUTABLE';
  end if;
  if old.target_auth_user_id is not null and new.target_auth_user_id is distinct from old.target_auth_user_id then
    raise exception 'OWNER_AUTH_TARGET_IMMUTABLE';
  end if;
  if old.status='completed' and row(new.status,new.completed_at) is distinct from row(old.status,old.completed_at) then
    raise exception 'OWNER_AUTH_COMPLETED_STATE_IMMUTABLE';
  end if;
  if not ((old.status='started' and new.status in ('started','auth_created_db_pending','needs_review'))
      or (old.status='auth_created_db_pending' and new.status in ('auth_created_db_pending','needs_review','completed'))
      or (old.status='needs_review' and new.status in ('needs_review','completed'))
      or (old.status='completed' and new.status='completed')) then
    raise exception 'OWNER_AUTH_STATUS_TRANSITION_INVALID';
  end if;
  return new;
end $$;

create trigger owner_auth_operations_guard_identity
before update or delete on public.owner_auth_operations
for each row execute function public.guard_owner_auth_operation_identity();

alter table public.owner_auth_operations enable row level security;
alter table public.owner_auth_operations force row level security;
revoke all privileges on table public.owner_auth_operations from public, anon, authenticated, service_role;
do $$
declare
  column_row record;
  relation_oid oid := 'public.owner_auth_operations'::regclass;
begin
  for column_row in
    select attname from pg_attribute
    where attrelid=relation_oid and attnum>0 and not attisdropped
  loop
    execute format('revoke all privileges (%I) on table public.owner_auth_operations from public, anon, authenticated, service_role',column_row.attname);
  end loop;
end $$;

grant select, insert, update on table public.owner_auth_operations to service_role;

do $$
declare
  privilege_name text;
  role_name text;
  relation_oid oid := 'public.owner_auth_operations'::regclass;
  service_role_oid oid := (select oid from pg_roles where rolname='service_role');
begin
  foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege(service_role_oid,relation_oid,privilege_name) is distinct from
       (privilege_name in ('SELECT','INSERT','UPDATE')) then
      raise exception 'OWNER_AUTH_SERVICE_ROLE_ACL_INVALID: %',privilege_name;
    end if;
    if has_table_privilege(service_role_oid,relation_oid,privilege_name||' WITH GRANT OPTION') then
      raise exception 'OWNER_AUTH_SERVICE_ROLE_GRANT_OPTION_FORBIDDEN: %',privilege_name;
    end if;
    foreach role_name in array array['anon','authenticated'] loop
      if has_table_privilege(role_name,relation_oid,privilege_name) or
         has_table_privilege(role_name,relation_oid,privilege_name||' WITH GRANT OPTION') then
        raise exception 'OWNER_AUTH_BROWSER_ROLE_ACL_FORBIDDEN: % %',role_name,privilege_name;
      end if;
    end loop;
  end loop;

  if exists (select 1 from pg_attribute a
    where a.attrelid=relation_oid and a.attnum>0 and not a.attisdropped and a.attacl is not null) then
    raise exception 'OWNER_AUTH_COLUMN_ACL_FORBIDDEN';
  end if;
end $$;

revoke all privileges on function public.guard_owner_auth_operation_identity() from public, anon, authenticated;

commit;