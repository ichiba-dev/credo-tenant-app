import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup({ user = { id: "user-a" }, owner = { id: "owner-a", name: "Owner" } } = {}) {
  const listCalls=[]; const redirects=[];
  const exports={};
  const source=ts.transpileModule(readFileSync(new URL("./page.tsx",import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  const builder={select(){return builder;},eq(){return builder;},maybeSingle(){return builder;},then(resolve,reject){return Promise.resolve({data:owner,error:null}).then(resolve,reject);}};
  vm.runInNewContext(source,{exports,require(name){
    if(name==="react/jsx-runtime")return{jsx:()=>null,jsxs:()=>null};
    if(name==="next/link")return{default:()=>null};
    if(name==="next/navigation")return{redirect:path=>{redirects.push(path);throw new Error("redirect");}};
    if(name==="next/server")return{connection:async()=>{}};
    if(name==="@/lib/supabase-auth/server")return{createAuthServerClient:async()=>({auth:{getUser:async()=>({data:{user},error:null})}})};
    if(name==="@/lib/supabase-server")return{createServerSupabaseClient:()=>({from:()=>builder})};
    if(name==="./data")return{getOwnerRepairList:async id=>{listCalls.push(id);return[];}};
    throw new Error(name);
  }});
  return{page:exports.default,listCalls,redirects};
}

test("authenticated owner list derives owner ID from auth and never accepts it from the client",async()=>{
  const s=setup(); await s.page();
  assert.equal(JSON.stringify(s.listCalls),JSON.stringify(["owner-a"]));
});

test("unauthenticated owner list redirects to the safe owner return path",async()=>{
  const s=setup({user:null}); await assert.rejects(s.page());
  assert.equal(s.redirects[0],"/owner/login?next=%2Fowner");
  assert.equal(s.listCalls.length,0);
});
