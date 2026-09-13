import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup({context={ok:true,tenant:{tenantId:"tenant-a",organizationId:"org-a"}},repair={id:23,organization_id:"org-a",tenant_account_id:"tenant-a"},inserted={id:"m1"}}={}){
  const queries=[];const responses=[{data:repair,error:null},{data:inserted,error:null}];
  const db={from(table){const q={table,filters:[]};queries.push(q);const b={select(){return b;},eq(...a){q.filters.push(a);return b;},insert(value){q.insert=value;return b;},maybeSingle(){return Promise.resolve(responses.shift());},single(){return Promise.resolve(responses.shift());}};return b;}};
  const revalidated=[];const exports={};const source=ts.transpileModule(readFileSync(new URL("./[repairId]/message-actions.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(source,{exports,require(name){if(name==="next/cache")return{revalidatePath:(v)=>revalidated.push(v)};if(name==="@/lib/repair-id")return{parseRepairId:(v)=>/^\d+$/.test(v)&&Number(v)>0?Number(v):null};if(name==="@/lib/supabase-auth/tenant")return{getTenantContext:async()=>context};if(name==="@/lib/supabase-server")return{createServerSupabaseClient:()=>db};throw new Error(name);}});
  return{submit:exports.submitTenantMessage,queries,revalidated};
}
test("tenant posts to an exactly authorized repair with server-owned sender fields",async()=>{
  const s=setup();assert.equal((await s.submit("23","  hello  ")).ok,true);
  assert.deepEqual(s.queries[0].filters,[["id",23],["tenant_account_id","tenant-a"],["organization_id","org-a"]]);
  assert.deepEqual({...s.queries[1].insert},{organization_id:"org-a",repair_request_id:23,sender_type:"tenant",tenant_account_id:"tenant-a",staff_auth_user_id:null,message:"hello"});
  assert.equal("staff_comment" in s.queries[1].insert,false);assert.deepEqual(s.revalidated,["/tenant/repairs/23"]);
});
test("empty, oversized and invalid repair input never reaches the database",async()=>{
  for(const [id,message] of [["x","hello"],["23","   "],["23","a".repeat(2001)]]){const s=setup();assert.equal((await s.submit(id,message)).ok,false);assert.equal(s.queries.length,0);}
});
test("inactive account and foreign tenant or organization cannot insert",async()=>{
  const inactive=setup({context:{ok:false,reason:"forbidden"}});assert.equal((await inactive.submit("23","hello")).ok,false);assert.equal(inactive.queries.length,0);
  for(const repair of [null,{id:23,organization_id:"org-b",tenant_account_id:"tenant-a"},{id:23,organization_id:"org-a",tenant_account_id:"tenant-b"}]){const s=setup({repair});assert.equal((await s.submit("23","hello")).ok,false);assert.equal(s.queries.length,1);}
});
