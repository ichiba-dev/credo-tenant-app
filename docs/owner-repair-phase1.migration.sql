-- REVIEW ONLY: never apply to production before the read-only preflight is reviewed.
begin;
set local lock_timeout='10s';
lock table public.repair_requests, public.repair_photos, public.owners, public.properties, public.property_owners in access exclusive mode;

-- BEGIN owner-repair ACL hardening
-- Reviewed application contract: authenticated reads repairs/photos and updates repairs.
-- Tenant intake and owner portal reads/uploads use the server-only service client.
-- Owner creation uses SECURITY DEFINER RPC EXECUTE, not caller table INSERT.
-- Only direct anon/authenticated grants are revoked, with RESTRICT (never CASCADE).
-- PUBLIC, inherited roles, service_role, policies, sequences and Storage are untouched.
do $acl$
declare
  t text; r text; privilege text; col record; allowed boolean;
  service_before jsonb; service_after jsonb;
begin
  if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception 'ACL hardening requires reviewed RLS-bypass execution';
  end if;
  if (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) <> 3 then
    raise exception 'Missing expected application roles';
  end if;
  -- Confirmed production baseline: all seven rights are directly granted by postgres.
  -- Do not silently carry a damaged server contract into the migration.
  if not (select rolbypassrls from pg_roles where rolname='service_role') or exists(
    select 1 from unnest(array['repair_requests','repair_photos','owners','properties','property_owners']) tn
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    where not has_table_privilege('service_role','public.'||tn,p)) then
    raise exception 'service_role production baseline differs; review before applying';
  end if;
  select jsonb_agg(jsonb_build_array(tn,p,has_table_privilege('service_role','public.'||tn,p)) order by tn,p)
    into service_before
    from unnest(array['repair_requests','repair_photos','owners','properties','property_owners']) tn
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p;
  -- 1. REVOKE all direct browser table/column privileges, including grant options.
  foreach t in array array['repair_requests','repair_photos','owners','properties','property_owners'] loop
    if not pg_has_role(current_user,(select relowner from pg_class where oid=to_regclass('public.'||t)),'USAGE') then
      raise exception 'ACL hardening executor must have table-owner rights: %',t;
    end if;
    foreach r in array array['anon','authenticated'] loop
      if exists(select 1 from pg_roles where rolname=r and (rolsuper or rolbypassrls))
        or pg_has_role(r,'service_role','MEMBER')
        or pg_has_role(r,(select relowner from pg_class where oid=to_regclass('public.'||t)),'MEMBER') then
        raise exception 'Unsafe role membership/ownership: % on %',r,t;
      end if;
      execute format('revoke all privileges on table public.%I from %I restrict',t,r);
      for col in select attname from pg_attribute where attrelid=to_regclass('public.'||t)
        and attnum>0 and not attisdropped loop
        execute format('revoke all privileges (%I) on table public.%I from %I restrict',col.attname,t,r);
      end loop;
    end loop;
  end loop;
  -- 2. GRANT only the established authenticated application contract.
  grant select,update on public.repair_requests to authenticated;
  grant select on public.repair_photos to authenticated;
  -- 3. Validate effective table/column privileges; PUBLIC/inherited excess aborts.
  foreach t in array array['repair_requests','repair_photos','owners','properties','property_owners'] loop
    foreach r in array array['anon','authenticated'] loop
      foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        allowed := r='authenticated' and ((t in ('repair_requests','repair_photos') and privilege='SELECT')
          or (t='repair_requests' and privilege='UPDATE'));
        if has_table_privilege(r,'public.'||t,privilege) is distinct from allowed
          or has_table_privilege(r,'public.'||t,privilege||' WITH GRANT OPTION') then
          raise exception 'ACL contract not met (missing grant, PUBLIC/inheritance or grant option): % %.%',r,t,privilege;
        end if;
        if privilege in ('SELECT','INSERT','UPDATE','REFERENCES') and exists(
          select 1 from pg_attribute a where a.attrelid=to_regclass('public.'||t) and a.attnum>0 and not a.attisdropped
          and ((not allowed and has_column_privilege(r,a.attrelid,a.attnum,privilege))
            or has_column_privilege(r,a.attrelid,a.attnum,privilege||' WITH GRANT OPTION'))) then
          raise exception 'Unexpected effective column ACL: % %.%',r,t,privilege;
        end if;
      end loop;
    end loop;
  end loop;
  select jsonb_agg(jsonb_build_array(tn,p,has_table_privilege('service_role','public.'||tn,p)) order by tn,p)
    into service_after
    from unnest(array['repair_requests','repair_photos','owners','properties','property_owners']) tn
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p;
  if service_before is distinct from service_after then
    raise exception 'service_role effective table rights changed; review inheritance';
  end if;
end $acl$;
-- END owner-repair ACL hardening

do $$
begin
  -- No unit model has been observed. Stop if one exists rather than bypassing it.
  if to_regclass('public.units') is not null then raise exception 'Review existing unit ownership before applying'; end if;
  if exists (select 1 from pg_attribute where attrelid='public.repair_requests'::regclass
    and attname in ('tenant_account_id','room_number','tenant_name') and attnotnull) then
    raise exception 'Expected nullable tenant fields; review actual constraints';
  end if;
  if exists (select 1 from pg_attribute where attrelid='public.repair_photos'::regclass and attname='photo_url' and attnotnull) then
    raise exception 'Expected nullable photo_url for private storage paths';
  end if;
