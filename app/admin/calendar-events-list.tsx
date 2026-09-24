"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { changeCalendarStatus } from "./calendar-actions";
import CalendarEventForm from "./calendar-event-form";
import { eventTime, isOverdue, japanDay, type CalendarEvent } from "./calendar-state";

export default function CalendarEventsList({events,now,canUpdate,showDate=false}: {events:CalendarEvent[];now:number;canUpdate:boolean;showDate?:boolean}) {
  const router=useRouter(),busy=useRef(false);
  const [pending,setPending]=useState(false),[message,setMessage]=useState('');
  async function change(id:string,status:string) {
    if(busy.current)return;busy.current=true;setPending(true);
    try {const result=await changeCalendarStatus(id,status);setMessage(result.message);if(result.ok)router.refresh();}
    catch {setMessage('通信に失敗しました。再読み込みして確認してください。');}
    finally {busy.current=false;setPending(false);}
  }
  return <><ul className="divide-y divide-slate-200">{events.map(event=><li key={event.id} className={`py-3 ${event.status==='scheduled'?'':'text-slate-500'}`}>
    <p className="break-words text-sm"><span className="mr-2 font-semibold">{showDate&&`${japanDay(Date.parse(event.starts_at))} `}{eventTime(event)}</span>
      {event.repair_request_id ? <a className={event.status==='scheduled'?"text-[#0b2e59] underline":"text-slate-400 underline"} href={`/admin#repair-detail-${event.repair_request_id}`}>{event.title}</a>:event.title}
      {isOverdue(event,now)&&<span className="ml-2 rounded bg-slate-100 px-2 text-xs">予定時刻経過</span>}
      {event.status!=='scheduled'&&<span className="ml-2 text-xs">{event.status==='completed'?'完了':'キャンセル'}</span>}</p>
    {event.notes&&<p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600">{event.notes}</p>}
    {canUpdate&&event.status==='scheduled'&&<div className="mt-2 flex flex-wrap items-start gap-2">
      <button type="button" disabled={pending} onClick={()=>change(event.id,'completed')} className="rounded border px-3 py-2 text-xs">完了</button>
      <button type="button" disabled={pending} onClick={()=>{if(window.confirm('この予定をキャンセルしますか？ 履歴は残ります。'))void change(event.id,'cancelled');}} className="rounded border px-3 py-2 text-xs">キャンセル</button>
      {event.repair_request_id&&<CalendarEventForm repairId={event.repair_request_id} dispatchId={event.vendor_dispatch_id} event={event}/>}
    </div>}
  </li>)}</ul>{message&&<p role="status" className="text-sm">{message}</p>}</>;
}
