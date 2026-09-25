"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { findCalendarRepairs, saveCalendarEvent } from "./calendar-actions";
import { japanDay, eventTime, type CalendarEvent, type CalendarRepair } from "./calendar-state";
import { TYPE_LABELS } from "./calendar/scheduler";

export default function CalendarEventForm({repairId=null,dispatchId=null,event,direct=false,initialDay='',initialStart='',initialEnd='',onSaved,onClose,onPendingChange}: {
  repairId?:number|null;dispatchId?:string|null;event?:CalendarEvent;direct?:boolean;
  initialDay?:string;initialStart?:string;initialEnd?:string;onSaved?:()=>void;onClose?:()=>void;onPendingChange?:(busy:boolean)=>void;
}) {
  const router=useRouter();
  const [open,setOpen]=useState(direct),[pending,setPending]=useState(false),[feedback,setFeedback]=useState('');
  const [allDay,setAllDay]=useState(event?.all_day??false),[title,setTitle]=useState(event?.title??'');
  const [eventType,setEventType]=useState(event?.event_type??'site_visit');
  const [linkRepair,setLinkRepair]=useState(false),[repair,setRepair]=useState<CalendarRepair|null>(null);
  const [search,setSearch]=useState(''),[results,setResults]=useState<CalendarRepair[]>([]),[searchMessage,setSearchMessage]=useState('');
  const [searching,setSearching]=useState(false);
  const id=useRef(''),busy=useRef(false);
  const editableTitle=direct||!!event;
  if(event&&event.status!=='scheduled') return null;
  return <div className="mt-3 text-sm">
    {!open ? <button type="button" onClick={()=>{id.current=event?.id??crypto.randomUUID();setAllDay(event?.all_day??false);setTitle(event?.title??'');setOpen(true);setFeedback('');}}
      className="rounded-lg border border-[#0b2e59] bg-white px-3 py-2 text-[#0b2e59]">{event?'編集':'予定を登録'}</button> :
    <form className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2" onSubmit={async e=>{
      e.preventDefault();if(busy.current)return;
      if(direct&&!event&&linkRepair&&!repair){setFeedback('紐付ける修理案件を選択してください。');return;}
      const data=new FormData(e.currentTarget);
      id.current ||= event?.id??crypto.randomUUID();
      busy.current=true;setPending(true);onPendingChange?.(true);setFeedback('');
      try {
        const result=await saveCalendarEvent({id:id.current,repairId:event?event.repair_request_id:direct?(linkRepair?repair?.id??null:null):repairId,
          dispatchId:event?event.vendor_dispatch_id:direct?null:dispatchId,title:editableTitle?title:undefined,edit:!!event,eventType,
          date:data.get('date'),start:data.get('start')??'',end:data.get('end')??'',allDay,notes:data.get('notes')??''});
        setFeedback(result.message);if(result.ok){setOpen(false);router.refresh();onSaved?.();}
      } catch {setFeedback('通信に失敗しました。再読み込みして保存状況を確認してください。');}
      finally {busy.current=false;setPending(false);onPendingChange?.(false);}
    }}>
      <p className="text-xs text-slate-500 sm:col-span-2">{editableTitle?'日本時間で登録します。':'日本時間で登録します。タイトルは物件・号室・カテゴリ・種類から自動作成します。'}</p>
      {editableTitle&&<label className="sm:col-span-2">タイトル<input name="title" required maxLength={300} value={title} onChange={e=>setTitle(e.target.value)} disabled={pending} className="block w-full rounded border p-2"/></label>}
      <label>予定種類<select name="eventType" required value={eventType} onChange={e=>setEventType(e.target.value)} className="block w-full rounded border p-2" disabled={pending}>
        {Object.entries(TYPE_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>日付<input name="date" type="date" required defaultValue={event?japanDay(Date.parse(event.starts_at)):initialDay} className="block w-full rounded border p-2" disabled={pending}/></label>
      <label className="sm:col-span-2"><input type="checkbox" checked={allDay} disabled={pending} onChange={e=>setAllDay(e.target.checked)}/> 終日</label>
      <div className={allDay?'hidden':'contents'}>
        <label>開始時刻<input name="start" type="time" required={!allDay} defaultValue={event?eventTime({...event,all_day:false}):initialStart} disabled={pending||allDay} className="block w-full rounded border p-2"/></label>
        <label>終了時刻（任意・同日）<input name="end" type="time" defaultValue={event?.ends_at&&!event.all_day?eventTime({...event,starts_at:event.ends_at}):initialEnd} disabled={pending||allDay} className="block w-full rounded border p-2"/></label>
      </div>
      {direct&&!event&&<fieldset disabled={pending} className="space-y-2 sm:col-span-2">
        <label><input type="checkbox" checked={linkRepair} onChange={e=>setLinkRepair(e.target.checked)}/> 修理案件に紐付ける（任意）</label>
        {linkRepair&&<>
          <div className="flex gap-2"><input aria-label="案件の物件名検索" placeholder="物件名で検索" maxLength={100} value={search} onChange={e=>setSearch(e.target.value)} className="min-w-0 flex-1 rounded border p-2"/>
            <button type="button" disabled={searching} className="rounded border px-3" onClick={async()=>{
              setSearching(true);setSearchMessage('');
              try {const result=await findCalendarRepairs(search);setResults(result.items);setSearchMessage(result.message||(!result.items.length?'該当する案件はありません。':'最大30件。見つからない場合は物件名を絞ってください。'));}
              catch {setSearchMessage('案件を取得できません。');}
              finally {setSearching(false);}
            }}>{searching?'検索中…':'検索'}</button></div>
          <ul className="max-h-40 overflow-auto">{results.map(item=><li key={item.id}><button type="button" aria-pressed={repair?.id===item.id} className="w-full rounded p-2 text-left hover:bg-blue-50" onClick={()=>{setRepair(item);if(!title.trim())setTitle(`${item.property_name} ${item.room_number}号室 - ${item.category} ${TYPE_LABELS[eventType]}`.slice(0,300));}}>{item.property_name} {item.room_number}号室 · {item.category}（#{item.id}）</button></li>)}</ul>
          {searchMessage&&<p role="status">{searchMessage}</p>}
          {repair&&<p className="rounded bg-blue-50 p-2">選択中：{repair.property_name} {repair.room_number}号室 · {repair.category}（#{repair.id}）</p>}
        </>}
      </fieldset>}
      {event&&<p className="text-xs text-slate-500 sm:col-span-2">案件・業者手配の紐付けは変更できません。</p>}
      <label className="sm:col-span-2">メモ<textarea name="notes" maxLength={3000} defaultValue={event?.notes??''} disabled={pending} className="block w-full rounded border p-2"/></label>
      <div className="flex gap-2 sm:col-span-2"><button disabled={pending} className="rounded bg-[#0b2e59] px-3 py-2 text-white">{pending?'保存中…':'保存'}</button>
        <button type="button" disabled={pending} onClick={()=>{setOpen(false);onClose?.();}} className="px-3 py-2">閉じる</button></div>
    </form>}
    {feedback&&<p role="status" className="mt-2">{feedback}</p>}
  </div>;
}
