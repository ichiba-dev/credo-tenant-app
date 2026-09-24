"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { japanDay, pastPendingEvents, upcomingDays, type CalendarEvent } from "./calendar-state";
import CalendarEventsList from "./calendar-events-list";
export default function CalendarOverview({events,initialNow,canUpdate}: {events:CalendarEvent[];initialNow:number;canUpdate:boolean}) {
  const [now,setNow]=useState(initialNow);
  const router=useRouter();
  const overdue=pastPendingEvents(events,now);
  useEffect(()=>{const timer=setInterval(()=>{const current=Date.now();setNow(current);
    if(japanDay(current)!==japanDay(initialNow))router.refresh();
  },60000);return()=>clearInterval(timer);},[initialNow,router]);
  return <div>{upcomingDays(events,now).map((group,index)=>group.events.length>0&&<section key={group.day} className="mb-3 rounded-xl border border-slate-200 bg-white p-4">
    <h2 className="font-bold text-[#0b2e59]">{index===0?'今日':'明日'}の予定 {group.events.length}件</h2>
    <CalendarEventsList events={group.events} now={now} canUpdate={canUpdate}/>
  </section>)}
    {overdue.length>0&&<details className="mb-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <summary className="cursor-pointer text-[#0b2e59]">以前の未完了予定 {overdue.length}件（予定時刻経過）</summary>
      <CalendarEventsList events={overdue} now={now} canUpdate={canUpdate} showDate/>
    </details>}
  </div>;
}
