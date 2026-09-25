import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

function load(file,imports={},globals={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,require:name=>{if(name in imports)return imports[name];throw Error(name);},...globals});return exports;
}
const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
const helper=load('./repair-list-state.ts');
const todo=load('./repair-todo-state.ts',{'./repair-list-state':helper});
const repair={id:1,property_name:'物件A',room_number:'202',tenant_name:'入居者',category:'エアコン',description:'冷えない',status:'受付',created_at:'2026-09-25T00:00:00Z',vendor_dispatches:[],tenant_messages:[],repair_photos:[],owner_report_estimates:null};
function harness(initial=[],runEffects=false) {
 let index=0;const state=initial,effects=[];
 return {state,effects,reset(){index=0;effects.length=0;},hooks:{...React,useMemo:fn=>fn(),useRef:()=>({current:null}),
  useEffect:fn=>{if(runEffects)effects.push(fn);},useState:initial=>{
   const slot=index++;if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial;
   return [state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;}];
  }}};
}
function listHarness(desktop=true,globals={}) {
 const h=harness(['active','',new Set(),null,desktop,null,false],true);
 const Todo=()=>null;
 const List=load('./repair-list.tsx',{'react':h.hooks,'react/jsx-runtime':jsx,'./repair-list-state':helper,'./repair-todo-state':todo,'./repair-todos':{default:Todo}},globals).default;
 const calls=[];
 const render=(repairs=[repair,{...repair,id:2,room_number:'301'}])=>{h.reset();calls.length=0;return List({repairs,renderDetail:(r,pc,active)=>{
  calls.push({id:r.id,pc,active});return React.createElement('p',null,`DETAIL_${r.id}`);
 }});};
 return {...h,render,calls,Todo};
}

test('desktop selects center detail, highlights row, never mounts inline, and caches case drafts',()=>{
 const h=listHarness();let tree=h.render();assert.equal(h.calls.length,0);
 const pane=()=>nodes(tree).find(n=>n.props?.id==='selected-repair-pane');
 assert.match(renderToStaticMarkup(pane()),/左の一覧から案件を選択/);
 let prevented=false;
 nodes(tree).find(n=>n.props?.id==='repair-detail-1').props.children[0].props.onClick({preventDefault(){prevented=true;}});
 tree=h.render();assert.ok(prevented);assert.deepEqual(h.calls,[{id:1,pc:true,active:true}]);
 const row=nodes(tree).find(n=>n.props?.id==='repair-detail-1');
 assert.equal(row.props.children[0].props['aria-current'],'true');assert.ok(!nodes(row).some(n=>n.type==='p'&&n.props.children==='DETAIL_1'));
 assert.match(renderToStaticMarkup(pane()),/DETAIL_1/);
 nodes(tree).find(n=>n.props?.id==='repair-detail-2').props.children[0].props.onClick({preventDefault(){}});
 tree=h.render();assert.deepEqual(h.calls,[{id:1,pc:true,active:false},{id:2,pc:true,active:true}]);
 assert.equal(nodes(pane()).find(n=>n.type==='div'&&n.key==='1').props.hidden,true);
 assert.equal(nodes(pane()).find(n=>n.type==='div'&&n.key==='2').props.hidden,false);
});

test('three scrollable panes and calendar expansion keep selected case and narrow-screen layout',()=>{
 const h=listHarness();let tree=h.render();
 assert.match(tree.props.className,/35fr.*40fr.*25fr/);
 for(const label of ['今日やること・予定','修理案件一覧','選択中の案件詳細']) {
  const pane=nodes(tree).find(n=>n.props?.['aria-label']===label);assert.match(pane.props.className,/overflow-y-auto/);
 }
 const expand=nodes(tree).find(n=>n.props?.children==='カレンダーを広げる');expand.props.onClick();
 tree=h.render();assert.match(tree.props.className,/30fr.*35fr.*35fr/);
 assert.equal(nodes(tree).find(n=>n.props?.children==='カレンダーを縮める').props['aria-expanded'],true);
 assert.match(tree.props.className,/grid-cols-1/);
 const mobile=listHarness(false);tree=mobile.render();assert.ok(!nodes(tree).some(n=>n.props?.id==='selected-repair-pane'));
 nodes(tree).find(n=>n.props?.id==='repair-detail-1').props.onToggle({currentTarget:{open:true}});
 tree=mobile.render();assert.deepEqual(mobile.calls,[{id:1,pc:false,active:true}]);
 assert.match(renderToStaticMarkup(tree),/DETAIL_1/);
 assert.match(renderToStaticMarkup(h.render([])),/表示する案件はありません/);
});

