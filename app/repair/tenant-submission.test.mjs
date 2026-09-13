import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup({ user=null, authError=null, tenant=null, tenantError=null }={}) {
  const queries=[];
  const auth={auth:{getUser:async()=>({data:{user},error:authError})}};
  const service={from(table){const q={table,filters:[]};queries.push(q);const b={select(){return b;},eq(...args){q.filters.push(args);return b;},maybeSingle:async()=>({data:tenant,error:tenantError})};return b;}};
  const exports={};const source=ts.transpileModule(readFileSync(new URL("./tenant-submission.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(source,{exports,require(name){if(name==="server-only")return{};if(name==="@/lib/supabase-auth/server")return{createAuthServerClient:async()=>auth};if(name==="@/lib/supabase-server")return{createServerSupabaseClient:()=>service};throw new Error(name);}});
  return {resolve:exports.resolveRepairSubmissionActor,queries};
}

test("missing auth session remains an anonymous submission",async()=>{
  const s=setup({authError:{name:"AuthSessionMissingError"}});assert.equal((await s.resolve()).actor.kind,"anonymous");assert.equal(s.queries.length,0);
});
test("authenticated active tenant is selected only by verified auth user",async()=>{
  const s=setup({user:{id:"auth-a"},tenant:{id:"tenant-a",organization_id:"org-a"}});const result=await s.resolve();assert.equal(result.actor.tenantId,"tenant-a");
  assert.deepEqual(s.queries[0].filters,[["auth_user_id","auth-a"],["is_active",true]]);
});
test("authenticated user without active tenant and lookup failures are rejected",async()=>{
  for(const options of [{user:{id:"auth-a"}},{user:{id:"auth-a"},tenant:{id:"tenant-a",organization_id:"org-a"},tenantError:{}},{authError:{name:"NetworkError"}}]) {
    assert.equal((await setup(options).resolve()).ok,false);
  }
});
