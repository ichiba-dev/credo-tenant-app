import { eventsOnDay, eventTime, type CalendarEvent } from "../calendar-state";
import { monthDays } from "./month-grid";

export default function CalendarMonth({events,month,day,today,onSelect,onEvent}: {
  events:CalendarEvent[];month:string;day:string;today:string;onSelect:(day:string)=>void;onEvent?:(event:CalendarEvent)=>void;
}) {
  const setDay=onSelect;
  return (<div className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label={`${month}のカレンダー`}>
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {['日','月','火','水','木','金','土'].map(d=><span key={d} className="py-2 text-center text-xs font-medium text-slate-600">{d}</span>)}
      </div>
      <div className="grid grid-cols-7">
        {monthDays(month).map(d=>{
          const items=eventsOnDay(events,d),current=d.startsWith(month),active=day===d;
          return <div key={d} className={`relative min-w-0 border-b border-r border-slate-200 last:border-r-0 ${active?'bg-blue-50 ring-2 ring-inset ring-[#0b2e59]':current?'bg-white':'bg-slate-50'}`}>
            <button type="button" aria-pressed={active} aria-current={d===today?'date':undefined} aria-controls="selected-day-events"
              aria-label={`${d} 予定${items.length}件`} onClick={()=>setDay(d)}
              className="flex min-h-16 w-full flex-col items-center gap-1 p-1 focus-visible:outline-2 focus-visible:outline-[#0b2e59] md:min-h-0 md:items-start md:p-2">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${d===today?'bg-[#0b2e59] font-bold text-white':current?'text-slate-800':'text-slate-400'}`}>{Number(d.slice(-2))}</span>
              <span aria-hidden="true" className="flex h-2 gap-0.5 md:hidden">{items.slice(0,3).map(e=><span key={e.id} className={`h-1.5 w-1.5 rounded-full ${e.status==='scheduled'?'bg-[#0b2e59]':'bg-slate-300'}`}/>)}</span>
            </button>
            <div className="hidden min-h-24 space-y-1 px-1 pb-2 md:block">
              {items.slice(0,3).map(e=>{
                const label=`${eventTime(e)} ${e.title}${e.status==='completed'?'（完了）':e.status==='cancelled'?'（キャンセル）':''}`;
                const style=`block truncate rounded px-1 py-0.5 text-xs ${e.status==='scheduled'?'bg-slate-100 text-[#0b2e59] hover:bg-blue-100':'text-slate-400'} ${current?'':'opacity-60'}`;
                return !onEvent&&e.repair_request_id?<a key={e.id} href={`/admin#repair-detail-${e.repair_request_id}`} className={style} title={label}>{label}</a>:
                  <button key={e.id} type="button" onClick={()=>onEvent?onEvent(e):setDay(d)} className={`${style} w-full text-left`} title={label}>{label}</button>;
              })}
              {items.length>3&&<button type="button" onClick={()=>setDay(d)} className="px-1 text-xs text-slate-600 underline" aria-label={`${d}の予定をすべて表示`}>他{items.length-3}件</button>}
            </div>
          </div>;
        })}
      </div>
    </div>);
}
