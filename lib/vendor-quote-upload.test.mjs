import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';

const org='11111111-1111-4111-8111-111111111111';
const other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor='22222222-2222-4222-8222-222222222222';
const dispatch='33333333-3333-4333-8333-333333333333';
const requestId='44444444-4444-4444-8444-444444444444';
const receivedAt='2026-09-19T03:04:05.000Z';
const endpoint=`https://app.example/api/admin/repairs/23/vendor-dispatches/${dispatch}/quote-upload`;
const secret=Buffer.alloc(32,7).toString('base64');
let rows=[];let bytes=Buffer.from('%PDF-1.4\n%%EOF\n');let metadata={};let infoName='';let rpcCalls=[];let signs=[];let reservations=[];
let staff={ok:true,canUpdate:true,organizationId:org,userId:actor};
const digest=(value)=>crypto.createHash('sha256').update(value).digest('hex');
const db={
  from(table){
    let filters=[];
    const query={select:()=>query,eq:(field,value)=>{filters.push([field,value]);return query;},
      maybeSingle:async()=>({data:rows.find(x=>x.table===table && filters.every(([field,value])=>x[field]===value))??null,error:null})};
    return query;
  },
  storage:{from:()=>({
    createSignedUploadUrl:async(path,options)=>{signs.push([path,options]);return {data:{token:'signed-token'},error:null}},
    info:async(path)=>metadata.missing || !metadata.uploaded ?
      {data:null,error:{statusCode:'404'}} : ({data:{name:infoName||path,size:metadata.size??bytes.length,
      contentType:metadata.mime??'application/pdf',metadata:{sha256:metadata.sha??digest(bytes)}},error:null}),
    download:async()=>({data:new Blob([bytes]),error:null}),
  })},
  rpc:async(name,args)=>{
    if(name==='prepare_vendor_quote_upload'){
      const prior=reservations.find(x=>x.organization_id===args.p_org && x.request_id===args.p_request_id);
      if(prior)return {data:prior,error:null};
      const issued=new Date();
      const row={organization_id:args.p_org,request_id:args.p_request_id,
        repair_request_id:args.p_repair,dispatch_id:args.p_dispatch,actor_auth_user_id:args.p_actor,
        received_at:args.p_received_at,original_filename:args.p_filename,file_size:args.p_file_size,
        quote_id:crypto.randomUUID(),file_id:crypto.randomUUID(),issued_at:issued.toISOString(),
        expires_at:new Date(issued.getTime()+600000).toISOString()};
      reservations.push(row);return {data:row,error:null};
    }
    rpcCalls.push([name,args]);
    return {data:{revision_no:1},error:null};
  },
};
function load(path,imports){
  const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,Buffer,Blob,Request,Response,URL,Date,Uint8Array,process:{env:{OUTBOUND_TOKEN_SECRET:secret}},
      require(name){if(name==='server-only')return {};if(name==='node:crypto')return crypto;
        if(name in imports)return imports[name];throw Error(name)}});
  return exports;
}
const helper=load('./vendor-quote-upload.ts',{
  '@/lib/supabase-server':{createServerSupabaseClient:()=>db},
  '@/lib/outbound-crypto':{shaBytea:()=>`\\x${digest(bytes)}`},
});
const prepare=load('../app/api/admin/repairs/[repairId]/vendor-dispatches/[dispatchId]/quote-upload/prepare/route.ts',{
  '@/lib/supabase-auth/staff':{getStaffContext:async()=>staff},
  '@/lib/supabase-server':{createServerSupabaseClient:()=>db},
  '@/lib/outbound-crypto':{bytea:(v)=>`\\x${Buffer.from(v).toString('hex')}`},
  '@/lib/vendor-quote-upload':helper,
});
const finalize=load('../app/api/admin/repairs/[repairId]/vendor-dispatches/[dispatchId]/quote-upload/finalize/route.ts',{
  '@/lib/outbound-crypto':{bytea:(v)=>`\\x${Buffer.from(v).toString('hex')}`},
  '@/lib/supabase-auth/staff':{getStaffContext:async()=>staff},
  '@/lib/supabase-server':{createServerSupabaseClient:()=>db},
  '@/lib/vendor-quote-upload':helper,
});
const params={params:Promise.resolve({repairId:'23',dispatchId:dispatch})};
function reset(){rows=[{table:'repair_vendor_dispatches',id:dispatch,organization_id:org,repair_request_id:23,status:'dispatched'},
  {table:'repair_requests',id:23,organization_id:org}];bytes=Buffer.from('%PDF-1.4\n%%EOF\n');
  metadata={};infoName='';rpcCalls=[];signs=[];reservations=[];staff={ok:true,canUpdate:true,organizationId:org,userId:actor,supabase:db};}
