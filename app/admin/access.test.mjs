import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function moduleAt(path, imports) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: (name) => {
    if (name === "server-only") return {};
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  } });
  return exports;
}

function setup({ user = { id: "user-a" }, members = [{ organization_id: "org-a", role: "admin" }], memberError = null, responses = [], signingError = false } = {}) {
  const queries = [];
  const db = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from(table) {
      const query = { table, filters: [] };
      queries.push(query);
      const response = table === "organization_members" ? { data: members, error: memberError } : responses.shift();
      // SELECTに追加したorganization_idの通常値。明示的な他社値は上書きしない。
      if (response && Array.isArray(response.data) && table !== "organization_members") {
        response.data = response.data.map((row) => ({ organization_id: "org-a", ...row }));
      }
      const builder = {
        select(value) { query.select = value; return builder; },
        eq(...args) { query.filters.push(["eq", ...args]); return builder; },
        in(...args) { query.filters.push(["in", ...args]); return builder; },
        is(...args) { query.filters.push(["is", ...args]); return builder; },
        order() { return builder; },
        update(value) { query.update = value; return builder; },
        maybeSingle() { return builder; },
        then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
      };
      return builder;
    },
  };
  const staff = moduleAt("../../lib/supabase-auth/staff.ts", { "./server": { createAuthServerClient: async () => db } });
  const actions = moduleAt("./actions.ts", { "@/lib/supabase-auth/staff": staff, "next/cache": { revalidatePath() {} } });
  const signed = [];
  const signer = moduleAt("../../lib/repair-photo-urls.ts", { "@/lib/supabase-server": { createServerSupabaseClient: () => ({
    storage: { from: () => ({ createSignedUrl: async (path, ttl) => {
      signed.push({ path, ttl });
      if (signingError) throw new Error("SECRET");
      return { data: { signedUrl: "signed:" + path }, error: null };
    } }) },
  }) } });
  const data = moduleAt("./data.ts", { "@/lib/supabase-auth/staff": staff, "@/lib/repair-photo-urls": signer });
  const photoActions = moduleAt("./photo-actions.ts", { "@/lib/supabase-auth/staff": staff, "./data": data });
  return { ...staff, ...actions, ...data, ...photoActions, queries, signed };
}
const ok = (data) => ({ data, error: null });
const has = (query, filter) => query.filters.some((entry) => JSON.stringify(entry) === JSON.stringify(filter));

test("admin, manager and staff can read and update; viewer can read but cannot mutate", async () => {
  for (const role of ["admin", "manager", "staff", "viewer"]) {
    const s = setup({ members: [{ organization_id: "org-a", role }], responses: [ok([])] });
    const context = await s.getStaffContext();
    assert.equal(context.ok, true);
    assert.equal(context.canUpdate, role !== "viewer");
    assert.equal((await s.getAdminRepairs(context)).length, 0);
    for (const kind of ["status", "comment"]) {
      const mutation = setup({ members: [{ organization_id: "org-a", role }],
        responses: kind === "status" ? [ok({ history: null }), ok({ id: 17 })] : [ok({ id: 17 })] });
      const result = await mutation.updateRepair({ id: 17, kind, value: kind === "status" ? "完了" : "comment", role: "admin", canUpdate: true });
      assert.equal(result.ok, role !== "viewer");
      if (role === "viewer") assert.ok(mutation.queries.every((q) => q.table === "organization_members"));
    }
  }
});

test("fresh photo action reauthenticates viewer and signs only scoped DB paths", async () => {
  const path = "org-a/17/12345678-1234-4234-8234-123456789012.jpg";
  const s = setup({ members: [{ organization_id: "org-a", role: "viewer" }], responses: [
    ok([{ id: 17, storage_path: path, photo_url: "public" }]),
    ok([{ repair_id: 17, storage_path: path, photo_url: "public", sort_order: 1 }]),
  ] });
  const result = await s.refreshRepairPhotos(17);
  assert.equal(result.ok, true);
  assert.equal(result.repair.repair_photos[0].photo_url, "signed:" + path);
  assert.equal(result.repair.photo_url, null);
  assert.equal(JSON.stringify(result).includes("storage_path"), false);
  assert.equal(s.signed[0].ttl, 300);
  assert.ok(has(s.queries[1], ["eq", "id", 17]));
  assert.ok(has(s.queries[1], ["eq", "organization_id", "org-a"]));
});

test("unauthorized refresh, missing/foreign repair and foreign path never sign", async () => {
  for (const options of [{ user: null }, { members: [] }, { responses: [ok([])] },
    { responses: [ok([{ id: 17 }]), ok([{ repair_id: 17, storage_path: "org-b/17/12345678-1234-4234-8234-123456789012.jpg" }])] }]) {
    const s = setup(options);
    assert.equal((await s.refreshRepairPhotos(17)).ok, false);
    assert.equal(s.signed.length, 0);
  }
});

test("unauthenticated, inactive/no membership, membership error and multiple organizations fail closed", async () => {
  for (const options of [{ user: null }, { members: [] }, { memberError: { message: "secret" } },
    { members: [{ organization_id: "a" }, { organization_id: "b" }] }]) {
    const s = setup(options);
    assert.equal((await s.updateRepair({ id: 17, kind: "comment", value: "hello" })).ok, false);
    assert.ok(s.queries.every((q) => q.table === "organization_members"));
  }
});

