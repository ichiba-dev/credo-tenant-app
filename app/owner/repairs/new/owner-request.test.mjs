import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
function load(file,imports={},globals={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText,{exports,FormData,Uint8Array,Response,Blob,URL,require:name=>{
    if(name==='server-only')return {};
    if(name==='node:crypto')return {randomUUID};
    if(name in imports)return imports[name];
    throw Error(name);
  },...globals});return exports;
}
const limits=load('../../../repair/upload-limits.ts');
const propertyId='11111111-1111-4111-8111-111111111111';
const owner={id:'owner-a',organization_id:'org-a',auth_user_id:'user-a',name:'Owner A',is_active:true};
const link={owner_id:owner.id,organization_id:owner.organization_id,property_id:propertyId,is_active:true,valid_from:null,valid_to:null};
const property={id:propertyId,name:'Building A',organization_id:'org-a',is_active:true};
function setup(options={}) {
  const queries=[],uploads=[],rpcCalls=[];
  const service={from(table){
    const query={table,filters:[]};queries.push(query);
    const builder={select(value){query.select=value;return builder;},eq(...args){query.filters.push(args);return builder;},in(...args){query.filters.push(args);return builder;},order(){return builder;},maybeSingle(){return builder;},insert(row){query.insert=row;return builder;},
      then(resolve,reject){
        const data={owners:options.owner===undefined?owner:options.owner,property_owners:options.links??[link],properties:options.properties??[property],
          repair_requests:options.repair??{id:42,organization_id:'org-a',property_id:propertyId,source_type:'owner',source_owner_id:'owner-a'},repair_photos:null}[table];
        return Promise.resolve({data,error:options.failTable===table?{message:'SECRET_NEVER_EXPOSE'}:null}).then(resolve,reject);
      }};return builder;
    },storage:{from(bucket){assert.equal(bucket,'repair-images');return {upload:async(path,file,config)=>{
      uploads.push({path,file,config});return {data:{path},error:options.uploadError?{message:'SECRET_NEVER_EXPOSE'}:null};
    }};}}};
  const auth={auth:{getUser:async()=>({data:{user:options.loggedOut?null:{id:'user-a'}},error:null})},rpc:async(name,args)=>{
    rpcCalls.push({name,args});return {data:options.rpcError?null:42,error:options.rpcError?{message:'SECRET_NEVER_EXPOSE'}:null};
  }};
  const data=load('./data.ts',{'@/lib/supabase-auth/server':{createAuthServerClient:async()=>auth},'@/lib/supabase-server':{createServerSupabaseClient:()=>service}});
  const submission=load('./submission.ts',{'./data':data,'@/app/repair/upload-limits':limits});
  return {...data,...submission,queries,uploads,rpcCalls};
}
const jpeg=()=>new File([new Uint8Array([255,216,255,224])],'../../private.jpg',{type:'image/jpeg'});
function form(extra={},photos=[]) {
  const result=new FormData();
  for(const [key,value] of Object.entries({propertyId,locationType:'room',roomNumber:'202',category:'エアコン',description:'Broken',contactNotes:'Call first',...extra}))result.set(key,value);
  photos.forEach(file=>result.append('photos',file));return result;
}
test('owner context derives identity from auth and property choices from active scoped ownership',async()=>{
  const s=setup();const context=await s.getOwnerRequestContext();
  assert.deepEqual(JSON.parse(JSON.stringify(await s.getOwnerRequestProperties(context))),[{id:propertyId,name:'Building A'}]);
  assert.ok(s.queries[0].filters.some(([key,value])=>key==='auth_user_id'&&value==='user-a'));
  assert.ok(s.queries[1].filters.some(([key,value])=>key==='owner_id'&&value==='owner-a'));
  for(const query of s.queries.slice(1))assert.ok(query.filters.some(([key,value])=>key==='organization_id'&&value==='org-a'));
});
test('creates room/common-area in common ledger using authenticated RPC; never sends client organization or owner identity',async()=>{
  for(const locationType of ['room','common_area']){
    const s=setup();const result=await s.submitOwnerRepair(form({locationType,roomNumber:locationType==='room'?'202':''}));
    assert.equal(result.ok,true);assert.equal(result.repairId,42);assert.equal(s.rpcCalls[0].name,'create_owner_repair');
    assert.equal(s.rpcCalls[0].args.p_room,locationType==='room'?'202':null);
    assert.equal(s.rpcCalls[0].args.p_contact_notes,'Call first');
    assert.deepEqual(Object.keys(s.rpcCalls[0].args).sort(),['p_category','p_contact_notes','p_description','p_location','p_property','p_room']);
    assert.equal(s.uploads.length,0);
  }
});
test('other owner/org/property, expired/inactive ownership and unauthenticated users never reach insert',async()=>{
  for(const options of [{loggedOut:true},{owner:null},{owner:{...owner,is_active:false}},{owner:{...owner,auth_user_id:'other'}},
    {links:[]},{links:[{...link,owner_id:'other'}]},{links:[{...link,organization_id:'other'}]},{links:[{...link,is_active:false}]},
    {links:[{...link,valid_to:'2000-01-01'}]},{links:[{...link,valid_from:'2999-01-01'}]},
    {properties:[{...property,id:'other'}]},{properties:[{...property,organization_id:'other'}]},{properties:[{...property,is_active:false}]},
    {failTable:'owners'},{failTable:'property_owners'},{failTable:'properties'}]) {
    const s=setup(options);const result=await s.submitOwnerRepair(form());
    assert.equal(result.ok,false,JSON.stringify(options));assert.equal(result.retrySafe,true);assert.equal(s.rpcCalls.length,0);assert.equal(s.uploads.length,0);
  }
});
test('forged scope/source, duplicate fields, dummy common-area room and invalid photos fail before mutations',async()=>{
  const duplicate=form();duplicate.append('propertyId',propertyId);
  const invalid=[duplicate,form({organization_id:'other'}),form({source_type:'staff'}),form({owner_id:'other'}),form({unit_id:'other'}),form({repairId:'9'}),form({locationType:'common_area',roomNumber:'000'}),form({description:' '}),
    form({},[new File(['not-jpeg'],'a.jpg',{type:'image/jpeg'})]),form({},[new File(['text'],'a.pdf',{type:'application/pdf'})]),form({},Array.from({length:21},jpeg))];
  for(const input of invalid){const s=setup();assert.equal((await s.submitOwnerRepair(input)).ok,false);assert.equal(s.rpcCalls.length,0);}
});
test('owner photos use only new repair scope, private paths and provenance; no public URLs',async()=>{
  const s=setup();assert.equal((await s.submitOwnerRepair(form({},[jpeg(),jpeg()]))).ok,true);
  assert.equal(s.uploads.length,2);
  for(const [index,photo] of s.queries.filter(query=>query.table==='repair_photos').entries()) {
    assert.equal(photo.insert.source_type,'owner');assert.equal(photo.insert.source_channel,'web');assert.equal(photo.insert.photo_url,null);
    assert.equal(photo.insert.repair_id,42);assert.equal(photo.insert.organization_id,'org-a');assert.equal(photo.insert.sort_order,index+1);
    assert.match(photo.insert.storage_path,/^org-a\/42\/[a-f0-9-]{36}\.jpg$/);assert.equal(s.uploads[index].config.upsert,false);
  }
});
test('photo scope errors stop upload; partial creation and uncertain RPC results block blind retry',async()=>{
  for(const options of [{rpcError:true},{repair:{id:42,organization_id:'other'}},{repair:{id:42,organization_id:'org-a',property_id:propertyId,source_type:'owner',source_owner_id:'other'}},{uploadError:true},{failTable:'repair_photos'}]) {
    const s=setup(options);const result=await s.submitOwnerRepair(form({},[jpeg()]));
    assert.equal(result.ok,false);assert.equal(result.retrySafe,false);assert.equal(result.requestCreated,!options.rpcError);
    assert.doesNotMatch(JSON.stringify(result),/SECRET_NEVER_EXPOSE/);
    if(options.repair||options.rpcError)assert.equal(s.uploads.length,0);
  }
});
test('HTTP route requires same origin and authenticated owner, bounds request and only then submits',async()=>{
  let calls=0,authCalls=0;
  const route=load('./submit/route.ts',{'../submission':{submitOwnerRepair:async()=>{calls++;return {ok:true,repairId:42};}},'../data':{getOwnerRequestContext:async()=>{authCalls++;}},'@/app/repair/upload-limits':{MAX_REQUEST_BYTES:2048}});
  const send=(headers,body=form())=>route.POST(new Request('https://app.example/owner/repairs/new/submit',{method:'POST',headers,body}));
  assert.equal((await send({origin:'https://other.example'})).status,403);assert.equal((await send({})).status,403);assert.equal(authCalls,0);
  assert.equal((await send({origin:'https://app.example','content-length':'9999'})).status,413);
  assert.equal((await send({origin:'https://app.example'},form({description:'x'.repeat(3000)}))).status,413);
  assert.equal(calls,0);const response=await send({origin:'https://app.example'});assert.equal(response.status,200);assert.equal(calls,1);assert.equal(response.headers.get('cache-control'),'no-store');
  const denied=load('./submit/route.ts',{'../submission':{submitOwnerRepair:async()=>{throw Error('must not run');}},'../data':{getOwnerRequestContext:async()=>{throw Error('unauthorized');}},'@/app/repair/upload-limits':limits});
  assert.equal((await denied.POST(new Request('https://app.example/owner/repairs/new/submit',{method:'POST',headers:{origin:'https://app.example'},body:form()}))).status,403);
});
test('owner form offers scoped properties and common-area option without tenant/organization inputs',()=>{
  const Form=load('./request-form.tsx',{'react':React,'react/jsx-runtime':jsx,'next/link':{default:props=>React.createElement('a',props)},'@/app/repair/upload-limits':limits}).default;
  const html=renderToStaticMarkup(React.createElement(Form,{properties:[{id:propertyId,name:'Building A'}]}));
  for(const label of ['Building A','共用部','修理カテゴリ','内容','写真','連絡事項'])assert.ok(html.includes(label));
  assert.doesNotMatch(html,/name="(?:organization_id|owner_id|tenantName|source_type)"/);
});

