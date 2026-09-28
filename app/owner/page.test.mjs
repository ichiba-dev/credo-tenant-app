import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

function setup({ user = { id: "user-a" }, owner = { id: "owner-a", name: "Owner", auth_user_id:'user-a',organization_id:'org-a',is_active:true }, authError=null, ownerError=null, throws=false } = {}, file='./page.tsx') {
  const listCalls=[]; const redirects=[];
  const exports={};
  const source=ts.transpileModule(readFileSync(new URL(file,import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  const builder={select(){return builder;},eq(key,value){assert.equal(key,'auth_user_id');assert.equal(value,user.id);return builder;},maybeSingle(){if(throws)throw Error('PRIVATE_DB_ERROR');return builder;},then(resolve,reject){return Promise.resolve({data:owner,error:ownerError}).then(resolve,reject);}};
  vm.runInNewContext(source,{exports,require(name){
    if(name==='server-only')return {};
    if(name==="react/jsx-runtime")return jsx;
    if(name==='./auth-context'||name==='../auth-context')return setup({user,owner,authError,ownerError,throws},'./auth-context.ts').exports;
    if(name==='@/lib/repair-id')return setup({},'../../lib/repair-id.ts').exports;
    if(name==='./login-form')return {LoginForm:({nextPath})=>jsx.jsx('form',{'data-login-next':nextPath})};
    if(name==="next/link")return{default:()=>null};
    if(name==="next/navigation")return{redirect:path=>{redirects.push(path);throw new Error("redirect");}};
    if(name==="next/server")return{connection:async()=>{}};
    if(name==="@/lib/supabase-auth/server")return{createAuthServerClient:async()=>({auth:{getUser:async()=>({data:{user},error:authError})}})};
    if(name==="@/lib/supabase-server")return{createServerSupabaseClient:()=>({from:()=>builder})};
    if(name==="./data")return{getOwnerRepairList:async id=>{listCalls.push(id);return[];}};
    throw new Error(name);
  }});
  return{page:exports.default,listCalls,redirects,exports};
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

const login=(options,next='/owner')=>{
  const s=setup(options,'./login/page.tsx');
  return {...s,render:()=>s.page({searchParams:Promise.resolve({next})})};
};
test('guest login renders for next=/owner without redirecting back',async()=>{
  const s=login({user:null});assert.match(renderToStaticMarkup(await s.render()),/data-login-next="\/owner"/);
  assert.deepEqual(s.redirects,[]);
});
test('valid owner login redirects to safe next, including /owner, and owner page terminates',async()=>{
  for(const next of ['/owner','/owner/repairs/new','/owner/repairs/27','/owner/login','https://evil.example']){
    const s=login({},next);await assert.rejects(s.render(),/redirect/);
    assert.deepEqual(s.redirects,[['/owner','/owner/repairs/new','/owner/repairs/27'].includes(next)?next:'/owner']);
    const target=setup();assert.match(renderToStaticMarkup(await target.page()),/修理案件一覧/);assert.deepEqual(target.redirects,[]);
  }
});
for(const [label,options] of [
  ['missing owner',{owner:null}],
  ['inactive owner',{owner:{id:'owner-a',name:'Owner',auth_user_id:'user-a',organization_id:'org-a',is_active:false}}],
  ['lookup failure',{ownerError:{message:'PRIVATE_DB_ERROR'}}],
  ['thrown lookup failure',{throws:true}],
])test(`${label}: owner and login show guidance instead of mutual redirects`,async()=>{
  const s=setup(options);const html=renderToStaticMarkup(await s.page());
  assert.match(html,/role="alert"/);assert.match(html,/href="\/owner\/login\?next=%2Fowner"/);
  const l=login(options);const loginHtml=renderToStaticMarkup(await l.render());
  assert.match(loginHtml,/role="alert"/);assert.match(loginHtml,/data-login-next="\/owner"/);
  assert.doesNotMatch(html+loginHtml,/PRIVATE_DB_ERROR/);
  assert.deepEqual(s.redirects,[]);assert.deepEqual(l.redirects,[]);assert.deepEqual(s.listCalls,[]);
});
test('auth error with a returned user is handled consistently by both routes',async()=>{
  const options={authError:{message:'auth failure'}};
  const s=setup(options);await assert.rejects(s.page(),/redirect/);
  const l=login(options);await l.render();assert.deepEqual(l.redirects,[]);
});
test('repair return link reaches existing owner page without looping for missing owner',async()=>{
  assert.match(readFileSync(new URL('./repairs/new/page.tsx',import.meta.url),'utf8'),/<a href="\/owner"/);
  const s=setup({owner:null});assert.match(renderToStaticMarkup(await s.page()),/role="alert"/);assert.deepEqual(s.redirects,[]);
});