test("membership is filtered by verified user, active flag and staff roles on every action", async () => {
  const s = setup({ responses: [ok({ id: 17 }), ok({ id: 17 })] });
  for (let i = 0; i < 2; i++) assert.equal((await s.updateRepair({ id: 17, kind: "comment", value: "hello" })).ok, true);
  const memberships = s.queries.filter((q) => q.table === "organization_members");
  assert.equal(memberships.length, 2);
  for (const q of memberships) {
    assert.ok(has(q, ["eq", "auth_user_id", "user-a"]));
    assert.ok(has(q, ["eq", "is_active", true]));
    assert.ok(has(q, ["in", "role", ["admin", "manager", "staff", "viewer"]]));
  }
});

test("untrusted organization and history are ignored; server history is guarded against concurrent changes", async () => {
  const s = setup({ responses: [ok({ history: "previous\n" }), ok({ id: 17 })] });
  assert.equal((await s.updateRepair({ id: 17, kind: "status", value: "完了", organization_id: "org-b", history: "forged" })).ok, true);
  for (const q of s.queries.slice(1)) {
    assert.ok(has(q, ["eq", "organization_id", "org-a"]));
    assert.ok(has(q, ["eq", "id", 17]));
  }
  const update = s.queries.at(-1);
  assert.ok(update.update.history.startsWith("previous\n"));
  assert.ok(has(update, ["eq", "history", "previous\n"]));
});

test("zero-row update, foreign/missing target and RLS denial never succeed", async () => {
  for (const kind of ["status", "comment"]) {
    for (const response of [ok(null), { data: null, error: { message: "secret" } }]) {
      const responses = kind === "status" ? [ok({ history: null }), response] : [response];
      const s = setup({ responses });
      const result = await s.updateRepair({ id: 99, kind, value: kind === "status" ? "受付" : "hello" });
      assert.equal(result.ok, false);
      assert.ok(!result.message.includes("secret"));
      assert.ok(has(s.queries.at(-1), ["eq", "organization_id", "org-a"]));
    }
  }
  const s = setup({ responses: [ok(null)] });
  assert.equal((await s.updateRepair({ id: 99, kind: "status", value: "受付" })).ok, false);
  assert.ok(s.queries.every((q) => !q.update));
});

test("invalid mutation input cannot reach repair tables", async () => {
  for (const input of [null, {}, { id: -1, kind: "comment", value: "" }, { id: 17, kind: "status", value: "invalid" },
    { id: 17, kind: "comment", value: "a".repeat(10001) }]) {
    const s = setup();
    assert.equal((await s.updateRepair(input)).ok, false);
    assert.ok(s.queries.every((q) => q.table === "organization_members"));
  }
});

test("repair and photo SELECT use the same verified organization and photos use visible repair IDs", async () => {
  const s = setup({ responses: [ok([{ id: 17, photo_url: "legacy" }]), ok([{ repair_id: 17, photo_url: "photo", sort_order: 1 }])] });
  const result = await s.getAdminRepairs(await s.getStaffContext());
  assert.equal(result[0].repair_photos[0].photo_url, "photo");
  for (const q of s.queries.slice(1)) assert.ok(has(q, ["eq", "organization_id", "org-a"]));
  assert.ok(has(s.queries.at(-1), ["in", "repair_id", [17]]));
});

test("restored short legacy paths work for list and fresh PDF retrieval without exposing DB paths", async () => {
  for (const refresh of [false, true]) {
    const s=setup({responses:[ok([{id:17,photo_url:"legacy"}]),ok([{repair_id:17,storage_path:"xxxxxxxx-xxxx.jpg",photo_url:"public",sort_order:1}])]});
    const repair=refresh ? (await s.refreshRepairPhotos(17)).repair : (await s.getAdminRepairs(await s.getStaffContext()))[0];
    assert.equal(repair.repair_photos[0].photo_url,"signed:xxxxxxxx-xxxx.jpg");
    assert.equal(repair.photos_unavailable,false);
    assert.equal(JSON.stringify(repair).includes("storage_path"),false);
    assert.ok(has(s.queries.at(-1),["eq","organization_id","org-a"]));
    assert.ok(has(s.queries.at(-1),["in","repair_id",[17]]));
  }
});

test("one malformed root path does not hide cases or valid photos, and does not use public fallback",async()=>{
  const responses=()=>[ok([{id:17,photo_url:"request-public"},{id:18}]),ok([
    {repair_id:17,storage_path:".",photo_url:"photo-public",sort_order:1},
    {repair_id:17,storage_path:"old-photo.jpg",sort_order:2},
  ])];
  const s=setup({responses:responses()});const repairs=await s.getAdminRepairs(await s.getStaffContext());
  assert.equal(repairs.length,2);assert.equal(repairs[0].photos_unavailable,true);
  assert.equal(repairs[0].photo_url,null);assert.equal(repairs[0].repair_photos.length,1);
  assert.equal(repairs[0].repair_photos[0].photo_url,"signed:old-photo.jpg");
  const pdf=setup({responses:[ok([{id:17,photo_url:"public"}]),ok([{repair_id:17,storage_path:"."}])]});
  assert.equal((await pdf.refreshRepairPhotos(17)).ok,false);
});

test("signing outage leaves list visible but cannot produce a successful PDF response",async()=>{
  const s=setup({signingError:true,responses:[ok([{id:17,storage_path:"old.jpg",photo_url:"public"}]),ok([])]});
  const [repair]=await s.getAdminRepairs(await s.getStaffContext());
  assert.equal(repair.photo_url,null);assert.equal(repair.photos_unavailable,true);
});

test("foreign company or unrelated repair DB rows fail closed before signing",async()=>{
  for(const photos of [[{repair_id:17,organization_id:"org-b",storage_path:"old.jpg"}],[{repair_id:18,storage_path:"old.jpg"}]]){
    const s=setup({responses:[ok([{id:17}]),ok(photos)]});
    await assert.rejects(s.getAdminRepairs(await s.getStaffContext()));assert.equal(s.signed.length,0);
  }
});
