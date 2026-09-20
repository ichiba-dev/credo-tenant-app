import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const org='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222';
const tenant='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444';
const req='55555555-5555-4555-8555-555555555555';
function setup(options={}){
  const calls=[],fetches=[];
  const a={id,organization_id:options.foreign?'other':org,tenant_account_id:tenant,repair_request_id:42,
    staff_auth_user_id:staff,tenant_line_account_id:'link',recipient_line_user_id:'Utest',media_type:'image',
    mime_type:'image/png',source_sha256:'\\x00',source_file_size:1,upload_state:'ready',
    staging_path:`${org}/line-outbound-staging/42/${id}.png`,storage_path:`${org}/line-outbound/42/${id}.png`,
    file_size:1,content_sha256:'\\x00'};
  const push={id:'push',attachment_id:id,status:options.status??'accepted',retry_key:'retry-key',lease_id:'lease',
    payload_ciphertext:'cipher',payload_sha256:'\\x00',payload_expires_at:new Date(Date.now()+27*3600_000).toISOString(),
    recipient_line_user_id:'Utest'};
  const query={select(){return query},eq(){return query},maybeSingle:async()=>({data:push,error:null})};
  const db={from(name){calls.push(name);return query},rpc(name){calls.push(name);return {abortSignal:async()=>({
    data:name==='reserve_staff_line_attachment'?a:name==='claim_staff_line_attachment_push'?[{...push,status:'sending'}]:'accepted',error:null})}},
    storage:{from(){return {createSignedUrl:async(path,seconds)=>{calls.push({signed:path,seconds});return {data:{signedUrl:`https://storage.example/${path}?token=test`},error:null}}}}}};
  const exports={};
  const imports={
    '@/lib/supabase-server':{createServerSupabaseClient:()=>db},
    '@/lib/supabase-auth/staff':{getStaffContext:async()=>({ok:true,canUpdate:!options.viewer,organizationId:org,userId:staff})},
    '@/lib/repair-id':{parseRepairId:x=>Number(x)},
    '@/lib/outbound-media':{OUTBOUND_BUCKET:'staff-line-files',prepareOutboundMedia:async()=>({mediaType:'image',mime:'image/png',source:Buffer.from([1]),final:Buffer.from([1]),preview:Buffer.from([1])})},
    '@/lib/outbound-crypto':{shaBytea:()=> '\\x00',digestMatches:()=>true,decryptPayload:()=>({to:'Utest',messages:[{type:'image',originalContentUrl:`https://x/storage/v1/object/sign/staff-line-files/${org}/line-outbound/42/${id}.png?token=a`,previewImageUrl:`https://x/storage/v1/object/sign/staff-line-files/${org}/line-outbound/42/${id}.preview.jpg?token=b`}]})},
    '@/lib/outbound-line-payload':{classifyLinePush:code=>code===200?'accepted':'unknown'},
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./outbound-workflow.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText,{exports,Buffer,File,Date,URL,AbortSignal,process:{env:{LINE_CHANNEL_ACCESS_TOKEN:'secret'}},
    fetch:async(url,init)=>{fetches.push({url,init});return url.startsWith('https://storage.example/')?
      {ok:true,status:206,headers:new Headers({'content-type':'image/png'}),body:{cancel:async()=>{}}}:
      {status:200,headers:new Headers()}},
    require(name){if(name==='server-only')return {};if(name in imports)return imports[name];throw Error(name)}});
  return {send:()=>exports.sendOutboundAttachment('42',req,new File([Uint8Array.of(1)],'a.png',{type:'image/png'})),signed:exports.signedForLine,db,calls,fetches};
}
test('image signed URL is 27h HTTPS and retrievable without authorization',async()=>{
  const x=setup();const url=await x.signed(x.db,'staff-line-files/path.png','image/png');
  assert.equal(url,'https://storage.example/staff-line-files/path.png?token=test');
  const call=x.calls.find(c=>c.signed);
  assert.equal(call.signed,'staff-line-files/path.png');assert.equal(call.seconds,97200);
  assert.equal(x.fetches[0].init.headers.Authorization,undefined);
});
test('accepted attachment retry does not claim or push again',async()=>{
  const x=setup();const result=await x.send();
  assert.equal(result.status,'accepted');assert.equal(x.fetches.length,0);
  assert(!x.calls.includes('claim_staff_line_attachment_push'));
});
test('pending retry uses stored payload and retry key',async()=>{
  const x=setup({status:'pending'});const result=await x.send();
  assert.equal(result.status,'accepted');assert.equal(x.fetches.length,1);
  assert.equal(x.fetches[0].init.headers['X-Line-Retry-Key'],'retry-key');
  assert.equal(JSON.parse(x.fetches[0].init.body).messages[0].type,'image');
  assert(x.calls.includes('claim_staff_line_attachment_push'));
  assert(x.calls.includes('finish_staff_line_attachment_push'));
});
test('viewer and foreign organization are rejected before delivery',async()=>{
  const viewer=setup({viewer:true}),foreign=setup({foreign:true});
  await assert.rejects(viewer.send(),/OUTBOUND_FORBIDDEN/);
  await assert.rejects(foreign.send(),/OUTBOUND_SCOPE_MISMATCH/);
  assert.equal(viewer.fetches.length,0);assert.equal(foreign.fetches.length,0);
});