test('todo and calendar hash jumps select center, clear filters, open group and focus the pane',()=>{
 const listeners={};const group={open:false};let focused=false,scrolled=false;
 const pane={scrollTop:100,focus(){focused=true;}};
 const h=listHarness(true,{window:{location:{hash:'#repair-detail-2'},matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),
  addEventListener:(name,fn)=>{listeners[name]=fn;},removeEventListener(){}},
  document:{getElementById:id=>id==='selected-repair-pane'?pane:{parentElement:{closest:()=>group},scrollIntoView(){scrolled=true;}}}});
 let tree=h.render();nodes(tree).find(n=>n.type===h.Todo).props.onSelect(1);
 assert.equal(h.state[0],'all');assert.equal(h.state[1],'');assert.equal(h.state[5],1);
 h.render();h.effects[2]();assert.ok(group.open&&focused&&scrolled);assert.equal(pane.scrollTop,0);
 h.effects[1]();assert.equal(h.state[5],2);assert.equal(h.state[3],2);
 listeners.hashchange();assert.equal(h.state[5],2);
 tree=h.render();let prevented=false;
 const sidebar=nodes(tree).find(n=>n.type==='aside');
 sidebar.props.onClickCapture({button:0,target:{closest:()=>({getAttribute:()=>'/admin#repair-detail-1'})},preventDefault(){prevented=true;}});
 assert.ok(prevented);assert.equal(h.state[5],1);
 sidebar.props.onClickCapture({button:0,ctrlKey:true,target:{closest(){throw Error('modified link should remain native');}}});
});

test('all eight tabs switch accessibly, retain visited forms, and reset to overview when reselected',()=>{
 const h=harness();const focused=[];
 const {default:Tabs,DETAIL_TABS}=load('./repair-detail-tabs.tsx',{'react':h.hooks,'react/jsx-runtime':jsx},{document:{getElementById:id=>({focus:()=>focused.push(id)})}});
 const sections=Object.fromEntries(DETAIL_TABS.map(([key])=>[key,React.createElement('input',{defaultValue:key})]));
 const render=(active=true,desktop=true)=>{h.reset();return Tabs({repairId:1,active,desktop,sections});};
 let tree=render();assert.equal(nodes(tree).filter(n=>n.props?.role==='tab').length,8);
 const click=key=>nodes(tree).find(n=>n.props?.id===`repair-1-tab-${key}`).props.onClick();
 for(const [key] of DETAIL_TABS) {
  click(key);tree=render();assert.equal(nodes(tree).find(n=>n.props?.id===`repair-1-panel-${key}`).props.hidden,false);
 }
 click('line');tree=render();const line=nodes(tree).find(n=>n.props?.id==='repair-1-panel-line');
 click('overview');tree=render();assert.equal(nodes(tree).find(n=>n.props?.id==='repair-1-panel-line').props.children,line.props.children);
 click('line');tree=render();render(false);render(true);tree=render(true);
 assert.equal(nodes(tree).find(n=>n.props?.id==='repair-1-tab-overview').props['aria-selected'],true);
 nodes(tree).find(n=>n.props?.id==='repair-1-tab-overview').props.onKeyDown({key:'ArrowRight',preventDefault(){}});
 tree=render();assert.equal(focused.at(-1),'repair-1-tab-line');
 assert.equal(nodes(tree).find(n=>n.props?.id==='repair-1-tab-line').props.tabIndex,0);
 const mobile=render(true,false);assert.equal(nodes(mobile).filter(n=>n.type==='section').length,8);
 assert.ok(!nodes(mobile).some(n=>n.props?.role==='tablist'));
});

