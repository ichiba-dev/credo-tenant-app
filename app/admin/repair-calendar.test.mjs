import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
function load(file,imports={},globals={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>{if(name in imports)return imports[name];throw Error(name);},...globals});return exports;
}
const state=load('./calendar-state.ts');
const grid=load('./calendar/month-grid.ts',{'../calendar-state':state});
const scheduler=load('./calendar/scheduler.ts',{'../calendar-state':state,'./month-grid':grid});
const helpers=load('./repair-calendar-state.ts',{'./calendar-state':state,'./calendar/scheduler':scheduler});
const imports={'react':React,'react/jsx-runtime':jsx,'./calendar-state':state,'./calendar/scheduler':scheduler,'./repair-calendar-state':helpers,'./repair-calendar-actions':{}};
const {RepairCalendarContent:Content}=load('./repair-calendar-section.tsx',imports);
const event={id:'11111111-1111-4111-8111-111111111111',title:'現地確認の予定',event_type:'site_visit',starts_at:'2026-09-25T03:00:00Z',ends_at:'2026-09-25T04:00:00Z',all_day:false,status:'scheduled',repair_request_id:1,vendor_dispatch_id:null,notes:'鍵を持参',source_type:'repair',updated_at:'2026-09-25T05:15:00Z'};
const repair={id:1,history:'2026/9/25 11:00:00　受付\n日時不明の既存記録',status:'受付',vendor_dispatches:[{id:'dispatch',vendorName:'確認業者',status:'dispatched'}]};
const render=events=>renderToStaticMarkup(React.createElement(Content,{repair,events,loading:false,error:false}));
function reader({ok=true,error=false,rows=[],failPage=-1}={}) {
 const calls=[];
 const supabase={from(table){const filters=[];const call={table,filters};calls.push(call);return {select(){return this;},eq(k,v){filters.push([k,v]);return this;},order(){return this;},async range(from,to){assert.equal(table,'calendar_events');const selected=rows.filter(row=>filters.every(([k,v])=>row[k]===v));return {error:error||from===failPage,data:selected.slice(from,to+1)};}};}};
 const mod=load('./repair-calendar-actions.ts',{'@/lib/supabase-auth/staff':{getStaffContext:async()=>({ok,canUpdate:false,organizationId:'org-a',supabase})}});
 return {...mod,calls};
}
test('repair calendar read scopes every page to organization and repair, includes all statuses and allows viewer',async()=>{
 const rows=[...Array.from({length:501},(_,i)=>({...event,id:String(i),organization_id:'org-a',status:i===0?'completed':i===1?'cancelled':'scheduled'})),{...event,id:'other-repair',organization_id:'org-a',repair_request_id:2},{...event,id:'foreign',organization_id:'org-b'}];
 const api=reader({rows});const result=await api.readRepairCalendar(1);
 assert.equal(result.ok,true);assert.equal(result.events.length,501);assert.equal(api.calls.length,2);
 for(const call of api.calls){assert.ok(call.filters.some(([k,v])=>k==='organization_id'&&v==='org-a'));assert.ok(call.filters.some(([k,v])=>k==='repair_request_id'&&v===1));}
 assert.equal(result.events[0].status,'completed');assert.equal(result.events[1].status,'cancelled');
 rows[2].title='最新のタイトル';rows[2].starts_at='2026-09-25T03:30:00Z';
 const updated=await api.readRepairCalendar(1);assert.equal(updated.events[2].title,'最新のタイトル');assert.equal(updated.events[2].starts_at,rows[2].starts_at);
 assert.equal((await reader({rows,failPage:500}).readRepairCalendar(1)).events.length,0);
});
test('unauthenticated/invalid repair reads do not query; failures differ from zero events',async()=>{
 const denied=reader({ok:false});assert.equal((await denied.readRepairCalendar(1)).ok,false);assert.equal(denied.calls.length,0);
 const api=reader();for(const id of [0,-1,'1',null])assert.equal((await api.readRepairCalendar(id)).ok,false);assert.equal(api.calls.length,0);
 assert.equal((await api.readRepairCalendar(1)).ok,true);assert.equal((await reader({error:true}).readRepairCalendar(1)).ok,false);
 assert.match(render([]),/紐付いた予定はありません/);assert.match(render([]),/日時不明の既存記録/);
});
test('repair schedule shows fields, distinct statuses, dispatch association and selected-day calendar link',()=>{
 const html=render([{...event,status:'completed',vendor_dispatch_id:'dispatch'},{...event,id:'cancel',status:'cancelled'},{...event,id:'future',starts_at:'2026-09-28T01:00:00Z',status:'scheduled'},{...event,id:'other',repair_request_id:2,title:'別案件だけの予定'}]);
 for(const text of ['現地確認','12:00〜13:00','鍵を持参','完了','キャンセル','予定','確認業者','dispatch'])assert.ok(html.includes(text));
 assert.doesNotMatch(html,/別案件だけの予定/);assert.match(html,/\/admin\/calendar\?month=2026-09&amp;day=2026-09-25&amp;view=day/);
 const items=helpers.repairCalendarEvents([{...event,status:'completed'},{...event,id:'future',starts_at:'2026-09-28T01:00:00Z'}],1);assert.equal(items[0].id,'future');
 assert.doesNotMatch(html,/<button|<form/);
});
test('timeline merges existing JST history and calendar, with actual status update time rather than planned end',()=>{
 const entries=helpers.repairCalendarTimeline(repair.history,[{...event,status:'completed'},{...event,id:'cancel',status:'cancelled'}]);
 assert.equal(entries[0].text,'受付');assert.equal(entries[0].at,'2026-09-25T02:00:00.000Z');
 const done=entries.find(e=>e.id===event.id+'-closed');assert.equal(done.at,event.updated_at);assert.match(done.text,/予定を完了/);assert.notEqual(done.at,event.ends_at);
 assert.match(entries.find(e=>e.id==='cancel-closed').text,/予定をキャンセル/);
 assert.equal(entries.at(-1).text,'日時不明の既存記録');
 assert.equal(helpers.repairCalendarTimeline(null,[event]).length,1);
});
test('completing a calendar event only writes calendar_events and removes it from scheduled today/tomorrow',async()=>{
 const calls=[];const original=JSON.stringify(repair);
 const supabase={from(table){calls.push(table);assert.equal(table,'calendar_events');return {update(fields){assert.deepEqual(Object.keys(fields),['status']);event.status=fields.status;return this;},eq(){return this;},select(){return this;},async maybeSingle(){return {data:{id:event.id},error:null};}};}};
 const actions=load('./calendar-actions.ts',{'next/cache':{revalidatePath(){}},'./calendar-state':state,'@/lib/supabase-auth/staff':{getStaffContext:async()=>({ok:true,canUpdate:true,organizationId:'org-a',supabase})}});
 try {assert.equal((await actions.changeCalendarStatus(event.id,'completed')).ok,true);assert.equal(state.upcomingDays([event],Date.parse('2026-09-25T00:00:00Z'))[0].events.length,0);assert.match(render([event]),/予定を完了/);assert.equal(JSON.stringify(repair),original);assert.deepEqual(calls,['calendar_events']);} finally {event.status='scheduled';}
});
test('reopening and returning to repair reloads current events, ignores stale responses and preserves failure state',async()=>{
 const listeners={},pending=[];let effect,stored;
 const detail={open:true,addEventListener:(name,fn)=>{listeners[name]=fn;},removeEventListener:name=>{delete listeners[name];}};
 const hooks={...React,useRef:()=>({current:{closest:()=>detail}}),useState:initial=>[stored??initial,value=>{stored=value;}],useEffect:fn=>{effect=fn;}};
 const Section=load('./repair-calendar-section.tsx',{...imports,'react':hooks,'./repair-calendar-actions':{readRepairCalendar:()=>new Promise(resolve=>pending.push(resolve))}},{window:{addEventListener:(name,fn)=>{listeners[name]=fn;},removeEventListener:name=>{delete listeners[name];}}}).default;
 Section({repair});const cleanup=effect();assert.equal(pending.length,1);
 listeners.toggle();assert.equal(pending.length,2);
 pending[1]({ok:true,events:[{...event,title:'最新'}]});await new Promise(resolve=>setImmediate(resolve));assert.equal(stored.events[0].title,'最新');
 pending[0]({ok:true,events:[{...event,title:'旧値'}]});await new Promise(resolve=>setImmediate(resolve));assert.equal(stored.events[0].title,'最新');
 listeners.focus();assert.equal(stored.loading,true);assert.equal(stored.events.length,0);pending[2]({ok:false,events:[]});await new Promise(resolve=>setImmediate(resolve));assert.equal(stored.error,true);
 detail.open=false;listeners.toggle();assert.equal(pending.length,3);cleanup();assert.equal(Object.keys(listeners).length,0);
});
