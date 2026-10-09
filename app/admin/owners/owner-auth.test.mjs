import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "99999999-9999-4999-8999-999999999999";
const ownerId = "22222222-2222-4222-8222-222222222222";
const ownerOtherId = "33333333-3333-4333-8333-333333333333";
const currentAuthId = "44444444-4444-4444-8444-444444444444";
const targetAuthId = "55555555-5555-4555-8555-555555555555";
const requestId = "66666666-6666-4666-8666-666666666666";
const email = "test-owner@example.com";

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

function setup({ role = "admin", ownerEmail = email, ownerAuthId = null, ownerOrg = orgA,
  otherOwners = [], users = [], failOwnerUpdate = false, failOperationCompletion = false } = {}) {
  const owner = { id: ownerId, organization_id: ownerOrg, name: "テストオーナー", email: ownerEmail,
    is_active: true, auth_user_id: ownerAuthId };
  const owners = [owner, ...otherOwners];
  const operations = [];
  const calls = { invite: 0, updates: 0, deletedAuth: 0 };
  let shouldFailOwnerUpdate = failOwnerUpdate;
  let shouldFailOperationCompletion = failOperationCompletion;

  function matches(row, filters) {
    return filters.every(([kind, key, value]) => kind === "eq" ? row[key] === value
      : kind === "is" ? row[key] === value : kind === "in" ? value.includes(row[key]) : true);
  }
  function queryFor(table) {
    const query = { table, filters: [], action: "select", payload: null };
    const builder = {
      select() { return builder; },
      eq(key, value) { query.filters.push(["eq", key, value]); return builder; },
      is(key, value) { query.filters.push(["is", key, value]); return builder; },
      in(key, value) { query.filters.push(["in", key, value]); return builder; },
      order() { return builder; },
      update(payload) { query.action = "update"; query.payload = payload; return builder; },
      insert(payload) { query.action = "insert"; query.payload = payload; return builder; },
      maybeSingle() { return execute(true); },
      then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); },
    };
    function execute(single) {
      const rows = table === "owners" ? owners : table === "owner_auth_operations" ? operations
        : table === "organization_members" ? [{ auth_user_id: currentAuthId, organization_id: orgA, is_active: true, role }] : [];
      if (query.action === "insert") {
        const incoming = Array.isArray(query.payload) ? query.payload : [query.payload];
        if (table === "owner_auth_operations" && incoming.some((row) => operations.some((item) => item.request_id === row.request_id))) {
          return { data: null, error: { message: "duplicate request_id" } };
        }
        rows.push(...incoming.map((row) => ({ ...row })));
        return { data: incoming, error: null };
      }
      const found = rows.filter((row) => matches(row, query.filters));
      if (query.action === "update") {
        if (table === "owners") calls.updates++;
        if (table === "owner_auth_operations" && query.payload.status === "completed" && shouldFailOperationCompletion) {
          shouldFailOperationCompletion = false;
          return { data: null, error: { message: "simulated audit completion failure" } };
        }
        if (table === "owners" && shouldFailOwnerUpdate) {
          shouldFailOwnerUpdate = false;
          return { data: null, error: { message: "simulated DB failure" } };
        }
        for (const row of found) Object.assign(row, query.payload);
      }
      return { data: single ? found[0] ?? null : found, error: null };
    }
    return builder;
  }

  const staff = { ok: true, organizationId: orgA, userId: currentAuthId,
    supabase: { from: (table) => queryFor(table) } };
  const authUsers = users.map((user) => ({ ...user }));
  const service = {
    from: queryFor,
    auth: { admin: {
      async listUsers({ page, perPage }) {
        const start = (page - 1) * perPage;
        return { data: { users: authUsers.slice(start, start + perPage) }, error: null };
      },
      async getUserById(id) { return { data: { user: authUsers.find((user) => user.id === id) ?? null }, error: null }; },
      async inviteUserByEmail(inviteEmail) {
        calls.invite++;
        const user = { id: targetAuthId, email: inviteEmail };
        authUsers.push(user);
        return { data: { user }, error: null };
      },
      async deleteUser() { calls.deletedAuth++; return { error: null }; },
    } },
  };
  const actions = load("./actions.ts", {
    "@/lib/supabase-auth/staff": { getStaffContext: async () => staff },
    "@/lib/supabase-server": { createServerSupabaseClient: () => service },
    "@/lib/owner-auth-state": { normalizeOwnerAuthEmail: (value) => value?.trim().toLowerCase() || null },
    "next/cache": { revalidatePath() {} },
  });
  return { ...actions, owner, owners, operations, calls, authUsers };
}

test("admin and manager can link an existing unique Auth user; invite is not needed", async () => {
  for (const role of ["admin", "manager"]) {
    const s = setup({ role, users: [{ id: targetAuthId, email }] });
    const result = await s.linkOrInviteOwner({ intent: "link_or_invite", ownerId, requestId });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true, status: "linked" });
    assert.equal(s.owner.auth_user_id, targetAuthId);
    assert.equal(s.calls.invite, 0);
    assert.equal(s.operations[0].status, "completed");
  }
});

