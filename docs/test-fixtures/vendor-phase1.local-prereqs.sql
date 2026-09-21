-- LOCAL TEST FIXTURE ONLY. This is not a substitute for production DDL.
-- Run only against the credo-tenant-app local Supabase container.
begin;
alter table public.repair_requests
  add constraint vendor_phase1_local_repair_org_id_key unique (organization_id,id);
alter table public.organization_members drop constraint organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_check
  check (role in ('admin','manager','staff','viewer'));
create schema if not exists private;
create function private.has_org_role(target_org uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_members m
    where m.organization_id=target_org and m.auth_user_id=auth.uid()
      and m.is_active is true and m.role=any(allowed_roles));
$$;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('vendor-quotes','vendor-quotes',false,15728640,array['application/pdf']::text[]);
commit;