end $$;

-- Existing rows remain tenant-origin; old intake channel was not recorded.
alter table public.repair_requests
  add column source_type text not null default 'tenant',
  add column source_channel text not null default 'legacy',
  add column source_owner_id uuid,
  add column source_label text,
  add column location_type text not null default 'room',
  add column contact_notes text;
alter table public.repair_requests alter column source_channel set default 'web';
alter table public.repair_photos
  add column source_type text not null default 'tenant',
  add column source_channel text not null default 'web';

alter table public.owners add constraint owner_repair_owner_org_key unique (organization_id,id);
alter table public.properties add constraint owner_repair_property_org_key unique (organization_id,id);
alter table public.repair_requests
  add constraint owner_repair_source_owner_fk foreign key (organization_id,source_owner_id) references public.owners(organization_id,id),
  add constraint owner_repair_property_fk foreign key (organization_id,property_id) references public.properties(organization_id,id) not valid,
  add constraint owner_repair_source_text_check check (length(source_type) between 1 and 64 and length(source_channel) between 1 and 64),
  add constraint owner_repair_owner_fields_check check (source_type <> 'owner' or
    (source_owner_id is not null and property_id is not null and tenant_account_id is null and tenant_name is null
     and source_label is not null and length(source_label)>0 and location_type in ('room','common_area')
     and ((location_type='common_area' and room_number is null) or (location_type='room' and length(btrim(room_number))>0 and room_number is not null))));
alter table public.repair_requests validate constraint owner_repair_property_fk;
alter table public.repair_photos add constraint owner_repair_photo_source_check
  check (length(source_type) between 1 and 64 and length(source_channel) between 1 and 64);

-- Prevent direct owner/anon writes from forging provenance through existing policies.
-- Required staff SELECT/UPDATE remain available. The RPC runs as its migration owner.
create function public.guard_repair_provenance() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') and (
    (tg_op='INSERT' and (new.source_type<>'tenant' or new.source_owner_id is not null)) or
    (tg_op='UPDATE' and (new.source_type,new.source_channel,new.source_owner_id,new.source_label,new.location_type,new.contact_notes)
      is distinct from (old.source_type,old.source_channel,old.source_owner_id,old.source_label,old.location_type,old.contact_notes))
  ) then raise exception 'REPAIR_PROVENANCE_READ_ONLY'; end if;
  return new;
end $$;
create trigger guard_repair_provenance before insert or update on public.repair_requests
  for each row execute function public.guard_repair_provenance();

create function public.create_owner_repair(p_property uuid,p_location text,p_room text,p_category text,p_description text,p_contact_notes text)
returns bigint language plpgsql security definer set search_path='' as $$
declare
  v_owner public.owners%rowtype;
  v_property public.properties%rowtype;
  v_id bigint;
begin
  if auth.uid() is null then raise exception 'OWNER_AUTH_REQUIRED'; end if;
  select * into strict v_owner from public.owners where auth_user_id=auth.uid() and is_active for share;
  select * into strict v_property from public.properties
    where id=p_property and organization_id=v_owner.organization_id and is_active for share;
  perform 1 from public.property_owners where owner_id=v_owner.id and property_id=v_property.id
    and organization_id=v_owner.organization_id and is_active
    and (valid_from is null or valid_from <= (now() at time zone 'UTC')::date)
    and (valid_to is null or valid_to >= (now() at time zone 'UTC')::date) for share;
  if not found then raise exception 'OWNER_PROPERTY_FORBIDDEN'; end if;
  if p_location is null or p_location not in ('room','common_area')
    or (p_location='room' and (p_room is null or length(btrim(p_room))=0 or length(p_room)>100))
    or (p_location='common_area' and p_room is not null)
    or p_category is null or p_category not in ('エアコン','給湯器','キッチン','浴室','トイレ','洗面所','玄関・鍵','共用部','その他')
    or p_description is null or length(btrim(p_description)) not between 1 and 10000
    or (p_contact_notes is not null and length(p_contact_notes)>2000) then raise exception 'OWNER_INPUT_INVALID'; end if;
  insert into public.repair_requests(organization_id,property_id,property_name,room_number,tenant_name,tenant_account_id,
    category,description,status,source_type,source_channel,source_owner_id,source_label,location_type,contact_notes)
  values(v_owner.organization_id,v_property.id,v_property.name,case when p_location='room' then btrim(p_room) else null end,null,null,
    p_category,btrim(p_description),'受付','owner','web',v_owner.id,v_owner.name,p_location,nullif(btrim(p_contact_notes),'')) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_owner_repair(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.create_owner_repair(uuid,text,text,text,text,text) to authenticated;
comment on column public.repair_requests.source_type is 'Origin actor, extensible text: tenant/owner/staff/vendor/other. Independent of workflow status.';
comment on column public.repair_requests.source_channel is 'Intake channel: web/line/email/phone/manual/other; legacy means channel not recorded.';
comment on column public.repair_requests.source_owner_id is 'Submitting existing owner, scoped by organization. Not report-recipient authorization.';
commit;
