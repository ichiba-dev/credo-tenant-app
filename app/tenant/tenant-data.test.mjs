import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup(responses) {
  const queries=[];
  const service={from(table){const q={table,filters:[]};queries.push(q);const b={
    select(v){q.select=v;return b;},eq(...a){q.filters.push(["eq",...a]);return b;},in(...a){q.filters.push(["in",...a]);return b;},order(...a){q.order=a;return b;},
    maybeSingle(){const value=responses[table];return Promise.resolve({data:Array.isArray(value)?value[0]??null:value??null,error:null});},
    then(resolve,reject){return Promise.resolve({data:responses[table]??[],error:null}).then(resolve,reject);}
  };return b;}};
  const exports={}; const source=ts.transpileModule(readFileSync(new URL("./data.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(source,{exports,require(name){if(name==="server-only")return{};if(name==="@/lib/supabase-server")return{createServerSupabaseClient:()=>service};return{};}});
  return {...exports,queries};
}
const tenant={tenantId:"tenant-a",organizationId:"org-a",displayName:"A"};
const repair={id:23,organization_id:"org-a",tenant_account_id:"tenant-a",property_name:"P",room_number:"201",tenant_name:"A",category:"C",description:"D",created_at:"2026-01-01",status:"\u53d7\u4ed8",history:null,staff_comment:null,storage_path:null,photo_url:null};

test("tenant list is filtered by tenant and organization in the database query",async()=>{
  const s=setup({repair_requests:[repair]});const rows=await s.getTenantRepairs(tenant);assert.equal(rows.length,1);
  assert.deepEqual(s.queries[0].filters,[["eq","tenant_account_id","tenant-a"],["eq","organization_id","org-a"]]);
});
test("tenant detail requires id, tenant and organization in one query",async()=>{
  const s=setup({repair_requests:repair});assert.equal((await s.getTenantRepair(tenant,23)).id,23);
  assert.deepEqual(s.queries[0].filters,[["eq","id",23],["eq","tenant_account_id","tenant-a"],["eq","organization_id","org-a"]]);
});
test("cross-tenant and cross-organization returned rows fail closed",async()=>{
  for(const row of [{...repair,tenant_account_id:"tenant-b"},{...repair,organization_id:"org-b"}]){const s=setup({repair_requests:[row]});await assert.rejects(s.getTenantRepairs(tenant));}
});
test("photos are queried only by the already authorized repair and organization",async()=>{
  const photo={repair_id:23,organization_id:"org-a",storage_path:"org-a/23/file.jpg",photo_url:null,sort_order:0};const s=setup({repair_photos:[photo]});await s.getTenantRepairPhotos(tenant,23);
  assert.deepEqual(s.queries[0].filters,[["eq","repair_id",23],["eq","organization_id","org-a"]]);
});
test("tenant message history is tenant, repair, organization and sender scoped",async()=>{
  const row={id:"m1",organization_id:"org-a",repair_request_id:23,sender_type:"tenant",tenant_account_id:"tenant-a",message:"hello",created_at:"2026-01-02"};
  const s=setup({repair_messages:[row]});const messages=await s.getTenantRepairMessages(tenant,23);assert.equal(messages[0].message,"hello");
  const expected = [["eq","organization_id","org-a"],["eq","repair_request_id",23],["in","sender_type",["tenant","staff"]]];
  assert.equal(JSON.stringify(s.queries[0].filters), JSON.stringify(expected));
});
