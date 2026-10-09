import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "99999999-9999-4999-8999-999999999999";
const ownerId = "22222222-2222-4222-8222-222222222222";
const currentAuthId = "44444444-4444-4444-8444-444444444444";
const matchingAuthId = "55555555-5555-4555-8555-555555555555";

function load(path, imports) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === "server-only") return {};
    if (name in imports) return imports[name];
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports;
}

test("owner list detects email mismatch and scopes property display to verified organization", async () => {
  const queries = [];
  const tables = {
    organization_members: [{ auth_user_id: currentAuthId, organization_id: org, role: "admin", is_active: true }],
    owners: [{ id: ownerId, organization_id: org, name: "テストオーナー", email: "test-owner@example.com",
      is_active: true, auth_user_id: currentAuthId }],
    owner_auth_operations: [],
    property_owners: [
      { owner_id: ownerId, property_id: "property-a", organization_id: org, is_active: true, valid_from: null, valid_to: null },
      { owner_id: ownerId, property_id: "property-b", organization_id: otherOrg, is_active: true, valid_from: null, valid_to: null },
    ],
    properties: [{ id: "property-a", name: "対象物件", organization_id: org, is_active: true }],
  };
  const service = {
    from(table) {
      const query = { table, filters: [] };
      queries.push(query);
      const builder = {
        select() { return builder; },
        eq(...args) { query.filters.push(["eq", ...args]); return builder; },
        in(...args) { query.filters.push(["in", ...args]); return builder; },
        order() { return builder; },
        maybeSingle() { return Promise.resolve({ data: tables[table]?.[0] ?? null, error: null }); },
        then(resolve, reject) {
          const data = (tables[table] ?? []).filter((row) => query.filters.every(([kind, key, value]) =>
            kind === "eq" ? row[key] === value : kind === "in" ? value.includes(row[key]) : true));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    auth: { admin: { async listUsers() { return { data: { users: [
      { id: currentAuthId, email: "ichiba@credoweb.co.jp" },
      { id: matchingAuthId, email: "TEST-OWNER@example.com" },
    ] }, error: null }; } } },
  };
  const staff = { ok: true, organizationId: org, userId: currentAuthId,
    supabase: { from: service.from.bind(service) } };
  const data = load("./data.ts", {
    "@/lib/supabase-auth/staff": { getStaffContext: async () => staff },
    "@/lib/supabase-server": { createServerSupabaseClient: () => service },
    "@/lib/owner-auth-state": load("../../../lib/owner-auth-state.ts", {}),
  });
  const result = await data.getOwnerAuthAdminPage();
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].name, "テストオーナー");
  assert.equal(result.rows[0].email, "test-owner@example.com");
  assert.equal(result.rows[0].auth_email, "ichiba@credoweb.co.jp");
  assert.equal(result.rows[0].status, "email_mismatch");
  assert.deepEqual(JSON.parse(JSON.stringify(result.rows[0].properties)), ["対象物件"]);
  assert.equal(result.rows[0].candidate_auth.id, matchingAuthId);
  for (const query of queries.filter((item) => ["owner_auth_operations", "property_owners", "properties"].includes(item.table))) {
    assert.ok(query.filters.some(([kind, key, value]) => kind === "eq" && key === "organization_id" && value === org), query.table);
  }
  assert.ok(queries.some((query) => query.table === "owners" && query.filters.some(([kind, key, value]) =>
    kind === "eq" && key === "organization_id" && value === org)));
});

test("owner list is unavailable to staff and viewer", async () => {
  for (const role of ["staff", "viewer"]) {
    const data = load("./data.ts", {
      "@/lib/supabase-auth/staff": { getStaffContext: async () => ({ ok: true, organizationId: org, userId: currentAuthId,
        supabase: { from: () => ({ select() { return this; }, eq() { return this; }, in() { return this; }, maybeSingle: async () => ({ data: null, error: null }) }) } }) },
      "@/lib/supabase-server": { createServerSupabaseClient: () => { throw new Error("service role must not be initialized"); } },
      "@/lib/owner-auth-state": load("../../../lib/owner-auth-state.ts", {}),
    });
    assert.equal((await data.getOwnerAuthAdminPage()).ok, false, role);
  }
});