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
const Link=({children,scroll,...props})=>React.createElement('a',props,children);
const scheduler=load('./calendar/scheduler.ts',{'../calendar-state':state,'./month-grid':grid});
const Month=load('./calendar/calendar-month.tsx',{'react/jsx-runtime':jsx,'../calendar-state':state,'./month-grid':grid}).default;
const Timeline=load('./calendar/calendar-timeline.tsx',{'react/jsx-runtime':jsx,'../calendar-state':state,'./scheduler':scheduler}).default;
const viewImports={'./scheduler':scheduler,'./calendar-month':{default:Month},'./calendar-timeline':{default:Timeline},'next/navigation':{useRouter:()=>({push(){}})}};
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
 const View=load('./calendar/calendar-view.tsx',{...viewImports,'react':React,'react/jsx-runtime':jsx,'../calendar-state':state,'./month-grid':grid,'next/link':{default:Link},'../calendar-events-list':{default:Lists}}).default;
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
test('calendar modes, navigation, selection and filters preserve repair links and mobile month',()=>{
 let values=[],cursor=0,navigated='';
 const hooks={...React,useEffect(){},useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=v;}];}};
 const View=load('./calendar/calendar-view.tsx',{...viewImports,'react':hooks,'react/jsx-runtime':jsx,'next/link':{default:Link},'./month-grid':grid,
  'next/navigation':{useRouter:()=>({push(url){navigated=url;}})},'../calendar-state':state,'../calendar-events-list':{default:Lists}}).default;
 const props={events:Array.from({length:6},(_,i)=>({...event,id:String(i),status:i===5?'cancelled':'scheduled'})),month:'2026-09',initialDay:'2026-09-26',initialNow:Date.parse('2026-09-26T00:00:00Z'),canUpdate:false};
 const render=()=>{cursor=0;return View(props);};
 const nodes=(n)=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
 let tree=render(),html=renderToStaticMarkup(tree);
 assert.match(html,/aria-current="date"/);assert.match(html,/他3件/);assert.match(html,/href="\/admin#repair-detail-1"/);
 assert.match(html,/md:hidden/);assert.match(html,/md:block/);assert.match(html,/9月26日の予定/);assert.match(html,/キャンセル/);
 assert.match(html,/週タイムライン/);assert.match(html,/9\/21 - 9\/27/);assert.match(html,/day=2026-10-03/);
 const calendar=nodes(tree).find(n=>n.type===Month);
 calendar.props.onSelect('2026-09-27');assert.match(navigated,/day=2026-09-27/);
 props.initialDay='2026-09-27';
 tree=render();html=renderToStaticMarkup(tree);assert.match(html,/9月27日の予定/);assert.match(html,/予定はありません/);
 const today=nodes(tree).find(n=>n.type===Link&&n.props.children==='今日');assert.match(today.props.href,/day=2026-09-26/);
 props.initialDay='2026-09-26';
 tree=render();nodes(tree).find(n=>n.type==='input').props.onChange({target:{checked:false}});
 html=renderToStaticMarkup(render());assert.doesNotMatch(html,/href="\/admin#repair-detail-1"/);assert.match(html,/絞り込み中/);
 tree=render();nodes(tree).find(n=>n.type==='button'&&n.props.children==='すべて表示').props.onClick();
 props.mode='month';html=renderToStaticMarkup(render());assert.doesNotMatch(html,/週タイムライン|日タイムライン/);assert.match(html,/他3件/);
 props.mode='day';tree=render();html=renderToStaticMarkup(tree);assert.match(html,/日タイムライン/);assert.doesNotMatch(html,/週タイムライン/);
 assert.equal(nodes(tree).find(n=>n.type===Timeline).props.days.length,1);
 props.mode='week';assert.match(renderToStaticMarkup(render()),/週タイムライン/);
});

test('scheduler uses Monday weeks, clamped months, and ranges including month-crossing Sunday',()=>{
 assert.deepEqual(Array.from(scheduler.weekDays('2026-09-27')),['2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-26','2026-09-27']);
 assert.equal(scheduler.moveDate('2026-12-28','week',1),'2027-01-04');
 assert.equal(scheduler.moveDate('2026-01-31','month',1),'2026-02-28');
 assert.equal(scheduler.moveDate('2028-01-31','month',1),'2028-02-29');
 assert.equal(scheduler.moveDate('2026-12-31','day',1),'2027-01-01');
 const range=scheduler.calendarRange('2026-09','2026-09-30');
 assert.equal(range.from,'2026-08-30');assert.equal(range.until,'2026-10-05');
});

