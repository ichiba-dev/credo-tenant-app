import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup({ repairId = 14, user = { id: "user-a" }, owner = { id: 2, name: "Owner" }, recipients, reportAccess, organization = "org-a", photos = [{ storage_path: "path", sort_order: 1 }], estimates = [], signFails = false } = {}) {
  const queries = []; const signed = [];
  class PhotoUnavailableError extends Error {}
  if (recipients === undefined) recipients = [{ owner_report_id: 3, organization_id: organization }];
  if (reportAccess === undefined) reportAccess = { id: 3, organization_id: organization, repair_request_id: repairId };
  photos = photos.map((photo) => ({ repair_id: repairId, organization_id: organization, ...photo }));
  const responses = [owner, recipients, { id: repairId, organization_id: organization }, reportAccess, { id: 3, organization_id: organization, repair_request_id: repairId }, photos, { decision: "pending" }, estimates];
  const db = { from(table) {
    const query = { table, filters: [] }; queries.push(query);
    const data = responses.shift();
    const builder = {
      select(value) { query.select = value; return builder; }, eq(...args) { query.filters.push(args); return builder; },
      in(...args) { query.filters.push(args); return builder; }, is(...args) { query.filters.push(args); return builder; }, order() { return builder; }, limit() { return builder; },
      maybeSingle() { return builder; }, then(resolve, reject) { return Promise.resolve({ data, error: null }).then(resolve, reject); },
    }; return builder;
  } };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL("./[repairId]/page.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const imports = {
    "react/jsx-runtime": { jsx: () => null, jsxs: () => null },
    "next/link": { default: () => null },
    "next/navigation": { notFound() { throw new Error("notFound"); }, redirect() { throw new Error("redirect"); } },
    "next/server": { connection: async () => {} },
    "@/lib/supabase-auth/server": { createAuthServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }) },
    "@/lib/supabase-server": { createServerSupabaseClient: () => db },
    "@/lib/repair-id": { parseRepairId: value => /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null },
    "./approval-form": {}, "@/app/components/repair-image": {},
    "@/lib/repair-photo-urls": { PhotoUnavailableError, resolveRepairPhotoUrl: async (photo, org, id) => {
      signed.push({ photo, org, id });
      if (signFails === "authorization") throw new Error("Forbidden");
      if (signFails) throw new PhotoUnavailableError("Signing failed");
      return photo.storage_path ? "signed" : photo.photo_url || null;
    } },
  };
  vm.runInNewContext(source, { exports, require(name) { assert.ok(name in imports, name); return imports[name]; } });
  return { page: () => exports.default({ params: Promise.resolve({ repairId: String(repairId) }) }), rawPage: exports.default, queries, signed };
}

test("owner photo signing follows recipient/report authorization and company/repair filter", async () => {
  const s=setup(); await s.page();
  assert.equal(s.signed.length,1); assert.equal(s.signed[0].org,"org-a"); assert.equal(s.signed[0].id,14);
  const photoQuery=s.queries.find(q => q.table === "repair_photos");
  assert.equal(JSON.stringify(photoQuery.filters), JSON.stringify([["repair_id",14],["organization_id","org-a"]]));
  const reportQuery=s.queries.find(q=>q.table==="owner_reports"&&q.filters.some(([key])=>key==="repair_request_id"));
  assert.ok(reportQuery.filters.some(([key,value])=> key === "repair_request_id" && value === 14));
});
test("unauthenticated/non-owner/non-recipient/unauthorized report or missing company cannot sign", async () => {
  for (const options of [{user:null},{owner:null},{recipients:[]},{reportAccess:null},{organization:null}]) {
    const s=setup(options); await assert.rejects(s.page()); assert.equal(s.signed.length,0);
  }
});
test("signing failure leaves owner report and approval renderable", async () => {
  const s=setup({signFails:true}); await s.page(); assert.equal(s.signed.length,1);
});

test("a different repair ID scopes report, photos and estimates dynamically", async () => {
  const s=setup({repairId:27}); await s.page();
  assert.equal(s.signed[0].id,27);
  for(const table of ["repair_requests","owner_reports","repair_photos","owner_report_estimate_files"]){
    const queries=s.queries.filter(q=>q.table===table);
    assert.ok(queries.some(q=>q.filters.some(([key,value])=>(key==="id"||key==="repair_id"||key==="repair_request_id")&&value===27)));
  }
});

test("invalid and unsafe bigint route params are rejected before authentication queries", async () => {
  const s=setup();
  for(const repairId of ["0","-1","14x","9009009007199254740992"]){
    await assert.rejects(s.rawPage({params:Promise.resolve({repairId})}));
  }
});

test("estimate list is report, repair, organization and undeleted scoped without selecting paths", async () => {
  const s=setup({estimates:[{id:"file-a",organization_id:"org-a",repair_request_id:14,owner_report_id:3,original_filename:"estimate.pdf",mime_type:"application/pdf",file_size:123,sort_order:1,created_at:"2026-01-01"}]});
  await s.page();
  const query=s.queries.find(q=>q.table==="owner_report_estimate_files");
  assert.ok(query);
  assert.equal(query.select.includes("storage_path"),false);
  assert.ok(query.filters.some(([key,value])=>key==="owner_report_id"&&value===3));
  assert.ok(query.filters.some(([key,value])=>key==="organization_id"&&value==="org-a"));
  assert.ok(query.filters.some(([key,value])=>key==="deleted_at"&&value===null));
});

test("owner forwards restored root keys only from company and repair scoped DB rows",async()=>{
  const s=setup({photos:[{storage_path:"xxxxxxxx-xxxx.jpg",photo_url:"public",sort_order:1}]});await s.page();
  assert.equal(s.signed[0].photo.storage_path,"xxxxxxxx-xxxx.jpg");
  assert.equal(s.signed[0].org,"org-a");assert.equal(s.signed[0].id,14);
});

test("owner does not swallow authorization failures or sign mismatched DB rows",async()=>{
  for(const photo of [{repair_id:15,storage_path:"old.jpg"},{organization_id:"org-b",storage_path:"old.jpg"}]){
    const s=setup({photos:[photo]});await assert.rejects(s.page());assert.equal(s.signed.length,0);
  }
  const s=setup({signFails:"authorization"});await assert.rejects(s.page());
});
