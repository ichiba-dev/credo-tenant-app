// LOCAL TEST ONLY: verifies the real migration against isolated temporary databases.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const container='supabase_db_credo-tenant-app';
const migration=readFileSync(new URL('../vendor-master-ui.migration.sql',import.meta.url),'utf8');
const baseline=`
create table public.organizations(id uuid primary key);
create table public.organization_members(
  organization_id uuid not null references public.organizations(id),
  auth_user_id uuid not null,is_active boolean not null,role text not null,
  primary key(organization_id,auth_user_id));
create table public.repair_vendors(
  id uuid primary key,organization_id uuid not null references public.organizations(id),
  company_name text not null,contact_name text not null,phone text,email text,
  is_active boolean not null default true,created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint repair_vendors_org_id_unique unique(organization_id,id));
create table public.repair_vendor_categories(
  organization_id uuid not null,vendor_id uuid not null,category text not null,
  primary key(organization_id,vendor_id,category),
  constraint categories_vendor_fk foreign key(organization_id,vendor_id)
    references public.repair_vendors(organization_id,id));
create table public.repair_vendor_areas(
  organization_id uuid not null,vendor_id uuid not null,area_code text not null,area_label text not null,
  primary key(organization_id,vendor_id,area_code),
  constraint areas_vendor_fk foreign key(organization_id,vendor_id)
    references public.repair_vendors(organization_id,id));
create function public._vendor_master_identity_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.organization_id is distinct from old.organization_id or new.id is distinct from old.id then
    raise exception 'VENDOR_MASTER_IDENTITY_IMMUTABLE';
  end if;
  new.created_at:=old.created_at;new.updated_at:=clock_timestamp();return new;
end$$;
create trigger repair_vendors_identity_guard before update on public.repair_vendors
  for each row execute function public._vendor_master_identity_guard();
`;
const cases=[
  ['same_name_overload',`create function public.save_repair_vendor_master() returns void language sql as 'select';`,
    'Vendor master UI objects already exist'],
  ['pkey_relation_collision',`create index vendor_master_requests_pkey on public.repair_vendors(id);`,
    'Vendor master UI objects already exist'],
  ['updated_at_type_mismatch',`alter table public.repair_vendors alter column updated_at drop default;
    alter table public.repair_vendors alter column updated_at type timestamp without time zone
      using updated_at at time zone 'UTC';`, 'repair_vendors column contract mismatch'],
  ['missing_org_id_unique',`alter table public.repair_vendor_categories drop constraint categories_vendor_fk;
    alter table public.repair_vendor_areas drop constraint areas_vendor_fk;
    alter table public.repair_vendors drop constraint repair_vendors_org_id_unique;`,
    'repair_vendors key contract mismatch'],
  ['missing_identity_trigger',`drop trigger repair_vendors_identity_guard on public.repair_vendors;`,
    'repair_vendors identity guard contract mismatch'],
];
function docker(args,input){return spawnSync('docker',['exec','-i',container,...args],{
  input,encoding:'utf8',maxBuffer:10*1024*1024});}
function admin(sql){return execFileSync('docker',['exec',container,'psql','-U','postgres','-d','postgres',
  '-v','ON_ERROR_STOP=1','-Atc',sql],{encoding:'utf8'}).trim();}
let passed=0;
for(let i=0;i<=cases.length;i++){
  const name=i===cases.length?'valid_schema':cases[i][0];
  const db=`vendor_master_guard_${i}`;
  try{
    admin(`drop database if exists ${db} with (force);`);
    admin(`create database ${db} template template0;`);
    const setup=docker(['psql','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],baseline+(i<cases.length?cases[i][1]:''));
    if(setup.status!==0)throw new Error(`${name} setup failed: ${setup.stderr}`);
    const result=docker(['psql','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],migration);
    if(i===cases.length){
      if(result.status!==0)throw new Error(`valid migration failed: ${result.stderr}`);
    }else{
      if(result.status===0)throw new Error(`${name} migration unexpectedly succeeded`);
      if(!`${result.stdout}\n${result.stderr}`.includes(cases[i][2]))
        throw new Error(`${name} failed for the wrong reason: ${result.stderr}`);
    }
    passed++;process.stdout.write(`PASS ${name}\n`);
  }finally{
    admin(`drop database if exists ${db} with (force);`);
  }
}
process.stdout.write(`RESULT ${passed}/${cases.length+1}\n`);
