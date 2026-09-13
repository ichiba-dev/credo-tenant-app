import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { randomUUID } from "node:crypto";

const source = ts.transpileModule(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const input = {
  propertyId: "property-a", roomNumber: "101", tenantName: "Tenant",
  category: "その他", description: "Problem",
  photoPaths: ["12345678-1234-4234-8234-123456789012-photo.jpg"],
};

function setup(failAt, uploadFailAt) {
  const queries = [];
  const uploads = [];
  const responses = [
    { id: "property-a", name: "Trusted property", organization_id: "org-a" },
    { id: 123 },
    { id: 123, organization_id: "org-a" },
    null,
    { id: 123 },
  ];
  const db = {
    from(table) {
      const index = queries.length;
      const query = { table, filters: [] };
      queries.push(query);
      const builder = {
        select() { return builder; },
        eq(key, value) { query.filters.push([key, value]); return builder; },
        insert(value) { query.insert = value; return builder; },
        update(value) { query.update = value; return builder; },
        single() { return builder; },
        maybeSingle() { return builder; },
        then(resolve, reject) {
          return Promise.resolve(index === failAt
            ? { data: null, error: { message: "SECRET_DO_NOT_EXPOSE" } }
            : { data: responses[index], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    storage: { from: (bucket) => ({ upload: async (path, file, options) => {
      assert.equal(bucket, "repair-images");
      assert.ok(queries[1].insert);
      uploads.push({ path, file, options });
      return uploads.length - 1 === uploadFailAt ? { data: null, error: { message: "SECRET_DO_NOT_EXPOSE" } } : { data: { path }, error: null };
    }, getPublicUrl: (path) => ({ data: { publicUrl: `https://storage.example/repair-images/${path}` } }) }) },
  };
  const exports = {};
  const logs = [];
  vm.runInNewContext(source, {
    exports, FormData, Uint8Array,
    require: (name) => {
      if (name === "server-only") return {};
      if (name === "node:crypto") return { randomUUID };
      if (name === "./upload-limits") return { MAX_PHOTOS: 20, MAX_PHOTO_BYTES: 5*1024*1024, MAX_TOTAL_PHOTO_BYTES: 20*1024*1024, PHOTO_TYPES: ["image/jpeg", "image/png"] };
      assert.equal(name, "@/lib/supabase-server");
      return { createServerSupabaseClient: () => db };
    },
    console: { error: (...args) => logs.push(args) },
  });
  return { submit: exports.submitRepair, queries, logs, uploads };
}


const jpeg = () => new File([new Uint8Array([255,216,255,224,0,0,0,0])], "../../evil.png", { type: "image/jpeg" });
function form(files = [jpeg()]) {
  const data = new FormData();
  for (const [key, value] of Object.entries(input)) if (key !== "photoPaths") data.append(key, value);
  for (const file of files) data.append("photos", file);
  return data;
}

test("server generates scoped paths after creating a request and preserves URLs/order", async () => {
  const s = setup();
  assert.equal((await s.submit(form(Array.from({length:20}, jpeg)))).ok, true);
  assert.equal(s.uploads.length, 20);
  assert.equal(new Set(s.uploads.map(u => u.path)).size, 20);
  for (const [i, upload] of s.uploads.entries()) {
    assert.match(upload.path, /^org-a\/123\/[0-9a-f-]{36}\.jpg$/);
    assert.equal(upload.options.upsert, false);
    assert.equal(upload.options.contentType, "image/jpeg");
    assert.equal(s.queries[3].insert[i].storage_path, upload.path);
    assert.equal(s.queries[3].insert[i].sort_order, i + 1);
    assert.equal(s.queries[3].insert[i].organization_id, "org-a");
    assert.equal(s.queries[3].insert[i].photo_url, "https://storage.example/repair-images/" + upload.path);
  }
  assert.equal(s.queries[4].update.storage_path, s.uploads[0].path);
  assert.equal(s.queries[4].update.photo_url, s.queries[3].insert[0].photo_url);
});

test("zero photos creates only request; PNG uses png extension", async () => {
  const s = setup();
  assert.equal((await s.submit(form([]))).ok, true);
  assert.equal(s.queries.length, 2);
  assert.equal(s.uploads.length, 0);
  assert.equal(s.queries[1].insert.storage_path, null);
  const png = new File([new Uint8Array([137,80,78,71,13,10,26,10])], "fake.jpg", { type: "image/png" });
  const p = setup();
  assert.equal((await p.submit(form([png]))).ok, true);
  assert.ok(p.uploads[0].path.endsWith(".png"));
});

test("verified tenant is linked only when the property organization matches", async () => {
  const linked = setup();
  const result = await linked.submit(form([]), { kind: "tenant", tenantId: "tenant-a", organizationId: "org-a" });
  assert.equal(result.ok, true); assert.equal(result.tenantLinked, true);
  assert.equal(linked.queries[1].insert.tenant_account_id, "tenant-a");

  const anonymous = setup(); await anonymous.submit(form([]), { kind: "anonymous" });
  assert.equal(anonymous.queries[1].insert.tenant_account_id, null);

  const foreign = setup();
  const rejected = await foreign.submit(form([]), { kind: "tenant", tenantId: "forged", organizationId: "org-b" });
  assert.equal(rejected.ok, false); assert.equal(foreign.queries.length, 1);
});

test("invalid count, MIME, signature, empty/oversize files and aggregate size fail before DB", async () => {
  const oversized = new File([new Uint8Array(5*1024*1024+1)], "x.jpg", {type:"image/jpeg"});
  const bigBytes = new Uint8Array(5*1024*1024); bigBytes.set([255,216,255]);
  const big = new File([bigBytes], "x.jpg", {type:"image/jpeg"});
  for (const files of [Array.from({length:21}, jpeg), [new File([], "x.jpg", {type:"image/jpeg"})],
    [new File(["bad"], "x.jpg", {type:"image/jpeg"})], [new File(["<svg/>"], "x.svg", {type:"image/svg+xml"})],
    [oversized], Array(5).fill(big)]) {
    const s = setup(); const result = await s.submit(form(files));
    assert.equal(result.ok, false); assert.equal(result.retrySafe, true); assert.equal(s.queries.length,0);
  }
});

test("old path inputs and client-selected company/request are rejected", async () => {
  for (const key of ["photoPaths", "organization_id", "repairId", "storage_path", "photo_url"]) {
    const s = setup(); const data = form(); data.append(key,"untrusted");
    assert.equal((await s.submit(data)).ok,false); assert.equal(s.queries.length,0);
  }
  const s=setup(); assert.equal((await s.submit(input)).ok,false);
});

for (const [index, stage] of ["property", "request_insert", "request_lookup", "photos_insert", "fallback_update"].entries()) {
  test("failure at " + stage + " is safe and stops later writes", async () => {
    const s=setup(index); const result=await s.submit(form());
    assert.equal(result.ok,false); assert.equal(result.stage,stage);
    assert.equal(result.requestCreated,index>=2); assert.equal(result.retrySafe,index===0);
    assert.equal(s.queries.length,index+1);
    assert.equal(JSON.stringify([result,s.logs]).includes("SECRET_DO_NOT_EXPOSE"),false);
  });
}

test("second upload failure reports partial creation and does not insert photo rows", async () => {
  const s=setup(undefined,1); const result=await s.submit(form([jpeg(),jpeg(),jpeg()]));
  assert.equal(result.ok,false); assert.equal(result.stage,"storage_upload");
  assert.equal(result.requestCreated,true); assert.equal(result.retrySafe,false);
  assert.equal(s.uploads.length,2); assert.equal(s.queries.length,3);
  assert.equal(s.logs[0][1].uploadedCount,1); assert.equal(s.logs[0][1].requestId,123);
  assert.equal(JSON.stringify([result,s.logs]).includes("SECRET_DO_NOT_EXPOSE"),false);
});
