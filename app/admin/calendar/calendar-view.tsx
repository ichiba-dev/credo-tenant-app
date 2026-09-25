"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { eventsOnDay, japanDay, type CalendarEvent } from "../calendar-state";
import { monthDays, shiftMonth } from "./month-grid";
import { calendarDraft, moveDate, TYPE_LABELS, typeLabel, weekDays, type CalendarMode } from "./scheduler";
import CalendarEventsList from "../calendar-events-list";
import CalendarMonth from "./calendar-month";
import CalendarTimeline from "./calendar-timeline";

import CalendarEventDialog, {type CalendarDraft} from "./calendar-event-dialog";

const control = "rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#0b2e59]";
const shortDate = (day: string) => `${Number(day.slice(5,7))}/${Number(day.slice(-2))}`;

export default function CalendarView({events,month,initialDay,initialNow,canUpdate,mode='auto'}: {
  events:CalendarEvent[];month:string;initialDay:string;initialNow:number;canUpdate:boolean;mode?:CalendarMode;
}) {
  const router = useRouter();
  const day = initialDay;
  const [panel,setPanel]=useState<{eventId?:string;draft?:CalendarDraft}|null>(null);
  const openEvent=(event:CalendarEvent)=>setPanel({eventId:event.id});
  const create=(date:string,minutes=540)=>{if(canUpdate)setPanel({draft:calendarDraft(date,minutes)});};
  const [now,setNow] = useState(initialNow);
  // A filter group can be extended without introducing fictitious assignee/store data.
  const [filters,setFilters] = useState<{hiddenTypes:string[]}>({hiddenTypes:[]});
  useEffect(() => {const timer=setInterval(() => setNow(Date.now()),60000);return () => clearInterval(timer);},[]);
  const today=japanDay(now), week=weekDays(day);
  const visible=events.filter(e => !filters.hiddenTypes.includes(e.event_type));
  const selected=eventsOnDay(visible,day);
  const types=Array.from(new Set([...Object.keys(TYPE_LABELS), ...events.map(e => e.event_type)]));
  const desktopMode=mode==='auto'?'week':mode;
  const mobileMode=mode==='day'?'day':'month';
  const href=(date:string,view:CalendarMode=mode) => `?month=${date.slice(0,7)}&day=${date}&view=${view}`;
  const selectDay=(date:string) => router.push(href(date), {scroll:false});
  const toolbar=(view:'month'|'week'|'day',mobile:boolean) => <div className={mobile?'md:hidden':'hidden md:flex md:flex-1'}>
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <nav aria-label={mobile?'スマホ表示期間':'表示期間'} className="flex flex-wrap items-center gap-2">
        <Link scroll={false} className={control} href={href(today)}>今日</Link>
        <Link scroll={false} className={control} href={href(moveDate(day,view,-1))} aria-label={`前${view==='month'?'月':view==='week'?'週':'日'}`}>‹ <span className="sr-only sm:not-sr-only">前{view==='month'?'月':view==='week'?'週':'日'}</span></Link>
        <Link scroll={false} className={control} href={href(moveDate(day,view,1))} aria-label={`次${view==='month'?'月':view==='week'?'週':'日'}`}><span className="sr-only sm:not-sr-only">次{view==='month'?'月':view==='week'?'週':'日'}</span> ›</Link>
        <h2 aria-live="polite" className="text-base font-bold">{view==='month'?`${Number(month.slice(0,4))}年${Number(month.slice(5))}月`:view==='week'?`${day.slice(0,4)}年 ${shortDate(week[0])} - ${shortDate(week[6])}`:`${day.slice(0,4)}年 ${shortDate(day)}`}</h2>
      </nav>
      <nav aria-label={mobile?'スマホ表示切替':'表示切替'} className="flex rounded-md border border-slate-200 bg-white p-0.5">
        {(mobile?['month','day'] as const:['month','week','day'] as const).map(v => <Link key={v} scroll={false} href={href(day,v)} aria-current={view===v?'page':undefined}
          className={`rounded px-4 py-1.5 text-sm focus-visible:outline-2 ${view===v?'bg-[#0b2e59] text-white':'hover:bg-slate-100'}`}>{v==='month'?'月':v==='week'?'週':'日'}</Link>)}
      </nav>
    </div>
  </div>;
  return <>
    <header className="mb-4 text-[#0b2e59]">{toolbar(desktopMode,false)}{toolbar(mobileMode,true)}<p className="mt-2 text-xs text-slate-500">日本時間 · 予定をクリックすると詳細を開きます{canUpdate?' · 空き時間から予定を作成できます':''}</p></header>
    <div className="flex items-start gap-4">
      <aside aria-label="カレンダーとフィルター" className="hidden w-52 shrink-0 space-y-6 rounded-lg border border-slate-200 bg-white p-3 md:block">
        <section aria-label="ミニ月間カレンダー">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold text-[#0b2e59]">
            <Link scroll={false} className="rounded p-2 hover:bg-slate-100" aria-label="ミニカレンダー前月" href={href(shiftMonth(month,-1)+'-01')}>‹</Link>
            <span>{Number(month.slice(0,4))}年{Number(month.slice(5))}月</span>
            <Link scroll={false} className="rounded p-2 hover:bg-slate-100" aria-label="ミニカレンダー次月" href={href(shiftMonth(month,1)+'-01')}>›</Link>
          </div>
          <div className="grid grid-cols-7 text-center text-xs">
            {['日','月','火','水','木','金','土'].map(d => <span key={d} className="py-1 text-slate-500">{d}</span>)}
            {monthDays(month).map(d => <button key={d} type="button" onClick={() => selectDay(d)} aria-label={`ミニカレンダー ${d}`} aria-pressed={d===day} aria-current={d===today?'date':undefined}
              className={`rounded py-1.5 focus-visible:outline-2 ${d===day?'bg-[#0b2e59] text-white':d===today?'bg-blue-100 font-bold text-[#0b2e59]':!d.startsWith(month)?'text-slate-400':week.includes(d)&&desktopMode==='week'?'bg-slate-100':'hover:bg-slate-100'}`}>{Number(d.slice(-2))}</button>)}
          </div>
        </section>
        <fieldset className="space-y-2"><legend className="mb-3 text-sm font-bold text-[#0b2e59]">予定種類</legend>
          {types.map(type => <label key={type} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4 accent-[#0b2e59]" checked={!filters.hiddenTypes.includes(type)}
            onChange={e => setFilters({hiddenTypes:e.target.checked?filters.hiddenTypes.filter(t => t!==type):[...filters.hiddenTypes,type]})}/>{typeLabel(type)}</label>)}
        </fieldset>
      </aside>
      <div className="min-w-0 flex-1">
        {filters.hiddenTypes.length>0&&<p role="status" className="mb-2 flex items-center gap-3 text-xs text-slate-600">予定種類で絞り込み中<button type="button" className="underline" onClick={() => setFilters({hiddenTypes:[]})}>すべて表示</button></p>}
        <div className={desktopMode==='month'?'':'md:hidden'}>
          {mobileMode==='month' || desktopMode==='month' ? <CalendarMonth events={visible} month={month} day={day} today={today} onSelect={selectDay} onEvent={openEvent}/> : null}
        </div>
        {desktopMode==='week'&&<div className="hidden md:block"><CalendarTimeline events={visible} days={week} day={day} now={now} onSelect={selectDay} onEvent={openEvent} onCreate={canUpdate?create:undefined}/></div>}
        {desktopMode==='day'&&<CalendarTimeline events={visible} days={[day]} day={day} now={now} onSelect={selectDay} onEvent={openEvent} onCreate={canUpdate?create:undefined}/>}
        <section id="selected-day-events" className="mt-4 min-w-0 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="selected-day-title">
          {canUpdate&&<button type="button" onClick={()=>create(day)} className="mb-3 w-full rounded-lg bg-[#0b2e59] px-4 py-3 text-sm font-semibold text-white sm:w-auto">＋予定を作成</button>}
          <h2 id="selected-day-title" aria-live="polite" className="font-bold text-[#0b2e59]">{Number(day.slice(5,7))}月{Number(day.slice(-2))}日の予定 <span className="text-sm font-normal">{selected.length}件</span></h2>
          {selected.length?<CalendarEventsList events={selected} now={now} canUpdate={canUpdate} onEvent={openEvent}/>:<p className="mt-2 text-sm text-slate-500">予定はありません。</p>}
        </section>
      </div>
    </div>
    {panel&&(panel.draft||events.some(e=>e.id===panel.eventId))&&<CalendarEventDialog key={panel.eventId??`${panel.draft?.day}-${panel.draft?.start}`} event={events.find(e=>e.id===panel.eventId)} draft={panel.draft} canUpdate={canUpdate} onClose={()=>setPanel(null)} onSaved={()=>{setPanel(null);setFilters({hiddenTypes:[]});}}/>}
  </>;
}
