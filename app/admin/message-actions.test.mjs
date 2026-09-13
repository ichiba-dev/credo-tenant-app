import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup({ staff={ok:true,organizationId:"org-a",userId:"staff-a",canUpdate:true}, repair={id:23,organization_id:"org-a",tenant_account_id:"tenant-a"}, inserted={id:"m1"} }={}) {
  const queries=[]; const responses=[{data:repair,error:null},{data:inserted,error:null}];
  const db={from(table){const q={table,filters:[]};queries.push(q);const b={select(){return b;},eq(...a){q.filters.push(a);return b;},insert(value){q.insert=value;return b;},maybeSingle(){return Promise.resolve(responses.shift());},single(){return Promise.resolve(responses.shift());}};return b;}};
  const exports={}; const source=ts.transpileModule(readFileSync(new URL("./message-actions.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(source,{exports,require(name){if(name==="next/cache")return{revalidatePath(){}};if(name==="@/lib/repair-id")return{parseRepairId:(v)=>/^\d+$/.test(v)&&Number(v)>0?Number(v):null};if(name==="@/lib/supabase-auth/staff")return{getStaffContext:async()=>staff};if(name==="@/lib/supabase-server")return{createServerSupabaseClient:()=>db};throw new Error(name);}});
  return {submit:exports.submitStaffMessage,queries};
}

test("admin manager and staff can reply with server-owned fields",async()=>{for(const role of ["admin","manager","staff"]){const s=setup();const result=await s.submit("23"," reply ");assert.equal(result.ok,true,role);assert.deepEqual({...s.queries[1].insert},{organization_id:"org-a",repair_request_id:23,sender_type:"staff",tenant_account_id:null,staff_auth_user_id:"staff-a",message:"reply"});assert.equal("staff_comment" in s.queries[1].insert,false);}});
test("viewer and unauthenticated staff cannot reach repair data",async()=>{for(const staff of [{ok:true,organizationId:"org-a",userId:"viewer",canUpdate:false},{ok:false,reason:"unauthenticated"}]){const s=setup({staff});assert.equal((await s.submit("23","reply")).ok,false);assert.equal(s.queries.length,0);}});
test("unlinked foreign and missing repairs cannot receive a reply",async()=>{for(const repair of [null,{id:23,organization_id:"org-b",tenant_account_id:"tenant-a"},{id:23,organization_id:"org-a",tenant_account_id:null}]){const s=setup({repair});assert.equal((await s.submit("23","reply")).ok,false);assert.equal(s.queries.length,1);}});
test("invalid empty and oversized input is rejected before DB",async()=>{for(const [id,message] of [["x","reply"],["23","   "],["23","a".repeat(2001)]]){const s=setup();assert.equal((await s.submit(id,message)).ok,false);assert.equal(s.queries.length,0);}});
