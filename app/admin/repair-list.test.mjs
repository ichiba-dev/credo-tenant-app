import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
function load(name, imports={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL(name,import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,require:(name)=>{if(name in imports)return imports[name];throw new Error(name);}});
 return exports;
}
const helper=load('./repair-list-state.ts');
const {repairListState:state,matchesRepairFilter:filter,matchesRepairSearch:search,groupRepairs:group}=helper;
const base={id:1,property_name:'イリステージ',room_number:'302',tenant_name:'田中',category:'エアコン',description:'冷えない',
 status:'受付',created_at:'2026-09-01T00:00:00Z',vendor_dispatches:[],tenant_messages:[],owner_report_estimates:null};
const dispatch=(status)=>({status,selectedAt:'2026-09-02T00:00:00Z',events:[],messages:[]});
test('unassigned and candidates explain attention; completed wins over stale dispatches',()=>{
 assert.equal(state(base).attention,true);assert.ok(state(base).reasons.includes('業者未手配'));
 assert.ok(state({...base,vendor_dispatches:[dispatch('candidate')]}).reasons.includes('手配候補'));
 const done=state({...base,status:'完了',vendor_dispatches:[dispatch('candidate')]});
 assert.equal(done.attention,false);assert.equal(filter(done,'active'),false);assert.equal(filter(done,'completed'),true);
});
test('requested and scheduling reflect known stages, never inferred quote or vendor reply waits',()=>{
 const sent=state({...base,status:'手配中',vendor_dispatches:[dispatch('dispatched')]});
 assert.ok(sent.reasons.includes('依頼済み'));assert.equal(sent.estimate,false);
 const scheduled=state({...base,status:'手配中',vendor_dispatches:[dispatch('visit_scheduled')]});
 assert.equal(scheduled.attention,false);assert.equal(scheduled.arranging,true);
 assert.equal(state({...base,status:'見積待ち'}).estimate,true);
 const unavailable=state({...base,vendor_dispatch_unavailable:true});
 assert.ok(unavailable.reasons.includes('手配情報未確認'));assert.equal(unavailable.reasons.includes('業者未手配'),false);
});
test('latest known activity excludes invalid dates and includes dispatch, message and estimate timestamps',()=>{
 const r={...base,tenant_messages:[{created_at:'bad'}],vendor_dispatches:[{...dispatch('dispatched'),events:[{occurredAt:'2026-09-10T00:00:00Z'}]}],
 owner_report_estimates:{files:[{created_at:'2026-09-11T00:00:00Z'}]}};
 assert.equal(state(r).updatedAt,Date.parse('2026-09-11T00:00:00Z'));
 assert.equal(state({...base,created_at:'bad'}).updatedAt,0);
});
test('groups preserve unnamed properties and prioritize attention, then recent unfinished, then completed without mutating input',()=>{
 const input=[{...base,id:4,status:'完了',created_at:'2026-10-01'},
 {...base,id:3,status:'手配中',vendor_dispatches:[dispatch('scheduling')],created_at:'2026-09-20'},
 {...base,id:2,created_at:'2026-09-10'},base,{...base,id:5,property_name:''}];
 const groups=group(input);
 assert.deepEqual(Array.from(groups.find(g=>g.property===base.property_name).repairs,r=>r.id),[2,1,3,4]);
 assert.ok(groups.some(g=>g.property==='物件名未登録'));assert.equal(input[0].id,4);
});
test('search supports all requested fields, full-width digits and multiple terms',()=>{
 for(const term of ['イリス','３０２','田中','エアコン','受付','イリス 302 田中'])assert.equal(search(base,term),true);
 assert.equal(search(base,'405'),false);assert.equal(filter(state(base),'all'),true);
});
const List=load('./repair-list.tsx',{'react':React,'react/jsx-runtime':jsx,'./repair-list-state':helper}).default;
test('initial UI renders grouped summaries and compact rows without mounting existing details',()=>{
 let calls=0;
 const html=renderToStaticMarkup(React.createElement(List,{repairs:[base,{...base,id:2,status:'完了'}],renderDetail:()=>{calls++;return React.createElement('div',null,'DETAIL');}}));
 assert.equal(calls,0);assert.match(html,/イリステージ/);assert.match(html,/302/);assert.match(html,/田中/);
 assert.match(html,/未完了を要対応順に表示/);assert.match(html,/hidden=""/);assert.match(html,/最終更新（確認可能分）/);
 assert.equal(html.includes('DETAIL'),false);
});
test('empty UI is usable and existing detail integration retains feature components',()=>{
 const html=renderToStaticMarkup(React.createElement(List,{repairs:[],renderDetail:()=>null}));
 assert.match(html,/該当する案件はありません/);
 const integration=readFileSync(new URL('./admin-repairs.tsx',import.meta.url),'utf8');
 for(const component of ['MessageSection','VendorDispatchSection','VendorQuoteUploadForm','RepairPdfButton','EstimateSection','RepairImage'])
  assert.ok(integration.includes('<'+component));
 assert.ok(integration.includes('renderDetail='));
});

