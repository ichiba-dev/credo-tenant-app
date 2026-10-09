// Isolated in-memory PostgreSQL fixture. No environment variables, network, or persistent database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const pgliteUrl = pathToFileURL(join(tmpdir(), "owner-auth-phase1-sql-test/node_modules/@electric-sql/pglite/dist/index.js"));
const { PGlite } = await import(pgliteUrl.href);
const migration = readFileSync(new URL("../owner-auth-phase1.migration.sql", import.meta.url), "utf8");
const preflight = readFileSync(new URL("../owner-auth-phase1.production-preflight.readonly.sql", import.meta.url), "utf8");
const postcheck = readFileSync(new URL("../owner-auth-phase1.production-postcheck.readonly.sql", import.meta.url), "utf8");
const db = new PGlite();
const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "99999999-9999-4999-8999-999999999999";
const owner = "22222222-2222-4222-8222-222222222222";
const otherOwner = "55555555-5555-4555-8555-555555555555";
const actor = "33333333-3333-4333-8333-333333333333";
const request = "44444444-4444-4444-8444-444444444444";

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table organizations(id uuid primary key);
    create table owners(id uuid primary key, organization_id uuid not null references organizations(id), auth_user_id uuid,
      name text not null, is_active boolean not null default true, constraint owner_repair_owner_org_key unique(organization_id,id));
    create table organization_members(organization_id uuid,auth_user_id uuid,role text,is_active boolean);
    create table properties(id uuid primary key,organization_id uuid not null references organizations(id),name text not null,is_active boolean not null,
      constraint owner_repair_property_org_key unique(organization_id,id));
    create table property_owners(organization_id uuid,owner_id uuid,property_id uuid,is_active boolean,valid_from date,valid_to date);
    create table repair_requests(id bigint primary key);
    create table repair_photos(id bigint primary key);
    alter table repair_requests enable row level security;
    alter table repair_photos enable row level security;
    create function public.guard_repair_provenance() returns trigger language plpgsql as $$begin return new;end$$;
    create trigger guard_repair_provenance before insert or update on repair_requests for each row execute function public.guard_repair_provenance();
    create function public.create_owner_repair(uuid,text,text,text,text,text) returns bigint language sql as $$select 1::bigint$$;
    insert into organizations values ('${org}'),('${otherOrg}');
    insert into owners(id,organization_id,auth_user_id,name,is_active) values ('${owner}','${org}',null,'Fixture Owner',true);
    alter default privileges in schema public grant all on tables to service_role with grant option;
    create table public.owner_auth_default_acl_probe(id uuid);`);

  const defaultAcl = await db.query(`select
    has_table_privilege('service_role','public.owner_auth_default_acl_probe','SELECT') and
    has_table_privilege('service_role','public.owner_auth_default_acl_probe','INSERT') and
    has_table_privilege('service_role','public.owner_auth_default_acl_probe','UPDATE') and
    has_table_privilege('service_role','public.owner_auth_default_acl_probe','DELETE') and
    has_table_privilege('service_role','public.owner_auth_default_acl_probe','TRUNCATE') and
    has_table_privilege('service_role','public.owner_auth_default_acl_probe','REFERENCES') and
    has_table_privilege('service_role','public.owner_auth_default_acl_probe','TRIGGER') all_table_privileges,
    has_table_privilege('service_role','public.owner_auth_default_acl_probe','DELETE WITH GRANT OPTION') delete_grant_option`);
  assert.deepEqual({ ...defaultAcl.rows[0] }, { all_table_privileges: true, delete_grant_option: true });
  await db.exec("drop table public.owner_auth_default_acl_probe");

  await db.exec("begin read only");
  let preflightResult;
  try {
    preflightResult = await db.exec(preflight);
  } catch (error) {
    const position = Number(error.position ?? 0);
    console.error("Preflight SQL failed near:", preflight.slice(Math.max(0, position - 100), position + 100));
    throw error;
  }
  assert.equal(preflightResult.length, 1);
  assert.equal(preflightResult[0].rows.length, 6);
  assert.deepEqual(preflightResult[0].rows.map((row) => row.section), [
    "required_schema", "owners_email", "planned_object_collisions", "organization_keys", "owner_repair_phase1_preserved", "overall",
  ]);
  assert.equal(preflightResult[0].rows.find((row) => row.section === "overall").all_match, true);
  assert.equal(preflightResult[0].rows.find((row) => row.section === "owners_email").details.exists, false);
  await db.exec("rollback");

  assert.doesNotMatch(preflight, /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);
  assert.equal((preflight.match(/;\s*$/gm) ?? []).length, 1);
  async function expectPreflightSectionFalse(change, section, detailKey = null) {
    await db.exec("begin");
    try {
      await db.exec(change);
      const result = await db.exec(preflight);
      const failed = result[0].rows.find((row) => row.section === section);
      assert.equal(failed.all_match, false, section);
      if (detailKey) assert.equal(failed.details[detailKey], true, detailKey);
      assert.equal(result[0].rows.find((row) => row.section === "overall").all_match, false, section);
    } finally {
      await db.exec("rollback");
    }
  }
  await expectPreflightSectionFalse("drop table organization_members", "required_schema");
  await expectPreflightSectionFalse("alter table owners add column email integer", "owners_email");
  await expectPreflightSectionFalse("create table public.owner_auth_operations(id uuid)", "planned_object_collisions", "owner_auth_operations_table");
  await expectPreflightSectionFalse(`create table public.fixture_index_collision(id integer);
    create index owner_auth_operations_org_owner_created_idx on public.fixture_index_collision(id)`, "planned_object_collisions", "planned_index");
  await expectPreflightSectionFalse(`create function public.guard_owner_auth_operation_identity() returns integer
    language sql immutable as $$select 1$$`, "planned_object_collisions", "planned_function_name");
  await expectPreflightSectionFalse(`create table public.owner_auth_operations(id uuid);
    create function public.fixture_owner_auth_trigger() returns trigger language plpgsql as $$begin return new;end$$;
    create trigger owner_auth_operations_guard_identity before insert on public.owner_auth_operations
      for each row execute function public.fixture_owner_auth_trigger()`, "planned_object_collisions", "planned_trigger");
  await expectPreflightSectionFalse("alter table owners drop constraint owner_repair_owner_org_key", "organization_keys");

  await db.exec(migration);
  const emailColumn = await db.query(`select is_nullable, data_type from information_schema.columns
    where table_schema='public' and table_name='owners' and column_name='email'`);
  assert.equal(emailColumn.rows[0].is_nullable, "YES");
  assert.equal(emailColumn.rows[0].data_type, "text");
  await db.exec(`insert into owners(id,organization_id,name,is_active) values ('${otherOwner}','${otherOrg}','Other Org Owner',true);`);
  await assert.rejects(db.exec(`insert into owner_auth_operations(organization_id,owner_id,request_id,operation_type,requested_email,
    status,actor_auth_user_id) values ('${org}','${otherOwner}','${request}','invite','fixture@example.com','started','${actor}');`));

  await db.exec(`insert into owner_auth_operations(organization_id,owner_id,request_id,operation_type,requested_email,
    previous_auth_user_id,target_auth_user_id,status,actor_auth_user_id)
    values ('${org}','${owner}','${request}','invite','fixture@example.com',null,null,'started','${actor}');`);
  await assert.rejects(db.exec(`insert into owner_auth_operations(organization_id,owner_id,request_id,operation_type,requested_email,
    status,actor_auth_user_id) values ('${org}','${owner}','${request}','invite','fixture@example.com','started','${actor}');`));
  await assert.rejects(db.exec(`update owner_auth_operations set operation_type='correct_link' where request_id='${request}';`));
  await assert.rejects(db.exec(`delete from owner_auth_operations where request_id='${request}';`));
  await db.exec(`update owner_auth_operations set target_auth_user_id='${actor}',status='auth_created_db_pending' where request_id='${request}';`);
  await assert.rejects(db.exec(`update owner_auth_operations set target_auth_user_id='${owner}' where request_id='${request}';`));
  await db.exec(`
    update owner_auth_operations set status='completed',completed_at=now() where request_id='${request}';`);
  await db.exec("begin read only");
  const postcheckResult = await db.exec(postcheck);
  assert.equal(postcheckResult.length, 1);
  const sections = postcheckResult[0].rows;
  assert.ok(sections.filter((row) => row.section !== "overall").every((row) => row.all_match));
  assert.equal(sections.find((row) => row.section === "overall").all_match, true);
  await db.exec("rollback");

  const acl = await db.query(`select
    has_table_privilege('anon','public.owner_auth_operations','SELECT') anon_select,
    has_table_privilege('authenticated','public.owner_auth_operations','UPDATE') authenticated_update,
    has_table_privilege('service_role','public.owner_auth_operations','SELECT') service_select,
    has_table_privilege('service_role','public.owner_auth_operations','UPDATE') service_update`);
  assert.deepEqual({ ...acl.rows[0] }, {
    anon_select: false, authenticated_update: false, service_select: true, service_update: true,
  });
  const aclContract = await db.query(`select
    has_table_privilege('service_role','public.owner_auth_operations','SELECT') service_select,
    has_table_privilege('service_role','public.owner_auth_operations','INSERT') service_insert,
    has_table_privilege('service_role','public.owner_auth_operations','UPDATE') service_update,
    has_table_privilege('service_role','public.owner_auth_operations','DELETE') service_delete,
    has_table_privilege('service_role','public.owner_auth_operations','TRUNCATE') service_truncate,
    has_table_privilege('service_role','public.owner_auth_operations','REFERENCES') service_references,
    has_table_privilege('service_role','public.owner_auth_operations','TRIGGER') service_trigger,
    has_table_privilege('service_role','public.owner_auth_operations','SELECT WITH GRANT OPTION') service_select_grant,
    has_table_privilege('service_role','public.owner_auth_operations','INSERT WITH GRANT OPTION') service_insert_grant,
    has_table_privilege('service_role','public.owner_auth_operations','UPDATE WITH GRANT OPTION') service_update_grant,
    exists(select 1 from pg_attribute where attrelid='public.owner_auth_operations'::regclass and attacl is not null) has_column_acl`);
  assert.deepEqual({ ...aclContract.rows[0] }, {
    service_select: true, service_insert: true, service_update: true,
    service_delete: false, service_truncate: false, service_references: false, service_trigger: false,
    service_select_grant: false, service_insert_grant: false, service_update_grant: false,
    has_column_acl: false,
  });
  const browserAcl = await db.query(`select role_name,
    bool_or(has_table_privilege(role_name,'public.owner_auth_operations','SELECT')) any_select,
    bool_or(has_table_privilege(role_name,'public.owner_auth_operations','INSERT')) any_insert,
    bool_or(has_table_privilege(role_name,'public.owner_auth_operations','UPDATE')) any_update,
    bool_or(has_table_privilege(role_name,'public.owner_auth_operations','DELETE')) any_delete,
    bool_or(has_table_privilege(role_name,'public.owner_auth_operations','TRUNCATE')) any_truncate,
    bool_or(has_table_privilege(role_name,'public.owner_auth_operations','REFERENCES')) any_references,
    bool_or(has_table_privilege(role_name,'public.owner_auth_operations','TRIGGER')) any_trigger
    from unnest(array['anon','authenticated']) role_name group by role_name`);
  assert.equal(browserAcl.rows.length, 2);
  for (const row of browserAcl.rows) {
    assert.deepEqual({ ...row }, { role_name: row.role_name, any_select: false, any_insert: false, any_update: false,
      any_delete: false, any_truncate: false, any_references: false, any_trigger: false });
  }

  for (const change of [
    "grant delete on public.owner_auth_operations to service_role",
    "grant update on public.owner_auth_operations to service_role with grant option",
    "grant select (requested_email) on public.owner_auth_operations to anon",
  ]) {
    await db.exec("begin");
    try {
      await db.exec(change);
      const result = await db.exec(postcheck);
      assert.equal(result[0].rows.find((row) => row.section === "service_role_only").all_match, false, change);
      assert.equal(result[0].rows.find((row) => row.section === "overall").all_match, false, change);
    } finally {
      await db.exec("rollback");
    }
  }

  const rollbackDb = new PGlite();
  try {
    await rollbackDb.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create role service_role_extra;
      grant service_role_extra to service_role;
      create table organizations(id uuid primary key);
      create table owners(id uuid primary key,organization_id uuid not null references organizations(id),name text not null,is_active boolean not null,
        unique(organization_id,id));
      alter default privileges in schema public grant all on tables to service_role_extra;
      insert into organizations values ('${org}');
      insert into owners values ('${owner}','${org}','Rollback Owner',true);`);
    let migrationFailed = false;
    try {
      await rollbackDb.exec(migration);
    } catch (error) {
      migrationFailed = /OWNER_AUTH_SERVICE_ROLE_ACL_INVALID/.test(error.message);
      await rollbackDb.exec("rollback");
    }
    assert.equal(migrationFailed, true, "inherited excess ACL must abort migration");
    assert.equal((await rollbackDb.query("select to_regclass('public.owner_auth_operations') relation")).rows[0].relation, null);
    assert.equal((await rollbackDb.query(`select count(*)::int count from pg_attribute
      where attrelid='public.owners'::regclass and attname='email' and not attisdropped`)).rows[0].count, 0);
  } finally {
    await rollbackDb.close();
  }

  console.log("PASS: default ALL+GRANT OPTION revoked to service_role SELECT/INSERT/UPDATE only; ACL violations fail postcheck; inherited ACL abort rolls back migration");
} finally {
  await db.close();
}