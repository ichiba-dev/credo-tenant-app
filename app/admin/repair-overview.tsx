"use client";
import { useContext, useEffect, useState } from "react";
import { RepairTabContext } from "./repair-detail-tabs";
import RepairCalendarSection from "./repair-calendar-section";
import { repairCalendarEvents, repairCalendarLink, repairCalendarTimeline, type RepairCalendarEvent } from "./repair-calendar-state";
import { repairListState } from "./repair-list-state";
import { repairTodos } from "./repair-todo-state";
import { statusLabels } from "./vendor-dispatch-section";
import { timeLabel } from "./calendar/scheduler";
import type { AdminRepair } from "./types";

const stamp=(value:string|null|undefined)=>value&&Number.isFinite(Date.parse(value))?Date.parse(value):0;
const date=(value:string)=>stamp(value)?new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'日時不明';
export function RepairOverviewContent({repair,events,loading,error,now}: {
  repair:AdminRepair;events:RepairCalendarEvent[];loading:boolean;error:boolean;now:number;
}) {
  const jump=useContext(RepairTabContext);
  const primary=repairTodos([repair],now)[0]?.primary;
  const hasAction=primary&&primary.action!==primary.label;
  const summary=primary?.action??repairListState(repair).reasons.map(reason=>reason==='依頼済み'?'業者へ依頼済み':reason).join(' / ');
  const latestEstimate=[...(repair.owner_report_estimates?.files??[])].sort((a,b)=>stamp(b.created_at)-stamp(a.created_at))[0];
  const items=repairCalendarEvents(events,repair.id);
  const upcoming=items.filter(event=>event.status==='scheduled'&&stamp(event.starts_at)>=now).slice(0,2);
  const dispatch=[...(repair.vendor_dispatches??[])].sort((a,b)=>stamp(b.selectedAt)-stamp(a.selectedAt))[0];
  const messages=(repair.tenant_messages??[]).filter(message=>message.sender_type==='tenant').sort((a,b)=>stamp(b.created_at)-stamp(a.created_at)).slice(0,2);
  const recent=repairCalendarTimeline(repair.history,items).filter(entry=>entry.at&&stamp(entry.at)<=now).reverse().slice(0,3);
  const link='mt-3 text-xs font-semibold text-[#0b2e59] underline';
  return <div data-overview-dashboard className="@container my-5 space-y-5 text-sm">
    <section className="rounded-lg bg-blue-50 p-4">
      <h3 className="text-xs font-semibold text-slate-600">{hasAction?'次にやること':'現在の状況'}</h3>
      <p className="mt-2 text-lg font-bold text-[#0b2e59]">{summary}</p>
    </section>
    <div className="grid gap-5 @lg:grid-cols-2">
      <section aria-label="直近予定">
        <h3 className="font-bold text-[#0b2e59]">直近予定</h3>
        {loading?<p role="status" className="mt-2 text-slate-500">予定を確認中…</p>:error?<p role="alert" className="mt-2 text-slate-500">予定を取得できませんでした。</p>:
          upcoming.length?<ul className="mt-2 space-y-3">{upcoming.map(event=><li key={event.id}>
            <p className="text-xs text-slate-500">{date(event.starts_at).split(' ')[0]} {timeLabel(event)}</p>
            <p className="font-medium">{event.title}</p><a className={link} href={repairCalendarLink(event)}>カレンダーで開く</a>
          </li>)}</ul>:<p className="mt-2 text-slate-500">今後の予定はありません。</p>}
        <button type="button" className={link} onClick={()=>jump('schedule')}>予定タブを開く</button>
      </section>
      <section aria-label="最新の業者手配">
        <h3 className="font-bold text-[#0b2e59]">最新の業者手配</h3>
        {repair.vendor_dispatch_unavailable||repair.vendor_dispatches===undefined?<p className="mt-2 text-slate-500">手配情報を取得できていません。</p>:dispatch?<div className="mt-2 space-y-1">
          <p className="font-medium">{dispatch.vendorName}</p><p>{statusLabels[dispatch.status]??dispatch.status}</p>
          <p className="text-xs text-slate-500">{date(dispatch.selectedAt)}</p>
          <p className="line-clamp-3 whitespace-pre-wrap break-words">手配内容：{dispatch.instructions||'記録なし'}</p>
        </div>:<p className="mt-2 text-slate-500">業者未手配</p>}
        <button type="button" className={link} onClick={()=>jump('vendors')}>業者手配タブを開く</button>
      </section>
      <section aria-label="最新の入居者連絡">
        <h3 className="font-bold text-[#0b2e59]">最新の入居者連絡</h3>
        {(repair.line_messages_unavailable||repair.line_attachments_unavailable)&&<p className="mt-2 text-xs text-slate-500">一部の連絡を取得できていません。</p>}
        {messages.length?<ul className="mt-2 space-y-3">{messages.map(message=><li key={message.id}>
          <p className="text-xs text-slate-500">{date(message.created_at)}</p>
          <p className="line-clamp-3 whitespace-pre-wrap break-words">{message.attachment?(message.attachment.media_type==='image'?'画像1件':'PDF受信'):message.message}</p>
        </li>)}</ul>:<p className="mt-2 text-slate-500">表示できる入居者連絡はありません。</p>}
        <button type="button" className={link} onClick={()=>jump('line')}>入居者LINEタブを開く</button>
      </section>
      {latestEstimate&&<section aria-label="最新見積">
        <h3 className="font-bold text-[#0b2e59]">最新見積</h3>
        <p className="mt-2 break-words font-medium">{latestEstimate.original_filename}</p>
        <p className="mt-1 text-xs text-slate-500">登録日時：{date(latestEstimate.created_at)}</p>
        <button type="button" className={link} onClick={()=>jump('estimates')}>見積タブを開く</button>
      </section>}
    </div>
    <section aria-label="最近の動き" className="border-t border-slate-100 pt-4">
      <h3 className="font-bold text-[#0b2e59]">最近の動き</h3>
      {recent.length?<ol className="mt-2 space-y-2">{recent.map(entry=><li key={entry.id}>
        <time className="mr-2 text-xs text-slate-500" dateTime={entry.at!}>{date(entry.at!)}</time><span>{entry.text}</span>
      </li>)}</ol>:<p className="mt-2 text-slate-500">日時を確認できる履歴はありません。</p>}
      {(loading||error)&&<p className="mt-2 text-xs text-slate-500">予定の履歴は{loading?'取得中です。':'取得できていません。'}</p>}
      <button type="button" className={link} onClick={()=>jump('history')}>対応履歴タブを開く</button>
    </section>
  </div>;
}
export default function RepairOverview({repair,active}: {repair:AdminRepair;active:boolean}) {
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{if(!active)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[active]);
  return <RepairCalendarSection repair={repair} enabled={active}>{state=><RepairOverviewContent repair={repair} {...state} now={now}/>}</RepairCalendarSection>;
}
