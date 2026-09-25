"use client";
import { useState } from "react";
import { eventsOnDay, japanDay, type CalendarEvent } from "./calendar-state";
import { weekDays } from "./calendar/scheduler";
import CalendarEventsList from "./calendar-events-list";

export default function AdminWeekCalendar({ events, initialNow, canUpdate }: {
  events: CalendarEvent[]; initialNow: number; canUpdate: boolean;
}) {
  const today = japanDay(initialNow), days = weekDays(today);
  const [selected, setSelected] = useState(today);
  const day = days.includes(selected) ? selected : today;
  const rows = eventsOnDay(events, day);
  return <section aria-label="ミニ週間カレンダー" className="rounded-xl border border-slate-200 bg-white p-3">
    <h2 className="text-sm font-bold text-[#0b2e59]">今週の予定</h2>
    <div className="my-3 grid grid-cols-7 gap-1">{days.map((date, i) => <button type="button" key={date}
      aria-label={`${date} ${eventsOnDay(events, date).length}件`} aria-pressed={day === date} onClick={() => setSelected(date)}
      className={`min-w-0 rounded py-2 text-xs ${day === date ? "bg-[#0b2e59] text-white" : date === today ? "bg-blue-50 text-[#0b2e59]" : "bg-slate-50"}`}>
      <span className="block">{"月火水木金土日"[i]}</span>{Number(date.slice(-2))}
      <span className="block text-[10px]">{eventsOnDay(events, date).length}件</span>
    </button>)}</div>
    <p className="text-xs text-slate-500">{day} · {rows.length}件</p>
    {rows.length > 0 && <CalendarEventsList events={rows} now={initialNow} canUpdate={canUpdate}/>}
  </section>;
}
