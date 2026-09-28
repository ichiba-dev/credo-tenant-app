// Isolated in-memory PostgreSQL only. No production configuration or network.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const fixtureUrl=new URL('./owner-repair-preflight.local.mjs',import.meta.url);
let setup=readFileSync(fixtureUrl,'utf8').split('async function report(){')[0];
setup=setup.replace(/new URL\('([^']+)',import.meta.url\)/g,(_,path)=>`new URL(${JSON.stringify(new URL(path,fixtureUrl).href)})`);
const {db,org,actor,property}=await import('data:text/javascript;base64,'+Buffer.from(setup+'\nexport {db,org,actor,property};').toString('base64'));
const pre=readFileSync(new URL('../owner-repair-phase1.production-preflight.readonly.sql',import.meta.url),'utf8');
const post=readFileSync(new URL('../owner-repair-phase1.production-postcheck.readonly.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('../owner-repair-phase1.migration.sql',import.meta.url),'utf8');
const tables='repair_requests,repair_photos,owners,properties,property_owners';
await db.exec(`grant all on ${tables} to anon,authenticated,service_role;
grant insert (status),update (status),select (id),references (id) on repair_requests to anon,authenticated;`);
const readReport=async sql=>Object.fromEntries((await db.query(sql)).rows.map(r=>[r.section,r.result]));
const before=await readReport(pre);
assert.deepEqual(before.overall.failed_sections,['rls_acl']);
const snapshot=(await db.query('select to_jsonb(r) j from repair_requests r order by id')).rows;
const photoSnapshot=(await db.query('select to_jsonb(p) j from repair_photos p order by id')).rows;
const rawService=async()=> (await db.query(`select c.relname,a.* from pg_class c cross join lateral aclexplode(c.relacl) a
where c.oid in ('repair_requests'::regclass,'repair_photos'::regclass,'owners'::regclass,'properties'::regclass,'property_owners'::regclass)
and a.grantee=(select oid from pg_roles where rolname='service_role') order by c.relname,a.privilege_type`)).rows;
const serviceBefore=await rawService();
const policiesBefore=(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
// Failure after ACL hardening must rollback the REVOKEs together with all migration DDL.
await db.exec('create table units(id uuid)');
await assert.rejects(()=>db.exec(migration));
await db.exec('rollback');
assert.equal((await readReport(pre)).rls_acl.all_match,false);
assert.equal((await db.query("select has_table_privilege('anon','repair_requests','TRUNCATE') ok")).rows[0].ok,true);
await db.exec('drop table units');
await db.exec(migration);
assert.deepEqual(await rawService(),serviceBefore);
assert.deepEqual((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,policiesBefore);
assert.deepEqual((await db.query("select to_jsonb(r)-array['source_type','source_channel','source_owner_id','source_label','location_type','contact_notes'] j from repair_requests r order by id")).rows,snapshot);
assert.deepEqual((await db.query("select to_jsonb(p)-array['source_type','source_channel'] j from repair_photos p order by id")).rows,photoSnapshot);
await db.exec('begin read only');
const sets=await db.exec(post);assert.equal(sets.length,1);assert.equal(sets[0].rows.length,12);
await db.exec('rollback');
let result=await readReport(post);
assert.equal(result.overall.overall_ready,true,JSON.stringify(result));
assert.equal(result.repair_requests_data.details.legacy_tenant_rows,2);
assert.equal(result.repair_requests_data.details.legacy_null_rooms,1);
assert.equal((await readReport(pre)).overall.overall_ready,false,'Preflight must not be used after migration');
await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false);set role authenticated;`);
const ownerRepair=(await db.query("select create_owner_repair($1,'common_area',null,'共用部','Broken mailbox','') id",[property])).rows[0].id;
assert.equal((await db.query('select id from repair_requests')).rows.length,0,'Owner RPC does not grant direct row access');
await assert.rejects(()=>db.query('insert into repair_requests(organization_id) values($1)',[org]));
await db.exec(`reset role;insert into organization_members values('${org}','${actor}',true,'staff');set role authenticated;`);
assert.ok((await db.query('select id from repair_requests')).rows.length>=3);
assert.equal((await db.query("update repair_requests set status='staff-updated' where id=$1 returning id",[ownerRepair])).rows.length,1);
assert.equal((await db.query('select id from repair_photos')).rows.length,1);
await db.exec(`reset role;set role service_role;`);
await db.query("insert into repair_requests(organization_id,property_id,tenant_name) values($1,$2,'New tenant')",[org,property]);
await db.query("insert into repair_photos(organization_id,repair_id,source_type,source_channel,storage_path) values($1,$2,'owner','web','private/path.jpg')",[org,ownerRepair]);
await db.exec('reset role');
assert.equal((await readReport(post)).overall.overall_ready,true);
// Only newline encoding is normalized. Keep body content/whitespace checks strict.
const definitions=[...migration.replaceAll('\r\n','\n').matchAll(/create function public\.(\w+)\([\s\S]*?as \$\$[\s\S]*?\$\$;/g)];
assert.equal(definitions.length,2);
for(const newline of ['\n','\r\n']){
 await db.exec('begin');
 try{
  for(const [definition] of definitions)await db.exec(definition.replace('create function','create or replace function').replaceAll('\n',newline));
  await db.exec('set transaction read only');
  const normalized=await readReport(post);
  assert.equal(Object.values(normalized).filter(r=>r.all_match===true).length,11);
  assert.equal(normalized.overall.overall_ready,true);
 }finally{await db.exec('rollback');}
 for(const [definition,name] of definitions){
  const altered=name==='create_owner_repair'
   ? definition.replace('length(p_contact_notes)>2000','length(p_contact_notes)>2001')
   : definition.replace("new.source_type<>'tenant'","new.source_type<>'Tenant'");
  assert.notEqual(altered,definition);
  assert.equal([...altered].filter((c,i)=>c!==[...definition][i]).length,1,'exactly one processing character changed');
  await db.exec('begin');
  try{
   await db.exec(altered.replace('create function','create or replace function').replaceAll('\n',newline));
   const changed=await readReport(post);
   assert.equal(changed.installed_objects.details.functions.find(f=>f.name===name).matches,false);
   assert.equal(changed.installed_objects.all_match,false);
   assert.equal(changed.overall.overall_ready,false);
  }finally{await db.exec('rollback');}
 }
}
console.log('PASS: LF/CRLF bodies each 11/11 overall_ready=true; one processing character changed in either function rejected under both newline encodings');
let negative=0;
for(const [change,section] of [
 ['grant truncate on owners to anon;','rls_acl'],
 ['grant insert on repair_requests to authenticated;','rls_acl'],
 ['grant update on repair_photos to authenticated;','rls_acl'],
 ['grant select on properties to authenticated;','rls_acl'],
 ['grant references (id) on repair_requests to authenticated;','rls_acl'],
 ['grant select (name) on owners to anon;','rls_acl'],
 ['grant insert (status) on repair_requests to authenticated;','rls_acl'],
 ['grant update (name) on owners to authenticated;','rls_acl'],
 ['revoke delete on repair_requests from service_role;','rls_acl'],
 ['revoke update on repair_requests from authenticated;','rls_acl'],
 ['alter table properties disable row level security;','rls_acl'],
 ['alter table repair_requests disable trigger guard_repair_provenance;','installed_objects'],
 ['alter function create_owner_repair(uuid,text,text,text,text,text) security invoker;','installed_objects'],
 ['grant execute on function create_owner_repair(uuid,text,text,text,text,text) to anon;','installed_objects'],
 ["create function create_owner_repair(integer) returns bigint language sql as $$select 1::bigint$$;",'create_owner_repair_overloads'],
 ['alter table repair_requests drop constraint owner_repair_owner_fields_check;alter table repair_requests add constraint owner_repair_owner_fields_check check(true);','keys_and_constraints'],
 ["alter table repair_requests alter column source_channel set default 'legacy';",'schema'],
 ["update repair_requests set source_channel='other' where id=1;",'repair_requests_data'],
 ["update repair_photos set source_type='owner' where id=1;",'repair_photos_data']
]){
 await db.exec('begin');
 try{await db.exec(change);result=await readReport(post);assert.equal(result[section].all_match,false,section);assert.equal(result.overall.overall_ready,false);negative++;}
 finally{await db.exec('rollback');}
}
assert.equal((await readReport(post)).overall.overall_ready,true);
console.log(`PASS: full local migration; atomic rollback; service ACL/policies/historical rows unchanged; owner RPC/admin/tenant/service paths; post-check READ ONLY 12 rows all_match=11/11 overall_ready=true; ${negative} negative cases.`);
await db.close();
