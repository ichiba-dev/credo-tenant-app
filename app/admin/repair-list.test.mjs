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
  {exports,require:(name)=>{
   if(name in imports)return imports[name];
   if(name==='./repair-todo-state')return load('./repair-todo-state.ts',{'./repair-list-state':helper});
   if(name==='./repair-todos')return load('./repair-todos.tsx',{'react':React,'react/jsx-runtime':jsx});
   throw new Error(name);
  }});
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

const todoHelper=load('./repair-todo-state.ts',{'./repair-list-state':helper});
const now=Date.parse('2026-09-24T00:00:00Z');
test('todo rules use known dispatches, exclude completed and never infer vendor quote absence',()=>{
 const todos=(repair)=>todoHelper.repairTodos([repair],now);
 assert.equal(todos(base)[0].primary.key,'unassigned');
 assert.equal(todos({...base,vendor_dispatches:[dispatch('candidate')],status:'見積待ち'})[0].primary.key,'candidate');
 const fresh={...base,created_at:'2026-09-24T00:00:00Z'};
 for(const status of ['dispatched','cancelled'])assert.equal(todos({...fresh,vendor_dispatches:[dispatch(status)]}).length,0);
 assert.equal(todos({...fresh,vendor_dispatch_unavailable:true}).length,0);
 assert.equal(todos({...fresh,vendor_dispatches:undefined}).length,0);
 assert.equal(todos({...base,status:'完了'}).length,0);
 assert.equal(todos({...fresh,status:'見積待ち',vendor_dispatches:[dispatch('dispatched')]})[0].primary.key,'estimate');
});
test('todo stale threshold is inclusive, uses latest known activity and deduplicates conditions',()=>{
 const repair={...base,created_at:new Date(now-todoHelper.STALE_REPAIR_DAYS*86400000).toISOString(),vendor_dispatches:[]};
 const item=todoHelper.repairTodos([repair],now);
 assert.equal(item.length,1);assert.equal(item[0].primary.key,'unassigned');
 assert.ok(item[0].reasons.some(r=>r.key==='stale'));
 assert.equal(todoHelper.repairTodos([repair],now-1)[0].reasons.some(r=>r.key==='stale'),false);
 assert.equal(todoHelper.repairTodos([{...repair,tenant_messages:[{created_at:new Date(now).toISOString()}]}],now)[0].reasons.some(r=>r.key==='stale'),false);
 assert.equal(todoHelper.repairTodos([{...repair,created_at:'bad',vendor_dispatches:[{...dispatch('dispatched'),selectedAt:'bad'}]}],now).length,0);
 const onlyStale={...base,id:3,vendor_dispatches:[dispatch('dispatched')]};
 const candidate={...base,id:2,vendor_dispatches:[dispatch('candidate')]};
 assert.deepEqual(Array.from(todoHelper.repairTodos([onlyStale,candidate,base],now),t=>t.repair.id),[1,2,3]);
});
test('todo jump opens property and repair, focuses and scrolls the existing detail',()=>{
 const group={open:false};let focused=false,scrolled=false;
 const detail={open:false,parentElement:{closest:()=>group},querySelector:()=>({focus:()=>{focused=true;}}),scrollIntoView:()=>{scrolled=true;}};
 todoHelper.openRepairDetails({getElementById:(id)=>{assert.equal(id,'repair-detail-1');return detail;}},1);
 assert.equal(group.open,true);assert.equal(detail.open,true);assert.ok(focused&&scrolled);
 assert.doesNotThrow(()=>todoHelper.openRepairDetails({getElementById:()=>null},9));
 let index=0;const values=[];
 const MockList=load('./repair-list.tsx',{'react':{...React,useEffect:()=>{},useMemo:fn=>fn(),useState:initial=>{
  const i=index++;return [typeof initial==='function'?initial():initial,value=>{values[i]=typeof value==='function'?value(new Set()):value;}];
 }},'react/jsx-runtime':jsx,'./repair-list-state':helper}).default;
 const tree=MockList({repairs:[base],renderDetail:()=>null});
 tree.props.children[0].props.onSelect(1);
 assert.equal(values[0],'all');assert.equal(values[1],'');assert.ok(values[2].has(1));assert.equal(values[3],1);
});
test('todo empty states and condition filter retain one row per repair',()=>{
 const Todo=load('./repair-todos.tsx',{'react':React,'react/jsx-runtime':jsx}).default;
 for(const repairs of [[],[{...base,status:'完了'}]]) {
  const html=renderToStaticMarkup(React.createElement(Todo,{repairs,onSelect:()=>{}}));
  assert.match(html,/今日やること/);assert.match(html,/現在、判定できるやることはありません/);
 }
 let i=0;
 const TodoFiltered=load('./repair-todos.tsx',{'react':{...React,useState:()=>[['stale',now,false][i++],()=>{}]},'react/jsx-runtime':jsx}).default;
 const html=renderToStaticMarkup(React.createElement(TodoFiltered,{repairs:[base],onSelect:()=>{}}));
 assert.equal((html.match(/<li>/g)||[]).length,0);assert.match(html,/この条件に該当する案件はありません/);
});