test('property counts identify the active filter and search scope',()=>{
 for (const [selected,label] of [['active','未完了1 / 全2'],['attention','要対応1 / 全2'],['arranging','手配中0 / 全2'],['estimate','見積待ち0 / 全2'],['completed','完了1 / 全2'],['all','表示2 / 全2']]) {
  let call=0;
  const react={...React,useState:()=>[call++===0 ? selected : call===2 ? '' : new Set(),()=>{}]};
  const Component=load('./repair-list.tsx',{'react':react,'react/jsx-runtime':jsx,'./repair-list-state':helper}).default;
  const html=renderToStaticMarkup(React.createElement(Component,{repairs:[base,{...base,id:2,status:'完了'}],renderDetail:()=>null}));
  assert.ok(html.includes(label),label);
 }
 let call=0;
 const react={...React,useState:()=>[call++===0 ? 'all' : call===2 ? '302' : new Set(),()=>{}]};
 const Component=load('./repair-list.tsx',{'react':react,'react/jsx-runtime':jsx,'./repair-list-state':helper}).default;
 const html=renderToStaticMarkup(React.createElement(Component,{repairs:[base,{...base,id:2,room_number:'405'}],renderDetail:()=>null}));
 assert.ok(html.includes('表示1 / 全2（検索一致分）'));
});

test('unassigned LINE notice hides zero counts, preserves operations and distinguishes errors',()=>{
 const Notice=load('./unassigned-line-notice.tsx',{'react/jsx-runtime':jsx}).default;
 const props={messageCount:0,attachmentCount:0,messagesUnavailable:false,attachmentsUnavailable:false};
 const render=(extra={})=>renderToStaticMarkup(React.createElement(Notice,{...props,...extra},React.createElement('button',null,'既存割当操作')));
 assert.equal(render(),'');
 for(const counts of [{messageCount:3},{attachmentCount:1},{messageCount:3,attachmentCount:1}]) {
  const html=render(counts);
  assert.match(html,/<details/);assert.doesNotMatch(html,/<details[^>]* open/);
  assert.match(html,/既存割当操作/);
 }
 assert.match(render({messageCount:3,attachmentCount:1}),/メッセージ3件 \/ 添付1件/);
 assert.match(render({messagesUnavailable:true}),/メッセージ取得不可/);
 assert.match(render({attachmentsUnavailable:true}),/添付取得不可/);
 const page=readFileSync(new URL('./page.tsx',import.meta.url),'utf8');
 assert.ok(page.includes('(lineMessages.length > 0 || lineMessagesUnavailable) && <LineMessageSection'));
 assert.ok(page.includes('(attachments.length > 0 || attachmentsUnavailable) && <LineAttachmentSection'));
});
