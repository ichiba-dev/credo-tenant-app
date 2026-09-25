import { eventsOnDay, eventTime, nextDay, type CalendarEvent } from "../calendar-state";
import { monthDays, shiftMonth } from "./month-grid";

export type CalendarMode = "auto" | "month" | "week" | "day";
export const TYPE_LABELS: Record<string, string> = {
  site_visit: "現地確認", repair_work: "修理工事", inspection: "点検", estimate_visit: "見積訪問", other: "その他",
};
export const typeLabel = (type: string) => TYPE_LABELS[type] ?? type;
export function weekDays(day: string) {
  const offset = (new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7;
  return Array.from({length: 7}, (_, i) => nextDay(day, i - offset));
}
export function moveDate(day: string, mode: CalendarMode, offset: number) {
  if (mode !== "month") return nextDay(day, offset * (mode === "day" ? 1 : 7));
  const month = shiftMonth(day.slice(0, 7), offset);
  const last = Number(nextDay(shiftMonth(month, 1) + "-01", -1).slice(-2));
  return `${month}-${String(Math.min(Number(day.slice(-2)), last)).padStart(2, "0")}`;
}
export function calendarRange(month: string, day: string) {
  const days = [...monthDays(month), ...weekDays(day)].sort();
  return {from: days[0], until: nextDay(days[days.length - 1])};
}
export function timeLabel(event: CalendarEvent) {
  if (event.all_day) return "終日";
  return eventTime(event) + (event.ends_at ? `〜${eventTime({...event, starts_at: event.ends_at})}` : "（終了未定）");
}
// Times are minutes from Japan midnight. Missing ends get a 30-minute display slot only.
export function timedEvents(events: CalendarEvent[], day: string) {
  const midnight = Date.parse(day + "T00:00:00+09:00");
  return eventsOnDay(events, day).filter(e => !e.all_day).map(event => {
    const start = (Date.parse(event.starts_at) - midnight) / 60000;
    const end = event.ends_at ? (Date.parse(event.ends_at) - midnight) / 60000 : start + 30;
    return {event, start: Math.max(0, start), end: Math.min(1440, end)};
  }).sort((a, b) => a.start - b.start || b.end - a.end || a.event.id.localeCompare(b.event.id));
}
export function timeBounds(events: CalendarEvent[], days: string[]) {
  const slots = days.flatMap(day => timedEvents(events, day));
  return {start: Math.floor(Math.min(420, ...slots.map(s => s.start)) / 60) * 60,
    end: Math.ceil(Math.max(1200, ...slots.map(s => s.end)) / 60) * 60};
}
export function layoutDay(events: CalendarEvent[], day: string) {
  const slots = timedEvents(events, day).map(slot => ({...slot, lane: 0, lanes: 1}));
  let group: typeof slots = [], ends: number[] = [], groupEnd = -1;
  function finish() { for (const slot of group) slot.lanes = ends.length; }
  for (const slot of slots) {
    if (slot.start >= groupEnd) { finish(); group = []; ends = []; groupEnd = -1; }
    const free = ends.findIndex(end => end <= slot.start);
    slot.lane = free < 0 ? ends.length : free;
    ends[slot.lane] = slot.end;
    group.push(slot); groupEnd = Math.max(groupEnd, slot.end);
  }
  finish();
  return slots;
}
