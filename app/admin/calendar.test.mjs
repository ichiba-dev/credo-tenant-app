import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
function load(file,imports={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,require:name=>{if(name in imports)return imports[name];throw Error(name);},FormData});return exports;
}
const state=load('./calendar-state.ts');
const grid=load('./calendar/month-grid.ts',{'../calendar-state':state});
const Link=({children,...props})=>React.createElement('a',props,children);
const id='11111111-1111-4111-8111-111111111111',dispatch='33333333-3333-4333-8333-333333333333';
const input={id,repairId:1,dispatchId:dispatch,eventType:'site_visit',date:'2026-09-26',start:'10:00',end:'11:00',allDay:false,notes:'現調',edit:false};
const event={id,title:'物件 302号室 現調',event_type:'site_visit',starts_at:'2026-09-26T01:00:00Z',ends_at:null,
 all_day:false,status:'scheduled',repair_request_id:1,vendor_dispatch_id:dispatch,notes:null,source_type:'vendor_dispatch'};
test('calendar input validates JST dates, same-day end, all-day, repair/dispatch and lengths',()=>{
 const result=state.parseCalendarInput(input);assert.equal(result.starts,'2026-09-26T01:00:00.000Z');
 for(const change of [{date:'2026-02-30'},{start:'25:00'},{end:'09:00'},{end:'10:00'},{repairId:-1},{repairId:'1'},
  {dispatchId:'bad'},{eventType:'unknown'},{notes:'x'.repeat(3001)},{allDay:'false'}])assert.equal(state.parseCalendarInput({...input,...change}),null);
 const all=state.parseCalendarInput({...input,allDay:true,start:'',end:''});
 assert.equal(all.starts,'2026-09-25T15:00:00.000Z');assert.equal(all.ends,'2026-09-26T15:00:00.000Z');
 assert.equal(state.parseCalendarInput({...input,dispatchId:null}).dispatchId,null);
});
test('today/tomorrow use Japan midnight, overlap and exclusive end; closed events are omitted',()=>{
 const now=Date.parse('2026-09-25T15:00:00Z');assert.equal(state.japanDay(now),'2026-09-26');
 const events=[event,{...event,id:'tomorrow',starts_at:'2026-09-26T15:00:00Z'},
  {...event,id:'ended',starts_at:'2026-09-25T01:00:00Z',ends_at:'2026-09-25T15:00:00Z'},
  {...event,id:'spanning',starts_at:'2026-09-25T14:00:00Z',ends_at:'2026-09-25T16:00:00Z'},
  {...event,id:'completed',status:'completed'},{...event,id:'cancelled',status:'cancelled'}];
 const days=state.upcomingDays(events,now);
 assert.deepEqual(Array.from(days[0].events,e=>e.id),['spanning',id]);
 assert.deepEqual(Array.from(days[1].events,e=>e.id),['tomorrow']);
 assert.equal(state.eventsOnDay(events,'2026-09-26').length,4);
 assert.equal(state.nextDay('2026-12-31'),'2027-01-01');
});
test('overdue scheduled events only; all-day waits until exclusive end',()=>{
 const start=Date.parse(event.starts_at);
 assert.equal(state.isOverdue(event,start),false);assert.equal(state.isOverdue(event,start+1),true);
 for(const status of ['completed','cancelled'])assert.equal(state.isOverdue({...event,status},start+1),false);
 const all={...event,all_day:true,ends_at:'2026-09-26T15:00:00Z'};
 assert.equal(state.isOverdue(all,start+1),false);assert.equal(state.isOverdue(all,Date.parse(all.ends_at)+1),true);
 const past={...event,id:'past',starts_at:'2026-09-24T01:00:00Z'};
 assert.deepEqual(Array.from(state.pastPendingEvents([event,past,{...past,id:'closed',status:'completed'}],start+1),e=>e.id),['past']);
});
function actions({canUpdate=true,ok=true,missingRepair=false,missingDispatch=false}={}) {
 const calls=[];const supabase={from(table){
  const entry={table,filters:[]};calls.push(entry);
  const query={select(){return query;},eq(key,value){entry.filters.push([key,value]);return query;},is(key,value){entry.filters.push([key,value]);return query;},
   insert(data){entry.insert=data;return query;},update(data){entry.update=data;return query;},
   async maybeSingle(){return {error:null,data:table==='repair_requests'?(missingRepair?null:{id:1,property_name:'物件',room_number:'302',category:'エアコン'}):
    table==='repair_vendor_dispatches'?(missingDispatch?null:{id:dispatch}):{id}};}};return query;
 }};
 const mod=load('./calendar-actions.ts',{'next/cache':{revalidatePath(){}},'@/lib/supabase-auth/staff':{getStaffContext:async()=>({ok,canUpdate,supabase,organizationId:'server-org',userId:'server-user'})},'./calendar-state':state});
 return {mod,calls};
}
test('server create derives organization, actor, title, source and validates repair/dispatch in same org',async()=>{
 const {mod,calls}=actions();assert.equal((await mod.saveCalendarEvent({...input,organization_id:'evil',created_by:'evil',title:'evil'})).ok,true);
 const row=calls.find(c=>c.insert).insert;assert.equal(row.organization_id,'server-org');assert.equal(row.created_by,'server-user');
 assert.equal(row.repair_request_id,1);assert.equal(row.vendor_dispatch_id,dispatch);assert.equal(row.source_type,'vendor_dispatch');
 assert.match(row.title,/物件 302号室 - エアコン 現調/);
 for(const call of calls.filter(c=>!c.insert))assert.ok(call.filters.some(([k,v])=>k==='organization_id'&&v==='server-org'));
 const repairOnly=actions();assert.equal((await repairOnly.mod.saveCalendarEvent({...input,dispatchId:null})).ok,true);
 assert.equal(repairOnly.calls.find(c=>c.insert).insert.source_type,'repair');
});
test('viewer/unauthenticated denied before queries; foreign or absent repair/dispatch denied before insert',async()=>{
 for(const options of [{canUpdate:false},{ok:false}]) {
  const {mod,calls}=actions(options);assert.equal((await mod.saveCalendarEvent(input)).ok,false);
  assert.equal((await mod.changeCalendarStatus(id,'completed')).ok,false);assert.equal(calls.length,0);
 }
 for(const options of [{missingRepair:true},{missingDispatch:true}]){
  const {mod,calls}=actions(options);assert.equal((await mod.saveCalendarEvent(input)).ok,false);assert.ok(calls.every(c=>!c.insert));
 }
});
test('edit/complete/cancel scope to server organization and scheduled state without deleting',async()=>{
 const {mod,calls}=actions();assert.equal((await mod.saveCalendarEvent({...input,edit:true})).ok,true);
 for(const status of ['completed','cancelled'])assert.equal((await mod.changeCalendarStatus(id,status)).ok,true);
 assert.equal((await mod.changeCalendarStatus(id,'deleted')).ok,false);
 for(const call of calls.filter(c=>c.update)) {
  assert.ok(call.filters.some(([k,v])=>k==='organization_id'&&v==='server-org'));
  assert.ok(call.filters.some(([k,v])=>k==='status'&&v==='scheduled'));
 }
});
test('calendar reads scope every page to organization, keep overlaps and retain older scheduled events',async()=>{
 const calls=[];let page=0;
 const context={organizationId:'server-org',supabase:{from(){const call=[];calls.push(call);
  const q={select(){return q;},eq(k,v){call.push([k,v]);return q;},lt(k,v){call.push([k,v]);return q;},
   or(v){call.push(['overlap',v]);return q;},order(){return q;},async range(){return {error:null,data:page++===0?Array(500).fill(event):[event]};}};return q;}}};
 const {getCalendarEvents}=load('./calendar-data.ts',{'server-only':{}});
 assert.equal((await getCalendarEvents(context,'2026-09-01T00:00:00+09:00','2026-10-01T00:00:00+09:00')).length,501);
 for(const call of calls){assert.ok(call.some(([k,v])=>k==='organization_id'&&v==='server-org'));assert.ok(call.some(([k,v])=>k==='overlap'&&v.includes('ends_at.gt.')));}
 calls.length=0;await getCalendarEvents(context,null,'2026-09-28T00:00:00+09:00');
 assert.ok(calls[0].some(([k,v])=>k==='status'&&v==='scheduled'));assert.ok(!calls[0].some(([k])=>k==='overlap'));
});
const imports={'react':React,'react/jsx-runtime':jsx,'next/navigation':{useRouter:()=>({refresh(){}})},'./calendar-state':state};
const Lists=load('./calendar-events-list.tsx',{...imports,'./calendar-actions':{},'./calendar-event-form':{default:()=>null}}).default;
test('event UI preserves repair jump and overdue badge; viewer hides mutations; closed history visible',()=>{
 const render=(canUpdate,events=[event])=>renderToStaticMarkup(React.createElement(Lists,{events,canUpdate,now:Date.parse(event.starts_at)+1}));
 assert.match(render(false),/href="\/admin#repair-detail-1"/);assert.match(render(false),/予定時刻経過/);assert.doesNotMatch(render(false),/<button/);
 assert.match(render(true),/完了/);assert.match(render(true),/キャンセル/);
 assert.doesNotMatch(render(true,[{...event,status:'completed'}]),/予定時刻経過|<button/);
 const source=readFileSync(new URL('./repair-list.tsx',import.meta.url),'utf8');assert.match(source,/hashchange/);assert.match(source,/setVisited/);
});
test('overview renders no empty cards and calendar month/day view includes event counts',()=>{
 const Overview=load('./calendar-overview.tsx',{...imports,'./calendar-events-list':{default:Lists}}).default;
 const now=Date.parse('2026-09-26T00:00:00Z');
 assert.doesNotMatch(renderToStaticMarkup(React.createElement(Overview,{events:[],initialNow:now,canUpdate:false})),/<section/);
 const html=renderToStaticMarkup(React.createElement(Overview,{events:[event],initialNow:now,canUpdate:false}));
 assert.match(html,/今日の予定 1件/);assert.doesNotMatch(html,/明日の予定/);
 const View=load('./calendar/calendar-view.tsx',{'react':React,'react/jsx-runtime':jsx,'../calendar-state':state,'./month-grid':grid,'next/link':{default:Link},'../calendar-events-list':{default:Lists}}).default;
 const month=renderToStaticMarkup(React.createElement(View,{events:[event],month:'2026-09',initialDay:'2026-09-26',initialNow:now,canUpdate:false}));
 assert.match(month,/2026-09-26 予定1件/);assert.match(month,/物件 302号室/);
});

