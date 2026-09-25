"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CalendarEventForm from "../calendar-event-form";
import { changeCalendarStatus, findCalendarRepairs } from "../calendar-actions";
import { japanDay, type CalendarEvent } from "../calendar-state";
import { timeLabel, typeLabel } from "./scheduler";

export type CalendarDraft = {day:string;start:string;end:string};
export default function CalendarEventDialog({event,draft,canUpdate,onClose,onSaved}: {
  event?:CalendarEvent;draft?:CalendarDraft;canUpdate:boolean;onClose:()=>void;onSaved:()=>void;
}) {
  const dialog=useRef<HTMLDialogElement>(null), busy=useRef(false),router=useRouter();
  const [editing,setEditing]=useState(false),[pending,setPending]=useState(false),[message,setMessage]=useState('');
  const [repairLabel,setRepairLabel]=useState('紐付け案件を確認中…');
  useEffect(()=>{const element=dialog.current;const previous=document.activeElement as HTMLElement|null;element?.showModal();return()=>{element?.close();previous?.focus();};},[]);
  useEffect(()=>{let active=true;if(event?.repair_request_id)void findCalendarRepairs('',event.repair_request_id).then(result=>{
    if(active){const repair=result.items[0];setRepairLabel(repair?`${repair.property_name} ${repair.room_number}号室 · ${repair.category}`:'紐付け案件を取得できません。');}
  }).catch(()=>{if(active)setRepairLabel('紐付け案件を取得できません。');});return()=>{active=false;};},[event?.repair_request_id]);
  const setBusy=(value:boolean)=>{busy.current=value;setPending(value);};
  async function change(status:'completed'|'cancelled') {
    if(!event||busy.current)return;
    if(status==='cancelled'&&!window.confirm('この予定をキャンセルしますか？ 履歴は残ります。'))return;
    setBusy(true);setMessage('');
    try {const result=await changeCalendarStatus(event.id,status);setMessage(result.message);if(result.ok){router.refresh();onSaved();}}
    catch {setMessage('通信に失敗しました。再度お試しください。');}
    finally {setBusy(false);}
  }
  return <dialog ref={dialog} aria-labelledby="calendar-dialog-title" onCancel={e=>{e.preventDefault();if(!busy.current)onClose();}}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-1rem)] max-w-xl overflow-y-auto rounded-xl bg-white p-4 text-slate-800 shadow-xl backdrop:bg-slate-900/40 sm:p-6">
    <div className="flex items-center justify-between gap-3"><h2 id="calendar-dialog-title" className="text-lg font-bold text-[#0b2e59]">{event?editing?'予定を編集':'予定詳細':'予定を作成'}</h2><button type="button" disabled={pending} onClick={onClose} className="rounded border px-3 py-2" aria-label="予定画面を閉じる">閉じる</button></div>
    {event&&!editing?<>
      <h3 className="mt-4 break-words font-bold">{event.title}</h3>
      <dl className="mt-3 space-y-2 text-sm"><div><dt className="text-slate-500">種類</dt><dd>{typeLabel(event.event_type)}</dd></div>
        <div><dt className="text-slate-500">日時（日本時間）</dt><dd>{japanDay(Date.parse(event.starts_at))} {timeLabel(event)}{event.ends_at&&!event.all_day&&japanDay(Date.parse(event.starts_at))!==japanDay(Date.parse(event.ends_at))&&`（終了日 ${japanDay(Date.parse(event.ends_at))}）`}</dd></div>
        {event.repair_request_id&&<div><dt className="text-slate-500">物件・号室 / 修理案件</dt><dd>{repairLabel} <a className="text-[#0b2e59] underline" href={`/admin#repair-detail-${event.repair_request_id}`}>案件詳細を開く</a></dd></div>}
        <div><dt className="text-slate-500">メモ</dt><dd className="whitespace-pre-wrap break-words">{event.notes||'なし'}</dd></div>
        <div><dt className="text-slate-500">状態</dt><dd>{event.status==='scheduled'?'予定':event.status==='completed'?'完了':'キャンセル'}</dd></div></dl>
      {canUpdate&&event.status==='scheduled'&&<div className="mt-5 flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={()=>setEditing(true)} className="rounded bg-[#0b2e59] px-4 py-2 text-white">編集</button>
        <button type="button" disabled={pending} onClick={()=>void change('completed')} className="rounded border px-4 py-2">完了</button>
        <button type="button" disabled={pending} onClick={()=>void change('cancelled')} className="rounded border px-4 py-2">キャンセル</button>
      </div>}
    </>:canUpdate&&(!event||event.status==='scheduled')?<CalendarEventForm direct event={event} initialDay={draft?.day} initialStart={draft?.start} initialEnd={draft?.end} onSaved={onSaved} onClose={onClose} onPendingChange={setBusy}/>:null}
    {message&&<p role="status" className="mt-3 text-sm">{message}</p>}
  </dialog>;
}
