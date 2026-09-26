import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
function load(file,imports={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {exports,require:name=>{if(name in imports)return imports[name];throw Error(name);}});return exports;
}
const list=load('./repair-list-state.ts');
const todo=load('./repair-todo-state.ts',{'./repair-list-state':list});
const calendar=load('./calendar-state.ts');
const grid=load('./calendar/month-grid.ts',{'../calendar-state':calendar});
const scheduler=load('./calendar/scheduler.ts',{'../calendar-state':calendar,'./month-grid':grid});
const timeline=load('./repair-calendar-state.ts',{'./calendar-state':calendar,'./calendar/scheduler':scheduler});
const Context=React.createContext(()=>{});
const imports={'react':React,'react/jsx-runtime':jsx,'./repair-detail-tabs':{RepairTabContext:Context},'./repair-calendar-section':{default:()=>null},
 './repair-calendar-state':timeline,'./repair-list-state':list,'./repair-todo-state':todo,'./vendor-dispatch-section':{statusLabels:{dispatched:'依頼済み',candidate:'手配候補'}},'./calendar/scheduler':scheduler};
const {RepairOverviewContent:Content}=load('./repair-overview.tsx',imports);
const now=Date.parse('2026-09-26T00:00:00Z');
const repair={id:1,status:'受付',created_at:'2026-09-25T00:00:00Z',history:null,vendor_dispatches:[],tenant_messages:[],owner_report_estimates:null};
const event={id:'a',repair_request_id:1,title:'未来予定',event_type:'repair_work',status:'scheduled',starts_at:'2026-09-28T01:00:00Z',ends_at:'2026-09-28T02:30:00Z',updated_at:'2026-09-25T00:00:00Z'};
const render=(extra={})=>renderToStaticMarkup(React.createElement(Content,{repair,events:[],loading:false,error:false,now,...extra}));
test('overview reuses todo action, empty states and uncertain-data warnings without invented quotes',()=>{
 const html=render();for(const label of ['現在の状況','業者未手配','今後の予定はありません','表示できる入居者連絡はありません'])assert.ok(html.includes(label));
 assert.doesNotMatch(html,/次にやること|最新見積|見積タブを開く|円/);
 const r={...repair,vendor_dispatches:[{id:'d',status:'candidate',events:[],messages:[]}]};
 assert.ok(render({repair:r}).includes(todo.repairTodos([r],now)[0].primary.action));
 assert.match(render({repair:{...repair,vendor_dispatch_unavailable:true}}),/手配情報を取得できていません/);
 assert.match(render({error:true}),/予定を取得できませんでした/);assert.doesNotMatch(render({error:true}),/今後の予定はありません/);
 assert.match(render({loading:true}),/予定を確認中/);
});
test('status-only helper values use current situation and only explicit actions use next action',()=>{
 const dispatched={id:'d',status:'dispatched',events:[],messages:[]};
 for(const [extra,label] of [
  [{vendor_dispatches:[dispatched]},'業者へ依頼済み'],
  [{vendor_dispatches:[dispatched],status:'見積待ち'},'見積待ち'],
  [{created_at:'2026-09-20',vendor_dispatches:[dispatched]},'3日以上更新なし'],
  [{status:'完了'},'完了'],
  [{vendor_dispatch_unavailable:true},'手配情報未確認'],
 ]) {
  const html=render({repair:{...repair,...extra}}).split('aria-label="直近予定"')[0];
  assert.match(html,/現在の状況/);assert.ok(html.includes(label));assert.doesNotMatch(html,/次にやること/);
 }
 const html=render({repair:{...repair,vendor_dispatches:[{...dispatched,status:'candidate'}]}}).split('aria-label="直近予定"')[0];
 assert.match(html,/次にやること/);assert.match(html,/業者を手配してください/);assert.doesNotMatch(html,/現在の状況/);
});
test('estimate block and tab link require files and show only the latest registered file metadata',()=>{
 for(const estimates of [null,{files:[]},{files:[],unavailable:true}]) {
  assert.doesNotMatch(render({repair:{...repair,owner_report_estimates:estimates}}),/最新見積|見積タブを開く|見積へのリンク/);
 }
 const files=[{created_at:'2026-09-24',original_filename:'old.pdf'},{created_at:'2026-09-25',original_filename:'latest.pdf'}];
 const html=render({repair:{...repair,owner_report_estimates:{files}}});
 assert.match(html,/最新見積/);assert.match(html,/latest.pdf/);assert.match(html,/登録日時：9\/25/);assert.match(html,/見積タブを開く/);
 assert.doesNotMatch(html,/old.pdf|円|受領日時/);assert.equal(files[0].original_filename,'old.pdf');
});
test('upcoming schedule includes only this case future scheduled events, max two with calendar links',()=>{
 const events=[event,{...event,id:'b',title:'予定2',starts_at:'2026-09-29T01:00:00Z'},
 {...event,id:'c',title:'予定3',starts_at:'2026-09-30T01:00:00Z'},{...event,id:'d',status:'completed',title:'完了済み'},
 {...event,id:'e',status:'cancelled',title:'取消済み'},{...event,id:'f',repair_request_id:2,title:'他案件'},
 {...event,id:'g',title:'過去予定',starts_at:'2026-09-25T01:00:00Z'}];
 const html=render({events}).split('aria-label="最新の業者手配"')[0];
 assert.match(html,/未来予定/);assert.match(html,/予定2/);assert.match(html,/10:00〜11:30/);
 assert.doesNotMatch(html,/予定3|完了済み|取消済み|他案件|過去予定/);assert.match(html,/\/admin\/calendar\?month=2026-09/);
});
test('latest dispatch is selected by timestamp and contact excludes staff, summarizes image and PDF',()=>{
 const dispatches=[{id:'old',vendorName:'旧業者',selectedAt:'2026-09-23',status:'candidate',events:[],messages:[]},
 {id:'new',vendorName:'最新業者',selectedAt:'2026-09-25',status:'dispatched',instructions:'現調依頼',events:[],messages:[]}];
 const messages=[{id:'staff',sender_type:'staff',message:'STAFF_SECRET',created_at:'2026-09-26'},
 {id:'image',sender_type:'tenant',created_at:'2026-09-25',attachment:{media_type:'image'}},
 {id:'pdf',sender_type:'tenant',created_at:'2026-09-24',attachment:{media_type:'pdf'}},
 {id:'text',sender_type:'tenant',created_at:'2026-09-23',message:'古い本文'}];
 const html=render({repair:{...repair,vendor_dispatches:dispatches,tenant_messages:messages}});
 assert.match(html,/最新業者/);assert.match(html,/依頼済み/);assert.match(html,/現調依頼/);assert.doesNotMatch(html,/旧業者|STAFF_SECRET|古い本文/);
 assert.match(html,/画像1件/);assert.match(html,/PDF受信/);
 assert.match(render({repair:{...repair,tenant_messages:[messages[3]]}}),/古い本文/);
 assert.doesNotMatch(render({repair:{...repair,tenant_messages:[messages[0]]}}),/STAFF_SECRET/);
 assert.equal(dispatches[0].id,'old');assert.equal(messages[0].id,'staff');
});
test('recent timeline takes last three dated past entries and redraws for another case',()=>{
 const history='2026/9/21 10:00 古い履歴\n2026/9/22 10:00 履歴2\n2026/9/23 10:00 履歴3\n日時不明の記録';
 const events=[{...event,status:'completed',starts_at:'2026-09-24T01:00:00Z',updated_at:'2026-09-25T01:00:00Z'}];
 const html=render({repair:{...repair,history},events}).split('aria-label="最近の動き"')[1];
 assert.equal((html.match(/<li>/g)||[]).length,3);assert.match(html,/予定を完了/);assert.match(html,/履歴3/);assert.doesNotMatch(html,/古い履歴|履歴2|日時不明の記録/);
 assert.doesNotMatch(render({repair:{...repair,id:2},events}),/未来予定/);
});
test('overview links only switch tabs, no mutation controls even for viewer',()=>{
 const calls=[];
 const Component=load('./repair-overview.tsx',{...imports,'react':{...React,useContext:()=>key=>calls.push(key)}}).RepairOverviewContent;
 const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
 const tree=Component({repair,events:[],loading:false,error:false,now});
 for(const button of nodes(tree).filter(n=>n.type==='button'))button.props.onClick();
 assert.deepEqual(calls,['schedule','vendors','line','history']);
 calls.length=0;
 const withEstimate=Component({repair:{...repair,owner_report_estimates:{files:[{created_at:'2026-09-25',original_filename:'estimate.pdf'}]}},events:[],loading:false,error:false,now});
 for(const button of nodes(withEstimate).filter(n=>n.type==='button'))button.props.onClick();
 assert.deepEqual(calls,['schedule','vendors','line','estimates','history']);
 assert.doesNotMatch(renderToStaticMarkup(tree),/<form|<input|<textarea|ステータスを更新/);
});