const state=load('./calendar-state.ts');
const grid=load('./calendar/month-grid.ts',{'../calendar-state':state});
const scheduler=load('./calendar/scheduler.ts',{'../calendar-state':state,'./month-grid':grid});
test('embedded week reuses day grouping and event list, changes day and omits empty event cards',()=>{
 const h=harness(),List=()=>null;
 const Week=load('./admin-week-calendar.tsx',{'react':h.hooks,'react/jsx-runtime':jsx,'./calendar-state':state,'./calendar/scheduler':scheduler,'./calendar-events-list':{default:List}}).default;
 const now=Date.parse('2026-09-25T00:00:00Z');
 const events=[{id:'a',title:'予定',starts_at:'2026-09-26T01:00:00Z',ends_at:null,all_day:false,status:'scheduled',repair_request_id:1}];
 const render=()=>{h.reset();return Week({events,initialNow:now,canUpdate:false});};
 let tree=render();assert.equal(nodes(tree).filter(n=>n.type==='button').length,7);assert.ok(!nodes(tree).some(n=>n.type===List));
 nodes(tree).find(n=>n.props?.['aria-label']==='2026-09-26 1件').props.onClick();tree=render();
 const list=nodes(tree).find(n=>n.type===List);assert.equal(list.props.events[0],events[0]);assert.equal(list.props.canUpdate,false);
});

test('detail slots reuse LINE, dispatch, quotes, photos, calendar, timeline and owner UI with original permissions',()=>{
 const h=harness();const Stub=()=>null,Tabs=()=>null,List=()=>null;
 const imports={'react':h.hooks,'react/jsx-runtime':jsx,'next/navigation':{useRouter:()=>({refresh(){}})},
  './actions':{},'./photo-actions':{},'./repair-pdf-button':{default:Stub},'@/app/components/repair-image':{default:Stub},
  './estimate-section':{default:Stub},'./message-section':{MessageSection:Stub},'./vendor-quote-upload-form':{VendorQuoteUploadForm:Stub},
  './vendor-dispatch-section':{VendorDispatchSection:Stub},'./repair-calendar-section':{default:Stub},'./repair-list':{default:List},
  './repair-list-state':helper,'./repair-detail-tabs':{default:Tabs},'./message-attachment':{default:Stub},'next/link':{default:Stub}};
 const Admin=load('./admin-repairs.tsx',imports).default;
 for(const canUpdate of [false,true]) {
  h.reset();const tree=Admin({repairs:[repair],canUpdate,replyScope:'scope'});
  const render=nodes(tree).find(n=>n.type===List).props.renderDetail;
  const detail=render({...repair,vendor_dispatches:[{id:'d',status:'dispatched',events:[],messages:[]}],owner_report_estimates:{files:[]}},true,true);
  assert.equal(detail.type,Tabs);const s=detail.props.sections;
  assert.equal(s.line.props.canUpdate,canUpdate);assert.equal(s.line.props.replyScope,'scope');
  assert.equal(s.vendors.props.canUpdate,canUpdate);assert.equal(s.owner.props.canUpdate,canUpdate);
  assert.equal(s.schedule.props.view,'events');assert.equal(s.history.props.view,'history');
  assert.equal(nodes(s.estimates).filter(n=>n.props?.dispatchId==='d').length,canUpdate?1:0);
  assert.equal(nodes(s.overview).find(n=>n.type==='textarea').props.readOnly,!canUpdate);
  assert.ok(nodes(s.overview).filter(n=>n.type==='button').every(n=>n.props.disabled===!canUpdate));
  assert.ok(nodes(s.files).some(n=>n.type===Stub&&n.props.repairId===1));
  assert.equal(render(repair,false,true).props.sections.schedule.props.view,'all');
 }
});