test('timeline duration, adjacent appointments, overlaps, missing ends and midnight splits',()=>{
 const make=(id,start,end)=>({...event,id,starts_at:`2026-09-26T${start}:00+09:00`,ends_at:end?`2026-09-26T${end}:00+09:00`:null});
 const events=[make('long','10:00','11:30'),make('overlap','10:30','11:00'),make('adjacent','11:30','12:00'),make('unknown','13:00',null)];
 const slots=scheduler.layoutDay(events,'2026-09-26');
 assert.equal(slots[0].end-slots[0].start,90);assert.equal(slots[0].lanes,2);assert.equal(slots[1].lane,1);
 assert.equal(slots[2].lanes,1);assert.equal(slots[3].end-slots[3].start,30);assert.match(scheduler.timeLabel(events[3]),/終了未定/);
 const spanning={...event,starts_at:'2026-09-25T23:00:00+09:00',ends_at:'2026-09-26T01:30:00+09:00'};
 const split=scheduler.layoutDay([spanning],'2026-09-26')[0];assert.equal(split.start,0);assert.equal(split.end,90);
 assert.equal(scheduler.layoutDay([{...spanning,ends_at:'2026-09-26T00:00:00+09:00'}],'2026-09-26').length,0);
 const bounds=scheduler.timeBounds([spanning,make('late','22:00','23:30')],['2026-09-26']);assert.equal(bounds.start,0);assert.equal(bounds.end,1440);
 assert.equal(scheduler.layoutDay([{...event,all_day:true}],'2026-09-26').length,0);
});

test('timeline renders proportional blocks, all-day events, now marker, status and accessible details',()=>{
 const props={events:[{...event,ends_at:'2026-09-26T02:30:00Z'}, {...event,id:'all',all_day:true,title:'終日作業',status:'completed'},
 {...event,id:'cancel',title:'取消作業',status:'cancelled'}],days:scheduler.weekDays('2026-09-26'),day:'2026-09-26',now:Date.parse('2026-09-26T01:30:00Z'),onSelect(){}};
 const html=renderToStaticMarkup(React.createElement(Timeline,props));
 assert.match(html,/height:108px/);assert.match(html,/10:00〜11:30/);assert.match(html,/現地確認/);
 assert.match(html,/終日作業/);assert.match(html,/opacity-60/);assert.match(html,/現在時刻/);assert.match(html,/キャンセル/);assert.match(html,/aria-label="10:00/);
 assert.match(html,/href="\/admin#repair-detail-1"/);
 assert.doesNotMatch(renderToStaticMarkup(React.createElement(Timeline,{...props,days:['2026-09-27']})),/現在時刻|終日作業/);
});

test('calendar page loads the complete cross-month week, validates date and preserves view',async()=>{
 const calls=[];
 const View=()=>null;
 const Page=load('./calendar/page.tsx',{'react/jsx-runtime':jsx,'next/link':{default:Link},
  'next/navigation':{redirect(){throw Error('redirect');}},
  '@/lib/supabase-auth/staff':{getStaffContext:async()=>({ok:true,canUpdate:false})},
  '../calendar-data':{getCalendarEvents:async(context,from,until)=>{calls.push({from,until});return [event];}},
  '../calendar-state':state,'./scheduler':scheduler,'./calendar-view':{default:View}}).default;
 const nodes=(n)=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
 let tree=await Page({searchParams:Promise.resolve({month:'2026-09',day:'2026-09-30',view:'week'})});
 assert.equal(calls[0].until,'2026-10-05T00:00:00+09:00');
 let props=nodes(tree).find(n=>n.type===View).props;
 assert.equal(props.initialDay,'2026-09-30');assert.equal(props.mode,'week');assert.equal(props.canUpdate,false);
 tree=await Page({searchParams:Promise.resolve({month:'2028-02',day:'2028-02-30',view:'invalid'})});
 props=nodes(tree).find(n=>n.type===View).props;
 assert.equal(props.initialDay,'2028-02-01');assert.equal(props.mode,'auto');
 tree=await Page({searchParams:Promise.resolve({month:'2026-09',day:'2026-10-01',view:'day'})});
 props=nodes(tree).find(n=>n.type===View).props;
 assert.equal(props.month,'2026-10');assert.equal(props.mode,'day');
});