test('month grid has full Sunday weeks, adjacent dates, leap day and year navigation',()=>{
 for(const [month,length,first,last] of [['2026-09',35,'2026-08-30','2026-10-03'],['2026-08',42,'2026-07-26','2026-09-05'],['2026-02',35,'2026-02-01','2026-03-07']]) {
  const days=grid.monthDays(month);assert.equal(days.length,length);assert.equal(days[0],first);assert.equal(days.at(-1),last);
 }
 assert.ok(grid.monthDays('2028-02').includes('2028-02-29'));
 assert.equal(grid.shiftMonth('2026-12',1),'2027-01');assert.equal(grid.shiftMonth('2026-01',-1),'2025-12');
});
test('calendar selection, today reset, overflow, repair links and mobile indicators share events',()=>{
 let values=[],cursor=0;
 const hooks={...React,useEffect(){},useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=v;}];}};
 const View=load('./calendar/calendar-view.tsx',{'react':hooks,'react/jsx-runtime':jsx,'next/link':{default:Link},'./month-grid':grid,
  '../calendar-state':state,'../calendar-events-list':{default:Lists}}).default;
 const props={events:Array.from({length:6},(_,i)=>({...event,id:String(i),status:i===5?'cancelled':'scheduled'})),month:'2026-09',initialDay:'2026-09-26',initialNow:Date.parse('2026-09-26T00:00:00Z'),canUpdate:false};
 const render=()=>{cursor=0;return View(props);};
 const nodes=(n)=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
 let tree=render(),html=renderToStaticMarkup(tree);
 assert.match(html,/aria-current="date"/);assert.match(html,/他3件/);assert.match(html,/href="\/admin#repair-detail-1"/);
 assert.match(html,/md:hidden/);assert.match(html,/md:block/);assert.match(html,/9月26日の予定/);assert.match(html,/キャンセル/);
 assert.match(html,/month=2026-08/);assert.match(html,/month=2026-10/);
 nodes(tree).find(n=>n.props?.['aria-label']==='2026-09-27 予定0件').props.onClick();
 tree=render();html=renderToStaticMarkup(tree);assert.match(html,/9月27日の予定/);assert.match(html,/予定はありません/);
 nodes(tree).find(n=>n.type==='button'&&n.props.children==='今日').props.onClick();
 html=renderToStaticMarkup(render());assert.match(html,/9月26日の予定/);
 props.events=[];assert.match(renderToStaticMarkup(render()),/予定はありません/);
 props.month='2026-10';assert.match(renderToStaticMarkup(render()),/href="\?month=2026-09"/);
});
