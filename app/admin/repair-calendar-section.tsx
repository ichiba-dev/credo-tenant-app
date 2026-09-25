"use client";
import { useEffect, useRef, useState } from "react";
import { readRepairCalendar } from "./repair-calendar-actions";
import { repairCalendarEvents, repairCalendarLink, repairCalendarTimeline, calendarStatus, type RepairCalendarEvent } from "./repair-calendar-state";
import { japanDay } from "./calendar-state";
import { timeLabel, typeLabel } from "./calendar/scheduler";
import type { AdminRepair } from "./types";

const dateFormat=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
export function RepairCalendarContent({repair,events,loading,error}: {
  repair:Pick<AdminRepair,'id'|'history'|'vendor_dispatches'>;events:RepairCalendarEvent[];loading:boolean;error:boolean;
}) {
  const items=repairCalendarEvents(events,repair.id),timeline=repairCalendarTimeline(repair.history,items);
  return <>
    <section aria-label="案件の予定" className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-sm" aria-busy={loading}>
      <h3 className="font-bold text-[#0b2e59]">予定</h3>
      {loading?<p role="status">予定を確認中…</p>:error?<p role="alert">予定を取得できませんでした。案件を開き直すと再取得します。</p>:items.length===0?<p className="mt-2 text-slate-500">紐付いた予定はありません。</p>:
        <ul className="divide-y divide-slate-200">{items.map(event=><li key={event.id} className="space-y-1 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span>{japanDay(Date.parse(event.starts_at))} {timeLabel(event)}{event.ends_at&&!event.all_day&&japanDay(Date.parse(event.ends_at))!==japanDay(Date.parse(event.starts_at))&&`（終了日 ${japanDay(Date.parse(event.ends_at))}）`}</span>
            <span className={`rounded px-2 py-1 text-xs font-semibold ${event.status==='scheduled'?'bg-blue-50 text-[#0b2e59]':event.status==='completed'?'bg-emerald-50 text-emerald-800':'bg-slate-100 text-slate-600'}`}>{calendarStatus[event.status as keyof typeof calendarStatus]??event.status}</span></div>
          <p className="font-medium">{typeLabel(event.event_type)} · {event.title}</p>
          <p className="whitespace-pre-wrap break-words text-slate-600">メモ：{event.notes||'なし'}</p>
          {event.vendor_dispatch_id&&<p className="break-all text-xs text-slate-500">業者手配：{repair.vendor_dispatches?.find(d=>d.id===event.vendor_dispatch_id)?.vendorName??'業者名未取得'}（{event.vendor_dispatch_id}）</p>}
          <a className="inline-block text-[#0b2e59] underline" href={repairCalendarLink(event)}>カレンダーで開く</a>
        </li>)}</ul>}
    </section>
    <section aria-label="対応履歴" className="mt-3 rounded-lg bg-slate-100 p-3 text-sm">
      <h3 className="font-bold text-[#0b2e59]">対応履歴</h3>
      <p className="my-2 text-xs text-slate-500">予定の完了・キャンセルは予定の記録です。修理案件・業者手配の状態とは別です。</p>
      {timeline.length?<ol className="space-y-2 border-l border-slate-300 pl-3">{timeline.map(entry=><li key={entry.id}>
        {entry.at&&<time dateTime={entry.at} className="mr-2 text-xs text-slate-500">{dateFormat.format(new Date(entry.at))}</time>}
        <span className="whitespace-pre-wrap break-words">{entry.text}</span>
        {entry.event&&<a href={repairCalendarLink(entry.event)} className="ml-2 text-xs text-[#0b2e59] underline">カレンダーで開く</a>}
      </li>)}</ol>:<p className="text-slate-500">対応履歴はありません。</p>}
      {(loading||error)&&<p className="mt-2 text-xs text-slate-500">予定の履歴は{loading?'取得中です。':'取得できていません。'}</p>}
    </section>
  </>;
}

export default function RepairCalendarSection({repair}: {repair:AdminRepair}) {
  const root=useRef<HTMLDivElement>(null);
  const [state,setState]=useState<{events:RepairCalendarEvent[];loading:boolean;error:boolean}>({events:[],loading:true,error:false});
  useEffect(()=>{
    let revision=0,active=true;
    const detail=root.current?.closest('details');
    async function refresh() {
      const request=++revision;setState({events:[],loading:true,error:false});
      try {const result=await readRepairCalendar(repair.id);if(active&&request===revision)setState({events:result.ok?result.events:[],loading:false,error:!result.ok});}
      catch {if(active&&request===revision)setState({events:[],loading:false,error:true});}
    }
    const reopen=()=>{if(detail?.open)void refresh();};
    void refresh();detail?.addEventListener('toggle',reopen);window.addEventListener('focus',reopen);
    return()=>{active=false;detail?.removeEventListener('toggle',reopen);window.removeEventListener('focus',reopen);};
  },[repair]);
  return <div ref={root}><RepairCalendarContent repair={repair} {...state}/></div>;
}