const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
function assertOwnerReturn(tree){
  const links=elements(tree).filter(node=>node.type==='a'&&node.props.href==='/owner');
  assert.equal(links.length,1);
  assert.equal(links[0].props.children,'オーナー管理画面へ戻る');
  assert.equal(links[0].props.onClick,undefined,'native navigation must not be intercepted');
  assert.equal(links[0].props.target,undefined,'return in the same browser tab');
  assert.equal(links[0].props.hidden,undefined);
}
test('intake, no-property and error pages return to the existing owner route without a client router',async()=>{
  for(const state of ['ready','empty','error']){
    const Page=load('./page.tsx',{
      'react/jsx-runtime':jsx,'next/server':{connection:async()=>{}},
      'next/navigation':{redirect:()=>{throw Error('unexpected redirect');}},
      './data':{getOwnerRequestContext:async()=>({owner}),getOwnerRequestProperties:async()=>{
        if(state==='error')throw Error('unavailable');
        return state==='empty'?[]:[{id:propertyId,name:'Building A'}];
      }},'./request-form':{default:()=>null},
    }).default;
    assertOwnerReturn(await Page());
  }
});
test('completed intake returns with native navigation even while the form submission lock remains set',()=>{
  let stateIndex=0;
  const Form=load('./request-form.tsx',{
    'react':{useRef:()=>({current:true}),useState:()=>[['room',false,'受付済み',true][stateIndex++],()=>{}]},
    'react/jsx-runtime':jsx,'@/app/repair/upload-limits':limits,
  }).default;
  assertOwnerReturn(Form({properties:[]}));
});
test('intake still redirects an unauthenticated owner to login with its original return path',async()=>{
  const redirects=[];
  const Page=load('./page.tsx',{
    'react/jsx-runtime':jsx,'next/server':{connection:async()=>{}},
    'next/navigation':{redirect:path=>{redirects.push(path);throw Error('LOGIN_REDIRECT');}},
    './data':{getOwnerRequestContext:async()=>{throw Error('OWNER_UNAUTHENTICATED');},getOwnerRequestProperties:async()=>{throw Error('must not run');}},
    './request-form':{default:()=>null},
  },{Error}).default;
  await assert.rejects(Page(),/LOGIN_REDIRECT/);
  assert.deepEqual(redirects,['/owner/login?next=%2Fowner%2Frepairs%2Fnew']);
});
