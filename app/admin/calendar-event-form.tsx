"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveCalendarEvent } from "./calendar-actions";
import { EVENT_TYPES, japanDay, eventTime, type CalendarEvent } from "./calendar-state";

export default function CalendarEventForm({repairId,dispatchId=null,event}: {repairId:number;dispatchId?:string|null;event?:CalendarEvent}) {
  const router=useRouter();
  const [open,setOpen]=useState(false),[pending,setPending]=useState(false),[feedback,setFeedback]=useState('');
  const [allDay,setAllDay]=useState(event?.all_day??false);
  const id=useRef(''),busy=useRef(false);
  return <div className="mt-3 text-sm">
    {!open ? <button type="button" onClick={()=>{id.current=event?.id??crypto.randomUUID();setAllDay(event?.all_day??false);setOpen(true);setFeedback('');}}
      className="rounded-lg border border-[#0b2e59] bg-white px-3 py-2 text-[#0b2e59]">{event?'予定を変更':'予定を登録'}</button> :
    <form className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2" onSubmit={async e=>{
      e.preventDefault();if(busy.current)return;const data=new FormData(e.currentTarget);
      busy.current=true;setPending(true);setFeedback('');
      try {
        const result=await saveCalendarEvent({id:id.current,repairId,dispatchId,edit:!!event,eventType:data.get('eventType'),
          date:data.get('date'),start:data.get('start')??'',end:data.get('end')??'',allDay,notes:data.get('notes')??''});
        setFeedback(result.message);if(result.ok){setOpen(false);router.refresh();}
      } catch {setFeedback('通信に失敗しました。再読み込みして保存状況を確認してください。');}
      finally {busy.current=false;setPending(false);}
    }}>
      <p className="text-xs text-slate-500 sm:col-span-2">日本時間で登録します。タイトルは物件・号室・カテゴリ・種類から自動作成します。</p>
      <label>種類<select name="eventType" defaultValue={event?.event_type??'site_visit'} className="block w-full rounded border p-2" disabled={pending}>
        {Object.entries(EVENT_TYPES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>日付<input name="date" type="date" required defaultValue={event?japanDay(Date.parse(event.starts_at)):''} className="block w-full rounded border p-2" disabled={pending}/></label>
      <label className="sm:col-span-2"><input type="checkbox" checked={allDay} disabled={pending} onChange={e=>setAllDay(e.target.checked)}/> 終日</label>
      {!allDay&&<><label>開始時刻<input name="start" type="time" required defaultValue={event?eventTime({...event,all_day:false}):''} disabled={pending} className="block w-full rounded border p-2"/></label>
      <label>終了時刻（任意・同日）<input name="end" type="time" defaultValue={event?.ends_at&&!event.all_day?eventTime({...event,starts_at:event.ends_at}):''} disabled={pending} className="block w-full rounded border p-2"/></label></>}
      <label className="sm:col-span-2">メモ<textarea name="notes" maxLength={3000} defaultValue={event?.notes??''} disabled={pending} className="block w-full rounded border p-2"/></label>
      <div className="flex gap-2 sm:col-span-2"><button disabled={pending} className="rounded bg-[#0b2e59] px-3 py-2 text-white">{pending?'保存中…':'保存'}</button>
        <button type="button" disabled={pending} onClick={()=>setOpen(false)} className="px-3 py-2">閉じる</button></div>
    </form>}
    {feedback&&<p role="status" className="mt-2">{feedback}</p>}
  </div>;
}
