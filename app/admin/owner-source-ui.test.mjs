import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
function load(file,imports={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
 }).outputText,{exports,crypto:{randomUUID:()=> 'uuid'},require:name=>{if(name in imports)return imports[name];throw Error(name);}});return exports;
}
const labels=load('../../lib/repair-source.ts');
const compose=load('./vendor-dispatch-compose.ts',{'@/lib/repair-source':labels});
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
test('source labels handle tenant/owner/staff/vendor and future text without mislabelling as tenant',()=>{
 assert.equal(labels.repairSourceLabel({}),'入居者');
 assert.equal(labels.repairSourceLabel({source_type:'staff'}),'管理会社');
 assert.equal(labels.repairSourceLabel({source_type:'future_ai'}),'その他');
 assert.equal(labels.repairPhotoSource({source_type:'owner'}),'オーナー');
 assert.equal(labels.repairPhotoSource({source_type:'tenant',source_channel:'line'}),'入居者LINE');
});
test('vendor compose UI shows owner photo provenance, owner report, common area and retained manual confirmation',()=>{
 const state=[];let cursor=0;
 const hooks={...React,useMemo:fn=>fn(),useRef:()=>({current:false}),useState:initial=>{
  const slot=cursor++;if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial;
  return [state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;}];
 }};
 const Component=load('./vendor-dispatch-section.tsx',{'react':hooks,'react/jsx-runtime':jsx,'next/navigation':{useRouter:()=>({refresh(){}})},
  './calendar-event-form':{default:()=>null},'./vendor-dispatch-actions':{},'./vendor-dispatch-compose':compose,'@/lib/repair-source':labels}).VendorDispatchSection;
 const props={repairId:42,candidates:[],canUpdate:true,suggestedInstructions:'管理会社依頼',propertyName:'Building A',roomNumber:'',sourceType:'owner',locationType:'common_area',repairCategory:'共用部',repairDescription:'宅配ボックス故障',
  repairPhotos:[{id:'999',photo_url:'https://example.test/signed',source_type:'owner',source_channel:'web'}],fallbackPhotoUrl:null,tenantMessages:[],managementCompanyName:'管理会社',
  dispatches:[{id:'d',status:'candidate',vendorName:'Vendor',vendorContactName:'Contact',selectedAt:'2026-09-25',instructions:'管理会社依頼',events:[],messages:[{id:'m',channel:'manual',photoSelectionRecorded:true,attachments:[{id:'a',sourceType:'repair_photo',repairPhotoId:'999'}]}]}]};
 const render=()=>{cursor=0;return Component(props);};
 let tree=render();const history=renderToStaticMarkup(tree);assert.match(history,/オーナー/);assert.doesNotMatch(history,/入居者フォーム/);
 nodes(tree).find(n=>n.type==='button'&&n.props.children==='業者へ手配').props.onClick();tree=render();
 const html=renderToStaticMarkup(tree);assert.match(html,/【オーナー申告】/);assert.match(html,/共用部/);assert.doesNotMatch(html,/【入居者申告】|入居者フォーム/);
 const body=nodes(tree).find(n=>n.type==='textarea'&&n.props.value?.includes('宅配ボックス故障')).props.value;
 assert.match(body,/【オーナー申告】\n宅配ボックス故障/);assert.match(body,/【管理会社からの依頼】\n管理会社依頼/);
 assert.match(body,/場所：共用部/);assert.match(body,/写真：1枚/);
});