function post(body,url,origin='https://app.example'){
  return new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
}
async function ticket(){
  const body={filename:'vendor.pdf',size:bytes.length,mime:'application/pdf',sha256:digest(bytes),requestId,receivedAt};
  const response=await prepare.POST(post(body,`${endpoint}/prepare`),params);
  assert.equal(response.status,200);
  metadata.uploaded=true;
  return response.json();
}
async function submit(prepared,extra={}){
  return finalize.POST(post({ticket:prepared.ticket,path:prepared.path,sha256:digest(bytes),
    size:bytes.length,mime:'application/pdf',taxRounding:'floor',validUntil:null,
    vendorQuoteNumber:null,lines:[{description:'Repair',quantity:1,unit:'job',unit_price_ex_tax:80000,
      line_amount_ex_tax:80000,tax_rate:0.1}],...extra},`${endpoint}/finalize`),params);
}

test('valid PDF uses server path and commits only after bytes and metadata match',async()=>{
  reset();const p=await ticket();assert.equal(signs.length,1);
  assert.equal(signs[0][0],p.path);assert.equal(signs[0][1].upsert,false);
  assert(p.path.startsWith(`${org}/23/${dispatch}/`));
  assert.equal((await submit(p)).status,200);assert.equal(rpcCalls.length,1);
  assert.equal(rpcCalls[0][1].p_file_size,bytes.length);
  assert.equal(rpcCalls[0][1].p_content_sha256,`\\x${digest(bytes)}`);
  assert.equal(rpcCalls[0][1].p_received_at,receivedAt);
  assert.notEqual(rpcCalls[0][1].p_upload_issued_at,rpcCalls[0][1].p_received_at);
});
test('15 MiB PDF is accepted and 15 MiB plus one byte is rejected',async()=>{
  reset();bytes=Buffer.alloc(15*1024*1024);bytes.write('%PDF-');
  const p=await ticket();assert.equal((await submit(p)).status,200);
  bytes=Buffer.concat([bytes,Buffer.from([0])]);
  const response=await prepare.POST(post({filename:'large.pdf',size:bytes.length,mime:'application/pdf',
    sha256:digest(bytes),requestId},`${endpoint}/prepare`),params);
  assert.equal(response.status,400);
});
test('MIME disguise and invalid magic bytes are rejected',async()=>{
  reset();const p=await ticket();metadata.mime='text/plain';assert.equal((await submit(p)).status,409);
  assert.equal(rpcCalls.length,0);
  reset();const q=await ticket();bytes=Buffer.from('NOPE-1.4\n%%EOF\n');metadata.sha=digest(Buffer.from('%PDF-1.4\n%%EOF\n'));
  assert.equal((await submit(q,{sha256:metadata.sha,size:bytes.length})).status,409);
  assert.equal(rpcCalls.length,0);
});
test('SHA256, size and Storage path mismatch each prevent RPC',async()=>{
  for(const kind of ['hash','size','path']){
    reset();const p=await ticket();
    if(kind==='hash')metadata.sha='00'.repeat(32);
    if(kind==='size')metadata.size=bytes.length+1;
    if(kind==='path')infoName=`${other}/23/${dispatch}/wrong.pdf`;
    assert.equal((await submit(p)).status,409);assert.equal(rpcCalls.length,0);
  }
});
test('changed PDF bytes with unchanged metadata SHA256 prevent RPC',async()=>{
  reset();const p=await ticket();const original=digest(bytes);
  bytes=Buffer.from('%PDF-1.4\n%%EOf\n');metadata.sha=original;metadata.size=15;
  assert.equal((await submit(p,{sha256:original,size:15})).status,409);
  assert.equal(rpcCalls.length,0);
});
test('browser path tampering and other organization are rejected before download',async()=>{
  reset();const p=await ticket();
  assert.equal((await submit(p,{path:`${other}/23/${dispatch}/wrong.pdf`})).status,400);
  assert.equal(rpcCalls.length,0);
  staff={...staff,organizationId:other};
  assert.equal((await submit(p)).status,403);
  assert.equal(rpcCalls.length,0);
});
test('other repair and dispatch are rejected',async()=>{
  reset();const p=await ticket();
  const wrongRepair={params:Promise.resolve({repairId:'24',dispatchId:dispatch})};
  assert.equal((await finalize.POST(post({ticket:p.ticket,path:p.path,sha256:digest(bytes),
    size:bytes.length,mime:'application/pdf',lines:[],taxRounding:'floor'},`${endpoint}/finalize`),wrongRepair)).status,403);
  const wrongDispatch={params:Promise.resolve({repairId:'23',dispatchId:other})};
  assert.equal((await finalize.POST(post({ticket:p.ticket,path:p.path,sha256:digest(bytes),
    size:bytes.length,mime:'application/pdf',lines:[],taxRounding:'floor'},`${endpoint}/finalize`),wrongDispatch)).status,403);
});
test('viewer cannot prepare or finalize',async()=>{
  reset();const p=await ticket();staff={...staff,canUpdate:false};
  const body={filename:'vendor.pdf',size:bytes.length,mime:'application/pdf',sha256:digest(bytes),requestId};
  assert.equal((await prepare.POST(post(body,`${endpoint}/prepare`),params)).status,403);
  assert.equal((await submit(p)).status,403);assert.equal(rpcCalls.length,0);
});
test('tampered ticket and missing PDF fail closed',async()=>{
  reset();const p=await ticket();
  assert.equal((await submit(p,{ticket:p.ticket+'x'})).status,403);
  metadata.missing=true;assert.equal((await submit(p)).status,409);
  assert.equal(rpcCalls.length,0);
});
test('prepare retries preserve IDs, path, and expiration',async()=>{
  reset();const first=await ticket();const second=await ticket();
  assert.equal(first.path,second.path);
  assert.equal(first.ticket,second.ticket);
  assert.equal(first.expiresAt,second.expiresAt);
  assert.equal(second.uploaded,true);
  assert.equal(reservations.length,1);
});

test('repeat finalize verifies the PDF and preserves the revision request',async()=>{
  reset();const p=await ticket();assert.equal((await submit(p)).status,200);
  const state=helper.readUploadState(p.ticket);
  rows.push({table:'vendor_quote_versions',id:state.quoteId,organization_id:org,
    dispatch_id:dispatch,request_id:requestId});
  assert.equal((await submit(p)).status,200);
  assert.equal(rpcCalls.length,2);
  assert.equal(rpcCalls[0][1].p_request_id,rpcCalls[1][1].p_request_id);
  assert.equal(rpcCalls[0][1].p_quote_id,rpcCalls[1][1].p_quote_id);
});

test('expired ticket is rejected even for a committed revision',async()=>{
  reset();const p=await ticket();
  const state=helper.readUploadState(p.ticket);
  rows.push({table:'vendor_quote_versions',id:state.quoteId,organization_id:org,
    dispatch_id:dispatch,request_id:requestId});
  const originalNow=Date.now;
  Date.now=()=>state.expiresAt;
  try { assert.equal((await submit(p)).status,410);assert.equal(rpcCalls.length,0); }
  finally { Date.now=originalNow; }
});
