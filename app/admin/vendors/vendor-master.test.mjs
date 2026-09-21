import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const vendorId="11111111-1111-4111-8111-111111111111";
const requestId="22222222-2222-4222-8222-222222222222";
const base={vendorId,requestId,expectedUpdatedAt:null,companyName:"甲業者",contactName:"担当者",
  phone:"090-0000-0000",email:"TEST@example.com",isActive:true,categories:["水道","設備"],
  areas:[{areaCode:"nishinomiya",areaLabel:"西宮市"},{areaCode:"amagasaki",areaLabel:"尼崎市"}]};
function load(path,imports={}){
  const exports={};
  const source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(source,{exports,require(name){
    if(name==="server-only")return {};
    if(name in imports)return imports[name];
    throw new Error(`Unexpected import: ${name}`);
  }});return exports;
}
const validation=load("../../../lib/vendor-master.ts");
function setup({role="admin",authenticated=true,responseOrg="org-a",rpcError=null}={}){
  const calls=[];const refreshed=[];
  const context=authenticated?{ok:true,organizationId:"org-a",userId:"user-a",canUpdate:role!=="viewer"}:{ok:false,reason:"unauthenticated"};
  const service={rpc:async(name,args)=>{calls.push([name,args]);return rpcError?{data:null,error:rpcError}:
    {data:{id:args.p_vendor_id,organization_id:responseOrg},error:null};}};
  const actions=load("./actions.ts",{
    "@/lib/supabase-auth/staff":{getStaffContext:async()=>context},
    "@/lib/supabase-server":{createServerSupabaseClient:()=>service},
    "@/lib/vendor-master":validation,
    "next/cache":{revalidatePath:(path)=>refreshed.push(path)},
  });
  return {...actions,calls,refreshed};
}

test("validation accepts multiple extensible categories and areas",()=>{
  const parsed=validation.parseVendorMasterInput(base);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.categories)),["水道","設備"]);
  assert.equal(parsed.areas.length,2);
  assert.equal(parsed.email,"test@example.com");
  const custom=validation.parseVendorMasterInput({...base,areas:[{areaCode:"",areaLabel:"神戸市"}]});
  assert.equal(custom.areas[0].areaCode,"神戸市");
});

for(const role of ["admin","manager","staff"])test(`${role} can create and edit vendors`,async()=>{
  const s=setup({role});
  assert.equal((await s.saveVendorMaster(base)).ok,true);
  assert.equal((await s.saveVendorMaster({...base,expectedUpdatedAt:"2026-09-21T00:00:00Z",
    requestId:"33333333-3333-4333-8333-333333333333",isActive:false})).ok,true);
  assert.equal(s.calls.length,2);
  assert.equal(s.calls[1][1].p_is_active,false);
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls[0][1].p_categories)),["水道","設備"]);
  assert.equal(s.calls[0][1].p_areas.length,2);
});

test("viewer and unauthenticated users are rejected before service-role access",async()=>{
  for(const options of [{role:"viewer"},{authenticated:false}]){
    const s=setup(options);const result=await s.saveVendorMaster(base);
    assert.equal(result.ok,false);assert.equal(s.calls.length,0);
  }
});

test("browser organization input is ignored and foreign organization response fails closed",async()=>{
  const s=setup();
  assert.equal((await s.saveVendorMaster({...base,organization_id:"org-b"})).ok,true);
  assert.equal(s.calls[0][1].p_org,"org-a");assert.equal(s.calls[0][1].p_actor,"user-a");
  const foreign=setup({responseOrg:"org-b"});
  assert.equal((await foreign.saveVendorMaster(base)).ok,false);
});

test("same request ID is forwarded unchanged for safe retries and conflicts are reported",async()=>{
  const s=setup();await s.saveVendorMaster(base);await s.saveVendorMaster(base);
  assert.equal(s.calls[0][1].p_request_id,requestId);
  assert.equal(s.calls[1][1].p_request_id,requestId);
  const conflict=setup({rpcError:{message:"VENDOR_MASTER_REQUEST_CONFLICT"}});
  const result=await conflict.saveVendorMaster(base);
  assert.equal(result.ok,false);assert.equal(result.conflict,true);
});

test("invalid, duplicated and oversized input is rejected",async()=>{
  for(const input of [{...base,companyName:""},{...base,categories:["水道","水道"]},
    {...base,areas:[{areaCode:"same",areaLabel:"A"},{areaCode:"same",areaLabel:"B"}]},
    {...base,email:"invalid"}]){
    const s=setup();assert.equal((await s.saveVendorMaster(input)).ok,false);assert.equal(s.calls.length,0);
  }
});

test("vendor reads require organization filters and reject foreign related rows",async()=>{
  const queries=[];
  const rows={repair_vendors:[{id:vendorId,organization_id:"org-a",company_name:"甲業者",contact_name:"担当",
    phone:null,email:null,is_active:true,updated_at:"2026-09-21T00:00:00Z"}],
    repair_vendor_categories:[{organization_id:"org-b",vendor_id:vendorId,category:"水道"}],
    repair_vendor_areas:[]};
  const db={from(table){const q={table,filters:[]};queries.push(q);const b={
    select(){return b},eq(...args){q.filters.push(args);return b},order(){return b},
    then(resolve,reject){return Promise.resolve({data:rows[table],error:null}).then(resolve,reject)},
  };return b;}};
  const data=load("./data.ts",{});
  await assert.rejects(data.getVendorMasters({ok:true,supabase:db,organizationId:"org-a"}));
  assert.equal(queries.length,3);
  assert.ok(queries.every((q)=>JSON.stringify(q.filters).includes('["organization_id","org-a"]')));
});

test("screen includes required filters, create, edit and no physical delete action",()=>{
  const source=readFileSync(new URL("./vendor-master-screen.tsx",import.meta.url),"utf8");
  for(const label of ["会社名検索","カテゴリ","対応エリア","有効業者のみ","新規登録","編集"])
    assert.ok(source.includes(label),label);
  assert.equal(/deleteVendor|物理削除/.test(source),false);
});
