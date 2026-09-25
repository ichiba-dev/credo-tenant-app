import { eventsOnDay, japanDay, type CalendarEvent } from "../calendar-state";
import { layoutDay, timeBounds, timeLabel, typeLabel } from "./scheduler";

function EventBlock({event, onSelect, onEvent}: {event: CalendarEvent; onSelect: () => void;onEvent?:(event:CalendarEvent)=>void}) {
  const label = `${timeLabel(event)} ${event.title} ${typeLabel(event.event_type)}${event.status === 'completed' ? '（完了）' : event.status === 'cancelled' ? '（キャンセル）' : ''}`;
  const className = `relative block h-full overflow-hidden rounded border-l-2 border-[#0b2e59] px-1.5 py-0.5 text-left text-xs leading-4 hover:z-30 hover:h-auto hover:min-h-full focus:z-30 focus:h-auto focus:min-h-full focus-visible:outline-2 focus-visible:outline-[#0b2e59] ${event.status === 'scheduled' ? 'bg-blue-100 text-[#0b2e59] hover:bg-blue-200' : 'bg-slate-100 text-slate-500 opacity-60'}`;
  const content = <><span className="block truncate font-semibold">{timeLabel(event)}</span><span className="block break-words">{event.title}</span><span className="block truncate">{typeLabel(event.event_type)}{event.status === 'completed' ? ' · 完了' : event.status === 'cancelled' ? ' · キャンセル' : ''}</span></>;
  return !onEvent&&event.repair_request_id ? <a href={`/admin#repair-detail-${event.repair_request_id}`} className={className} title={label} aria-label={label}>{content}</a> :
    <button type="button" className={`${className} w-full`} title={label} aria-label={label} onClick={()=>onEvent?onEvent(event):onSelect()}>{content}</button>;
}

export default function CalendarTimeline({events, days, day, now, onSelect, onEvent, onCreate}: {
  events: CalendarEvent[]; days: string[]; day: string; now: number; onSelect: (day: string) => void;onEvent?:(event:CalendarEvent)=>void;onCreate?:(day:string,minutes:number)=>void;
}) {
  const today = japanDay(now), bounds = timeBounds(events, days);
  const hours = Array.from({length: (bounds.end - bounds.start) / 60 + 1}, (_, i) => bounds.start + i * 60);
  const height = (bounds.end - bounds.start) * 1.2;
  const minutes = (now - Date.parse(today + 'T00:00:00+09:00')) / 60000;
  const columns = {gridTemplateColumns: `48px repeat(${days.length}, minmax(0, 1fr))`};
  return <div className="max-h-[75vh] overflow-auto rounded-lg border border-slate-200 bg-white" aria-label={days.length === 1 ? '日タイムライン' : '週タイムライン'}>
    <div className="sticky top-0 z-20 bg-white shadow-sm">
      <div className="grid border-b border-slate-200" style={columns}>
        <span className="self-center text-center text-[10px] text-slate-500">JST</span>
        {days.map(d => <button key={d} type="button" aria-current={d === today ? 'date' : undefined} aria-pressed={d === day} onClick={() => onSelect(d)}
          className={`border-l border-slate-200 py-3 text-sm focus-visible:outline-2 ${d === today ? 'bg-blue-50 font-bold text-[#0b2e59]' : 'text-slate-600'} ${d === day ? 'shadow-[inset_0_-2px_0_#0b2e59]' : ''}`}>
          {Number(d.slice(5, 7))}/{Number(d.slice(-2))} <span className="text-xs">{['日','月','火','水','木','金','土'][new Date(d + 'T00:00:00Z').getUTCDay()]}</span>
        </button>)}
      </div>
      <div className="grid border-b border-slate-200" style={columns}>
        <span className="py-3 text-center text-xs text-slate-500">終日</span>
        {days.map(d => <div key={d} className={`min-w-0 space-y-1 border-l border-slate-200 p-1 ${d === today ? 'bg-blue-50/50' : ''}`}>
          {eventsOnDay(events, d).filter(e => e.all_day).map(event => <EventBlock key={event.id} event={event} onEvent={onEvent} onSelect={() => onSelect(d)}/>)}
        </div>)}
      </div>
    </div>
    <div className="grid pb-4" style={columns}>
      <div className="relative text-[10px] text-slate-500" style={{height}}>
        {hours.map(minute => <span key={minute} className="absolute right-1" style={{top: (minute - bounds.start) * 1.2}}>{minute / 60}:00</span>)}
      </div>
      {days.map(d => <div key={d} className={`relative min-w-0 border-l border-slate-200 ${d === today ? 'bg-blue-50/40' : ''}`} style={{height}}>
        {onCreate&&Array.from({length:(bounds.end-bounds.start)/30},(_,i)=>bounds.start+i*30).map(minute=><button key={minute} type="button"
          aria-label={`${d} ${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}に予定を作成`}
          onClick={()=>onCreate(d,minute)} className="absolute w-full hover:bg-blue-100/60 focus-visible:bg-blue-100 focus-visible:outline-2 focus-visible:outline-[#0b2e59]"
          style={{top:(minute-bounds.start)*1.2,height:36}}/>) }
        {hours.map(minute => <div key={minute} className="pointer-events-none absolute w-full border-t border-slate-200" style={{top: (minute - bounds.start) * 1.2}}/>)}
        {layoutDay(events, d).map(slot => <div key={slot.event.id} className="absolute z-10 p-px hover:z-30 focus-within:z-30" style={{top: (slot.start - bounds.start) * 1.2, height: (slot.end - slot.start) * 1.2, left: `${slot.lane / slot.lanes * 100}%`, width: `${100 / slot.lanes}%`}}>
          <EventBlock event={slot.event} onEvent={onEvent} onSelect={() => onSelect(d)}/>
        </div>)}
        {d === today && minutes >= bounds.start && minutes <= bounds.end && <div aria-label="現在時刻" className="pointer-events-none absolute z-10 w-full border-t-2 border-red-500" style={{top: (minutes - bounds.start) * 1.2}}><span className="absolute -left-1 -top-1 h-1.5 w-1.5 rounded-full bg-red-500"/></div>}
      </div>)}
    </div>
  </div>;
}
