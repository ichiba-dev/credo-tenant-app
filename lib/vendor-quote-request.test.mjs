import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const org='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',dispatch='33333333-3333-4333-8333-333333333333',vendor='44444444-4444-4444-8444-444444444444',quote='55555555-5555-4555-8555-555555555555',file='66666666-6666-4666-8666-666666666666',requestId='77777777-7777-4777-8777-777777777777';
let records,scope,rows,staff,calls,queries,signs,bytes,uploaded,reservation;
const sha=()=>crypto.createHash('sha256').update(bytes).digest('hex');
function reset(source='owner') {
  scope={id:requestId,organization_id:org,repair_request_id:27,vendor_dispatch_id:dispatch,vendor_id:vendor,created_by_auth_user_id:actor,status:'pending',expires_at:new Date(Date.now()+86400000).toISOString()};
  rows={repair_requests:[{id:27,organization_id:org,property_name:'イリスアール',room_number:'101',location_type:'room',category:'給湯器',source_type:source,tenant_name:'PRIVATE',contact_notes:'PRIVATE',description:'PRIVATE'}],repair_vendor_dispatches:[{id:dispatch,organization_id:org,repair_request_id:27,vendor_id:vendor,status:'dispatched',instructions:'共有済みの依頼内容'}],organizations:[{id:org,name:'CREDO'}],owner_reports:[{id:quote,organization_id:org,repair_request_id:27}]};
  staff={ok:true,canUpdate:true,organizationId:org,userId:actor};records=[];calls=[];queries=[];signs=[];bytes=Buffer.from('%PDF-1.4\n%%EOF\n');uploaded=false;reservation=null;
}
const db={from(table){
  const query={table,filters:[]};queries.push(query);
  const builder={select(value){query.select=value;return builder;},eq(key,value){query.filters.push([key,value]);return builder;},in(key,value){query.filters.push([key,value]);return builder;},is(key,value){query.filters.push([key,value]);return builder;},order(){return builder;},limit(){return builder;},maybeSingle(){query.single=true;return builder;},then(resolve,reject){const data=(rows[table]??[]).filter(row=>query.filters.every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value));return Promise.resolve({data:query.single?data[0]??null:data,error:null}).then(resolve,reject);}};return builder;
},storage:{from(bucket){return {
  info:async path=>uploaded?{data:{name:path,size:bytes.length,contentType:'application/pdf',metadata:{sha256:sha()}},error:null}:{data:null,error:{statusCode:'404'}},
  createSignedUploadUrl:async path=>{signs.push({bucket,path});return {data:{token:'signed-upload'},error:null};},
  download:async()=>({data:new Blob([bytes]),error:null}),
  upload:async(path)=>{signs.push({bucket,path});return {error:null};},
  remove:async()=>({error:null}),
};}},async rpc(name,args){
  calls.push({name,args});
  if(name==='issue_vendor_quote_request'){
    let row=records.find(r=>r.id===args.p_id);
    if(!row){row={...scope,id:args.p_id,token_hash:args.p_hash};records.push(row);}return {data:row,error:null};
  }
  if(name==='revoke_vendor_quote_request') {scope.status='revoked';return {data:null,error:null};}
  if(name==='inspect_vendor_quote_request'){
    return args.p_hash===scope.token_hash&&Date.parse(scope.expires_at)>Date.now()&&(scope.status==='pending'||args.p_allow_submitted&&scope.status==='submitted')?{data:scope,error:null}:{data:null,error:{message:'invalid'}};
  }
  if(name==='prepare_requested_vendor_quote'){
    reservation??={organization_id:org,repair_request_id:27,dispatch_id:dispatch,actor_auth_user_id:actor,request_id:args.p_operation,quote_id:quote,file_id:file,original_filename:args.p_filename,file_size:args.p_size,received_at:new Date().toISOString(),issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString()};
    return {data:reservation,error:null};
  }
  if(name==='submit_requested_vendor_quote'){
    if(scope.status==='submitted'&&records[0]?.id!==args.p_quote)return {error:{message:'duplicate'}};
    if(scope.status==='pending')records.push({id:args.p_quote,lines:args.p_lines});scope.status='submitted';return {data:{id:args.p_quote},error:null};
  }
  if(name==='publish_vendor_quote_to_owner')return {data:args.p_file,error:null};
  throw Error(name);
}};
function load(file,imports={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,require(name){if(name==='server-only')return {};if(name==='node:crypto')return crypto;if(name==='@/lib/supabase-server')return {createServerSupabaseClient:()=>db};if(name==='@/lib/outbound-crypto')return {bytea:b=>`\\x${Buffer.from(b).toString('hex')}`,shaBytea:b=>`\\x${crypto.createHash('sha256').update(b).digest('hex')}`};if(name==='@/lib/supabase-auth/staff')return {getStaffContext:async()=>staff};if(name==='next/cache')return {revalidatePath(){}};assert.ok(name in imports,name);return imports[name];},Buffer,Date,URL,Request,Response,Uint8Array,process:{env:{OUTBOUND_TOKEN_SECRET:Buffer.alloc(32,9).toString('base64')}},setInterval,clearInterval});return exports;
}
const input=load('./vendor-quote-input.ts');
const helper=load('./vendor-quote-upload.ts');
const requestHelper=load('./vendor-quote-request.ts');
const actions=load('../app/admin/vendor-quote-request-actions.ts',{'@/lib/vendor-quote-request':requestHelper,'@/lib/vendor-quote-upload':helper});
const route=load('../app/api/vendor/quotes/[operation]/route.ts',{'@/lib/vendor-quote-request':requestHelper,'@/lib/vendor-quote-upload':helper,'@/lib/vendor-quote-input':input});
const post=(operation,body,origin='https://app.example')=>route.POST(new Request(`https://app.example/api/vendor/quotes/${operation}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({operation})});
function token(){const raw=requestHelper.newQuoteToken();scope.token_hash=requestHelper.quoteTokenHash(raw);return raw;}
async function prepare(raw){const response=await post('prepare',{token:raw,filename:'quote.pdf',size:bytes.length,mime:'application/pdf',sha256:sha(),requestId});assert.equal(response.status,200);uploaded=true;return response.json();}
const lines=[{description:'工事',quantity:1,unit:'式',unit_price_ex_tax:10000,line_amount_ex_tax:10000,tax_rate:0.1}];
const submit=(raw,p,extra={})=>post('finalize',{token:raw,ticket:p.ticket,path:p.path,size:bytes.length,sha256:sha(),mime:'application/pdf',lines,validUntil:null,vendorQuoteNumber:'V27',notes:'共有備考',...extra});

test('A/B staff issues 256-bit random fragment link; DB receives hash only; retry cannot recover plaintext',async()=>{
  reset();const result=await actions.issueVendorQuoteRequest({repairId:27,dispatchId:dispatch,requestId});assert.equal(result.ok,true);
  const raw=result.url.split('#token=')[1];assert.equal(raw.length,43);assert.equal(records[0].token_hash,requestHelper.quoteTokenHash(raw));
  assert.ok(!JSON.stringify(calls).includes(raw));assert.ok(!result.url.includes('?token='));
  assert.notEqual(requestHelper.newQuoteToken(),raw);
  const retry=await actions.issueVendorQuoteRequest({repairId:27,dispatchId:dispatch,requestId});assert.equal(retry.url,null);assert.equal(records.length,1);
});
test('viewer and unauthenticated staff cannot issue or revoke',async()=>{
  for(const s of [{ok:false},{...staff,ok:true,canUpdate:false}]){reset();staff=s;assert.equal((await actions.issueVendorQuoteRequest({repairId:27,dispatchId:dispatch,requestId})).ok,false);assert.equal((await actions.revokeVendorQuoteRequest({dispatchId:dispatch,requestId})).ok,false);assert.equal(calls.length,0);}
});
test('C context returns only minimal shared fields without tenant PII or token hash',async()=>{
  reset();const raw=token();const response=await post('context',{token:raw});assert.equal(response.status,200);const text=JSON.stringify(await response.json());
  assert.ok(text.includes('イリスアール'));assert.ok(!text.includes('PRIVATE'));assert.ok(!text.includes(scope.token_hash));assert.ok(!text.includes(raw));
});
test('D/E/F submitted, invalid, expired, revoked tokens and foreign origin are rejected',async()=>{
  for(const status of ['revoked','submitted','expired','bad']){
    reset();const raw=token();if(status==='expired')scope.expires_at=new Date(0).toISOString();else if(status!=='bad')scope.status=status;
    const response=await post('context',{token:status==='bad'?'x'.repeat(43):raw});assert.equal(response.status,403);
  }
  reset();assert.equal((await post('context',{token:token()},'https://evil.example')).status,403);
});
test('G context refuses mismatched vendor, dispatch, repair or organization DB relationships',async()=>{
  for(const [table,key,value] of [['repair_requests','organization_id','other'],['repair_vendor_dispatches','vendor_id','other'],['repair_vendor_dispatches','repair_request_id',28],['repair_vendor_dispatches','status','cancelled']]){
    reset();const raw=token();rows[table][0][key]=value;assert.equal((await post('context',{token:raw})).status,403);
  }
});
for(const source of ['owner','tenant'])test(`H/K/L/O/P ${source} repair signed upload, lines commit, same-token retry produces one quote`,async()=>{
  reset(source);const raw=token(),p=await prepare(raw);
  assert.equal(signs[0].bucket,'vendor-quotes');assert.ok(p.path.startsWith(`${org}/27/${dispatch}/`));
  assert.equal((await submit(raw,p)).status,200);assert.equal((await submit(raw,p)).status,200);assert.equal(records.length,1);assert.equal(JSON.stringify(records[0].lines),JSON.stringify(lines));
  assert.equal(scope.status,'submitted');assert.equal((await post('context',{token:raw})).status,403);
});
test('I/J bad MIME, extension, oversized PDF are refused before signing',async()=>{
  for(const extra of [{mime:'text/plain'},{filename:'bad.txt'},{size:15728641},{filename:'bad\n.pdf'}]){
    reset();const response=await post('prepare',{token:token(),filename:'quote.pdf',size:bytes.length,mime:'application/pdf',sha256:sha(),requestId,...extra});assert.equal(response.status,400);assert.equal(signs.length,0);
  }
});
test('finalize rejects bad bytes, altered path, ticket scope, malformed lines and date',async()=>{
  for(const kind of ['bytes','path','lines','date','scope']){
    reset();const raw=token(),p=await prepare(raw);let extra={};
    if(kind==='bytes')bytes=Buffer.from('not a pdf');
    if(kind==='path')extra.path='other/path.pdf';if(kind==='lines')extra.lines=[{...lines[0],quantity:null}];if(kind==='date')extra.validUntil='2026-02-30';if(kind==='scope')scope.organization_id='other';
    assert.notEqual((await submit(raw,p,extra)).status,200);assert.equal(records.length,0);
  }
});
test('reissued request cannot reuse a previous request upload ticket even on the same dispatch',async()=>{
  reset();const raw=token(),p=await prepare(raw);scope.id=crypto.randomUUID();
  assert.equal((await submit(raw,p)).status,403);assert.equal(records.length,0);
});
test('revocation or expiry between upload and finalize blocks quote creation',async()=>{
  for(const state of ['revoked','expired']){
    reset();const raw=token(),p=await prepare(raw);
    if(state==='revoked')scope.status='revoked';else scope.expires_at=new Date(0).toISOString();
    assert.equal((await submit(raw,p)).status,403);assert.equal(records.length,0);
  }
});
test('pure line validation bounds input and computes tax groups without trusting total amounts',()=>{
  assert.equal(input.quoteTotal(input.parseQuoteLines(lines)),11000);
  for(const value of [[],[{...lines[0],unit_price_ex_tax:-1}],[{...lines[0],tax_rate:0.5}],[{...lines[0],line_amount_ex_tax:1}],[{...lines[0],description:'x'.repeat(1001)}],[{...lines[0],quantity:0.00001}]])assert.equal(input.parseQuoteLines(value),null);
});

const quoteView={id:quote,dispatch_id:dispatch,vendorName:'業者A',received_at:'2026-10-13T00:00:00Z',vendor_quote_number:'V27',valid_until:'2026-11-01',revision_no:1,amount_ex_tax:10000,tax_amount:1000,amount_inc_tax:11000,submissionPath:'vendor',notes:'備考',files:[{id:file,original_filename:'quote.pdf'}],lines:[{id:requestId,...lines[0]}]};
const uiImports={'react/jsx-runtime':jsx,react:{useEffect(){},useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useRef:value=>({current:value})},'next/navigation':{useRouter:()=>({refresh(){}})}};
test('M saved quote list shows origin, amount, revision, PDF and lines without exposing storage keys',()=>{
  const ui=load('../app/admin/vendor-quote-list.tsx',uiImports);const html=renderToStaticMarkup(ui.default({repairId:27,quotes:[quoteView]}));
  for(const s of ['業者提出','業者A','V27','11,000','revision 1','quote.pdf','工事','自動公開されません'])assert.ok(html.includes(s),s);
  assert.ok(!html.includes(`${org}/27/${dispatch}/`));assert.match(html,/\/api\/admin\/repairs\/27\/vendor-quotes\//);
});
test('Q/R owner transfer starts unselected with blank owner amount and requires explicit PDF confirmation',()=>{
  const ui=load('../app/admin/vendor-quote-owner-transfer.tsx',{...uiImports,'./owner-report-actions':{createOwnerReport(){}},'./vendor-quote-owner-actions':{publishVendorQuoteToOwner(){}}});
  const html=renderToStaticMarkup(ui.default({repairId:27,quotes:[quoteView],hasReport:false,summary:'報告'}));
  assert.match(html,/公開金額/);assert.match(html,/明細は自動転用しません/);assert.match(html,/type="checkbox"/);assert.match(html,/disabled=""/);assert.match(html,/value=""/);assert.ok(!html.includes('value="11000"'));
});
test('request state labels distinguish never-issued, pending, expired, revoked and submitted',()=>{
  const ui=load('../app/admin/vendor-quote-request-controls.tsx',{...uiImports,'./vendor-quote-request-actions':actions});
  assert.equal(ui.quoteRequestLabel(),'見積依頼未発行');
  assert.equal(ui.quoteRequestLabel({status:'pending',expires_at:'2099-01-01'}),'見積依頼中');assert.equal(ui.quoteRequestLabel({status:'pending',expires_at:'2000-01-01'}),'期限切れ');
  assert.equal(ui.quoteRequestLabel({status:'submitted'}),'見積受領');assert.equal(ui.quoteRequestLabel({status:'revoked'}),'失効');
});
test('owner publishing is staff-scoped, explicit and copies into owner bucket with independent amount',async()=>{
  reset();const scopedFile={id:file,organization_id:org,quote_version_id:quote,storage_path:'internal/vendor.pdf',original_filename:'quote.pdf',file_size:bytes.length,content_sha256:`\\x${sha()}`};
  const estimates=load('./estimate-files.ts');const action=load('../app/admin/vendor-quote-owner-actions.ts',{'@/lib/vendor-quote-file':{scopedVendorQuoteFile:async()=>scopedFile},'@/lib/estimate-files':estimates,'@/lib/vendor-quote-upload':helper});
  const data={repairId:27,quoteId:quote,ownerAmount:18000,confirmPdf:false,organizationId:'forged'};
  assert.equal((await action.publishVendorQuoteToOwner(data)).ok,false);assert.equal(signs.length,0);
  assert.equal((await action.publishVendorQuoteToOwner({...data,confirmPdf:true})).ok,true);
  assert.equal(signs[0].bucket,'owner-estimates');const rpc=calls.find(c=>c.name==='publish_vendor_quote_to_owner');assert.equal(rpc.args.p_org,org);assert.equal(rpc.args.p_amount,18000);assert.equal(rpc.args.p_confirm,true);
});

test('admin quote data binds sources to organization/dispatch and does not select token hashes or storage paths',async()=>{
  reset();rows.vendor_quote_versions=[{...quoteView,organization_id:org}];rows.repair_vendors=[{id:vendor,organization_id:org,company_name:'業者A'}];
  rows.vendor_quote_requests=[{...scope,quote_version_id:quote,status:'submitted',notes:'備考',created_at:'2026-10-13'}];
  rows.vendor_quote_files=[{id:file,organization_id:org,quote_version_id:quote,original_filename:'quote.pdf'}];rows.vendor_quote_lines=[{id:requestId,organization_id:org,quote_version_id:quote,...lines[0]}];
  const data=load('../app/admin/vendor-quote-data.ts');const result=await data.getVendorQuoteData(org,[27]);assert.equal(result[27].quotes.length,1);assert.equal(result[27].quotes[0].submissionPath,'vendor');
  assert.ok(queries.every(q=>!q.select.includes('token_hash')&&!q.select.includes('storage_path')));
  rows.vendor_quote_requests[0].vendor_id='other';await assert.rejects(data.getVendorQuoteData(org,[27]));
});
test('PDF access reauthorizes staff organization, repair, quote, file and exact private path',async()=>{
  reset();
  rows.vendor_quote_versions=[{id:quote,organization_id:org,dispatch_id:dispatch}];
  rows.vendor_quote_files=[{id:file,organization_id:org,quote_version_id:quote,bucket_id:'vendor-quotes',storage_path:`${org}/27/${dispatch}/${quote}/${file}.pdf`,mime_type:'application/pdf',file_size:bytes.length,original_filename:'quote.pdf'}];
  const helper=load('./vendor-quote-file.ts',{'@/lib/vendor-quote-upload':load('./vendor-quote-upload.ts')});
  assert.ok(await helper.scopedVendorQuoteFile(org,27,quote,file));
  assert.equal(await helper.scopedVendorQuoteFile(org,28,quote,file),null);
  assert.equal(await helper.scopedVendorQuoteFile('other',27,quote,file),null);
  rows.vendor_quote_files[0].storage_path='another/private.pdf';
  assert.equal(await helper.scopedVendorQuoteFile(org,27,quote,file),null);
});
