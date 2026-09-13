import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup({ user = { id: "user-a" }, responses = [] } = {}) {
  const queries = []; const revalidated = [];
  const db = { from(table) {
    const query = { table, filters: [] }; queries.push(query);
    const response = responses.shift() ?? { data: null, error: null };
    const builder = {
      select(value) { query.select=value; return builder; }, eq(...args) { query.filters.push(args); return builder; },
      update(value) { query.update=value; return builder; }, maybeSingle() { return builder; },
      then(resolve,reject) { return Promise.resolve(response).then(resolve,reject); },
    }; return builder;
  } };
  const exports={};
  const source=ts.transpileModule(readFileSync(new URL("./[repairId]/actions.ts",import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText;
  vm.runInNewContext(source,{exports,FormData,require(name){
    if(name==="next/cache") return {revalidatePath:path=>revalidated.push(path)};
    if(name==="@/lib/supabase-auth/server") return {createAuthServerClient:async()=>({auth:{getUser:async()=>({data:{user},error:null})}})};
    if(name==="@/lib/supabase-server") return {createServerSupabaseClient:()=>db};
    if(name==="@/lib/repair-id") return {parseRepairId:value=>/^[1-9][0-9]*$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null};
    throw new Error(name);
  }});
  return {submit:exports.submitApproval,queries,revalidated};
}

const ok=data=>({data,error:null});
function validResponses(decision="pending") { return [
  ok({id:"owner-a"}),
  ok({owner_report_id:"report-a",owner_id:"owner-a",organization_id:"org-a"}),
  ok({id:"report-a",repair_request_id:27,organization_id:"org-a"}),
  ok({id:27,organization_id:"org-a"}),
  ok({decision}),
]; }
function form(decision,comment="") { const value=new FormData(); value.set("decision",decision); value.set("comment",comment); return value; }
const previous={status:"idle",message:""};

test("dynamic repair approval reauthorizes scope and keeps the pending update guard",async()=>{
  const s=setup({responses:[...validResponses(),ok({decision:"approved"})]});
  const result=await s.submit("27","report-a",previous,form("approved"));
  assert.equal(result.status,"success");
  const update=s.queries.find(q=>q.table==="owner_approvals"&&q.update);
  assert.ok(update.filters.some(([key,value])=>key==="organization_id"&&value==="org-a"));
  assert.ok(update.filters.some(([key,value])=>key==="decision"&&value==="pending"));
  assert.equal(update.update.decided_by,"user-a");
  assert.equal(s.revalidated[0],"/owner/repairs/27");
});

test("consultation stores its validated comment",async()=>{
  const s=setup({responses:[...validResponses(),ok({decision:"consultation"})]});
  const result=await s.submit("27","report-a",previous,form("consultation","Please discuss"));
  assert.equal(result.status,"success");
  assert.equal(s.queries.find(q=>q.update).update.comment,"Please discuss");
});

test("invalid repair, non-recipient and cross-organization report never update",async()=>{
  const invalid=setup();
  assert.equal((await invalid.submit("27x","report-a",previous,form("approved"))).status,"error");
  assert.equal(invalid.queries.length,0);
  const missing=setup({responses:[ok({id:"owner-a"}),ok(null)]});
  assert.equal((await missing.submit("27","report-a",previous,form("approved"))).status,"error");
  assert.ok(missing.queries.every(q=>!q.update));
  const foreign=setup({responses:[ok({id:"owner-a"}),ok({owner_report_id:"report-a",owner_id:"owner-a",organization_id:"org-b"}),ok({id:"report-a",repair_request_id:27,organization_id:"org-a"})]});
  assert.equal((await foreign.submit("27","report-a",previous,form("approved"))).status,"error");
  assert.ok(foreign.queries.every(q=>!q.update));
});

test("an answered approval is never updated again",async()=>{
  const s=setup({responses:validResponses("approved")});
  const result=await s.submit("27","report-a",previous,form("consultation","again"));
  assert.equal(result.status,"answered");
  assert.ok(s.queries.every(q=>!q.update));
});