test('todo primary counts are exclusive, stale is supplemental, and five rows expand and collapse',()=>{
 let index=0;const state=['all',now,false];let selected;
 const Todo=load('./repair-todos.tsx',{'react':{...React,useEffect:()=>{},useState:()=>{
  const slot=index++;return [state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;}];
 }},'react/jsx-runtime':jsx}).default;
 const repairs=Array.from({length:19},(_,i)=>({...base,id:i+1}));
 const render=(rows=repairs)=>{index=0;return Todo({repairs:rows,onSelect:id=>{selected=id;}});};
 const buttons=node=> !node || typeof node!=='object' ? [] : Array.isArray(node) ? node.flatMap(buttons) :
  [...(node.type==='button'?[node]:[]),...buttons(node.props?.children)];
 let tree=render();let html=renderToStaticMarkup(tree);
 assert.equal((html.match(/<li>/g)||[]).length,5);
 assert.match(html,/業者未手配 19/);assert.match(html,/3日以上更新なし 0/);assert.match(html,/残り14件を見る/);
 assert.match(html,/bg-slate-100[^>]*>3日以上更新なし/);
 let actions=buttons(tree);actions.find(b=>b.props.children==='残り14件を見る').props.onClick();
 tree=render();html=renderToStaticMarkup(tree);assert.equal((html.match(/<li>/g)||[]).length,19);
 buttons(tree).find(b=>b.props.children==='最初の5件に戻す').props.onClick();
 tree=render();assert.equal((renderToStaticMarkup(tree).match(/<li>/g)||[]).length,5);
 buttons(tree).find(b=>b.props.className.includes('grid w-full')).props.onClick();assert.equal(selected,1);
 state[2]=true;buttons(tree)[1].props.onClick();assert.equal(state[0],'unassigned');assert.equal(state[2],false);
 state[0]='all';
 for(const n of [0,5])assert.doesNotMatch(renderToStaticMarkup(render(repairs.slice(0,n))),/残り\d+件を見る/);
 assert.match(renderToStaticMarkup(render(repairs.slice(0,6))),/残り1件を見る/);
 const mixed=[base,{...base,id:20,status:'見積待ち',vendor_dispatches:[dispatch('candidate')]},
  {...base,id:21,vendor_dispatches:[dispatch('dispatched')]}];
 html=renderToStaticMarkup(render(mixed));
 assert.match(html,/業者未手配 1/);assert.match(html,/手配候補 1/);assert.match(html,/見積待ち 0/);assert.match(html,/3日以上更新なし 1/);
 state[0]='stale';assert.equal((renderToStaticMarkup(render(mixed)).match(/<li>/g)||[]).length,1);
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
