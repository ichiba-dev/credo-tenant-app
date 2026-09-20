import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const token='A'.repeat(43), hash='\\x'+createHash('sha256').update(token).digest('hex');
const org='11111111-1111-4111-8111-111111111111';
const tenant='22222222-2222-4222-8222-222222222222';
const id='33333333-3333-4333-8333-333333333333';
const path=`${org}/line-outbound/42/${id}.pdf`;
function load(options={}) {
  const values={
    staff_line_attachment_tokens:{id:'token-id',organization_id:org,tenant_account_id:tenant,attachment_id:id,
      token_hash:hash,expires_at:new Date(Date.now()+60_000).toISOString(),revoked_at:null},
    staff_line_attachments:{id,organization_id:org,tenant_account_id:tenant,repair_request_id:42,
      media_type:'pdf',mime_type:'application/pdf',upload_state:'ready',storage_path:path},
    organizations:{id:org},tenant_accounts:{id:tenant,organization_id:org},
    repair_requests:{id:42,organization_id:org,tenant_account_id:tenant},...options.values,
  };
  const db={from(name){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:values[name]??null,error:null})};return q},
    storage:{from(){return {createSignedUrl:async()=>({data:{signedUrl:'https://storage.example/signed'},error:null})}}}};
  const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./[token]/route.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText,{exports,Response,URL,Date,require(name){
    if(name==='@/lib/supabase-server')return {createServerSupabaseClient:()=>db};
    if(name==='@/lib/outbound-media')return {OUTBOUND_BUCKET:'staff-line-files'};
    if(name==='@/lib/outbound-crypto')return {shaBytea:x=>'\\x'+createHash('sha256').update(x).digest('hex'),digestMatches:(stored,x)=>stored===('\\x'+createHash('sha256').update(x).digest('hex'))};
    throw Error(name);
  }});
  return exports.GET(new Request('https://credo.example/api/line-outbound/pdf/'+token),{params:Promise.resolve({token})});
}
test('valid PDF token redirects to a short private signed URL',async()=>{
  const response=await load();assert.equal(response.status,303);
  assert.equal(response.headers.get('location'),'https://storage.example/signed');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
});
test('expired and revoked PDF tokens cannot be opened',async()=>{
  const expired=await load({values:{staff_line_attachment_tokens:{id:'token-id',organization_id:org,tenant_account_id:tenant,
    attachment_id:id,token_hash:hash,expires_at:new Date(Date.now()-1000).toISOString(),revoked_at:null}}});
  const revoked=await load({values:{staff_line_attachment_tokens:{id:'token-id',organization_id:org,tenant_account_id:tenant,
    attachment_id:id,token_hash:hash,expires_at:new Date(Date.now()+60_000).toISOString(),revoked_at:new Date().toISOString()}}});
  assert.equal(expired.status,404);assert.equal(revoked.status,404);
});
test('foreign attachment and unready PDF cannot be opened',async()=>{
  const foreign=await load({values:{staff_line_attachments:{id,organization_id:'other',tenant_account_id:tenant,
    repair_request_id:42,media_type:'pdf',mime_type:'application/pdf',upload_state:'ready',storage_path:path}}});
  const unready=await load({values:{staff_line_attachments:{id,organization_id:org,tenant_account_id:tenant,
    repair_request_id:42,media_type:'pdf',mime_type:'application/pdf',upload_state:'uploading',storage_path:path}}});
  const otherTenant=await load({values:{staff_line_attachments:{id,organization_id:org,tenant_account_id:'other',
    repair_request_id:42,media_type:'pdf',mime_type:'application/pdf',upload_state:'ready',storage_path:path}}});
  assert.equal(foreign.status,404);assert.equal(unready.status,404);assert.equal(otherTenant.status,404);
});