test("unlinked owner with no Auth user is invited and audited", async () => {
  const s = setup();
  const result = await s.linkOrInviteOwner({ intent: "link_or_invite", ownerId, requestId });
  assert.equal(result.ok, true);
  assert.equal(s.calls.invite, 1);
  assert.equal(s.owner.auth_user_id, targetAuthId);
  assert.equal(s.operations[0].operation_type, "invite");
  assert.ok(s.operations[0].completed_at);
});

test("staff and viewer are rejected before Auth or owner mutation", async () => {
  for (const role of ["staff", "viewer"]) {
    const s = setup({ role });
    const result = await s.linkOrInviteOwner({ intent: "link_or_invite", ownerId, requestId });
    assert.equal(result.ok, false);
    assert.equal(s.calls.invite, 0);
    assert.equal(s.operations.length, 0);
    assert.equal(s.owner.auth_user_id, null);
  }
});

test("email, organization, duplicate Auth and cross-owner Auth reuse fail closed", async () => {
  const blank = setup({ ownerEmail: " " });
  assert.equal((await blank.linkOrInviteOwner({ intent: "link_or_invite", ownerId, requestId })).ok, false);
  const foreign = setup({ ownerOrg: orgB });
  assert.equal((await foreign.linkOrInviteOwner({ intent: "link_or_invite", ownerId, requestId })).ok, false);
  const duplicateOwner = setup({ otherOwners: [{ id: ownerOtherId, organization_id: orgA, email }] });
  assert.equal((await duplicateOwner.linkOrInviteOwner({ intent: "link_or_invite", ownerId, requestId })).ok, false);
  const duplicateAuth = setup({ users: [{ id: targetAuthId, email }, { id: currentAuthId, email }] });
  assert.equal((await duplicateAuth.linkOrInviteOwner({ intent: "link_or_invite", ownerId, requestId })).ok, false);
  const usedElsewhere = setup({ users: [{ id: targetAuthId, email }],
    otherOwners: [{ id: ownerOtherId, organization_id: orgB, email: "other@example.com", auth_user_id: targetAuthId }] });
  assert.equal((await usedElsewhere.linkOrInviteOwner({ intent: "link_or_invite", ownerId, requestId })).ok, false);
  assert.equal(usedElsewhere.calls.invite, 0);
});

test("existing owner Auth link is never automatically overwritten", async () => {
  const s = setup({ ownerAuthId: currentAuthId });
  const result = await s.linkOrInviteOwner({ intent: "link_or_invite", ownerId, requestId, targetAuthUserId: targetAuthId });
  assert.equal(result.ok, false);
  assert.equal(s.owner.auth_user_id, currentAuthId);
  assert.equal(s.calls.invite, 0);
});

test("correction requires explicit confirmation and compare-and-set of displayed Auth ID", async () => {
  const s = setup({ ownerAuthId: currentAuthId, users: [
    { id: currentAuthId, email: "ichiba@credoweb.co.jp" }, { id: targetAuthId, email },
  ] });
  const input = { intent: "correct_link", ownerId, requestId, expectedAuthUserId: currentAuthId, targetAuthUserId: targetAuthId };
  assert.equal((await s.correctOwnerAuthLink(input)).ok, false);
  assert.equal((await s.correctOwnerAuthLink({ ...input, confirmed: true, expectedAuthUserId: ownerOtherId })).ok, false);
  assert.equal(s.owner.auth_user_id, currentAuthId);
  assert.deepEqual(JSON.parse(JSON.stringify(await s.correctOwnerAuthLink({ ...input, confirmed: true }))),
    { ok: true, status: "corrected" });
  assert.deepEqual(JSON.parse(JSON.stringify(await s.correctOwnerAuthLink({ ...input, confirmed: true }))),
    { ok: true, status: "already_completed" });
  assert.equal(s.owner.auth_user_id, targetAuthId);
  assert.equal(s.calls.deletedAuth, 0);
});

test("request_id retry is idempotent and DB failure retries only the known Auth ID", async () => {
  const s = setup({ failOwnerUpdate: true });
  const input = { intent: "link_or_invite", ownerId, requestId };
  assert.equal((await s.linkOrInviteOwner(input)).ok, false);
  assert.equal(s.operations[0].status, "needs_review");
  assert.equal(s.operations[0].target_auth_user_id, targetAuthId);
  assert.equal(s.calls.invite, 1);
  assert.equal((await s.retryOwnerAuthOperation(requestId)).ok, true);
  assert.equal(s.owner.auth_user_id, targetAuthId);
  assert.equal(s.calls.invite, 1);
  assert.equal(s.calls.deletedAuth, 0);
  assert.equal((await s.retryOwnerAuthOperation(requestId)).ok, true);
});

test("audit completion failure retries the known target without repeating Auth or owner update", async () => {
  const s = setup({ failOperationCompletion: true });
  const input = { intent: "link_or_invite", ownerId, requestId };
  assert.equal((await s.linkOrInviteOwner(input)).ok, false);
  assert.equal(s.owner.auth_user_id, targetAuthId);
  assert.equal(s.operations[0].status, "needs_review");
  assert.equal(s.calls.invite, 1);
  assert.equal(s.calls.updates, 1);
  assert.equal((await s.retryOwnerAuthOperation(requestId)).ok, true);
  assert.equal(s.owner.auth_user_id, targetAuthId);
  assert.equal(s.calls.invite, 1);
  assert.equal(s.calls.updates, 1);
  assert.equal(s.operations[0].status, "completed");
});