export const EVENT_TYPES = {site_visit:"現調",repair_work:"工事",inspection:"点検",estimate_visit:"見積訪問",other:"その他"} as const;
export type CalendarEvent = {
  id: string; title: string; event_type: string; starts_at: string; ends_at: string | null;
  all_day: boolean; status: string; repair_request_id: number | null;
  vendor_dispatch_id: string | null; notes: string | null; source_type: string;
};
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type CalendarRepair = {id:number;property_name:string;room_number:string;category:string};
export function japanDay(now: number) { return new Date(now+9*3600000).toISOString().slice(0,10); }
export function nextDay(day: string, offset=1) { return new Date(Date.parse(day+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10); }
export function localInstant(day: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const timestamp=Date.parse(`${day}T${time}:00+09:00`);
  if (!Number.isFinite(timestamp) || japanDay(timestamp)!==day) return null;
  return new Date(timestamp).toISOString();
}
export function eventsOnDay(events: CalendarEvent[], day: string) {
  const start=Date.parse(`${day}T00:00:00+09:00`), end=start+86400000;
  return events.filter(event => Date.parse(event.starts_at)<end &&
    (event.ends_at ? Date.parse(event.ends_at)>start : Date.parse(event.starts_at)>=start))
    .sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.id.localeCompare(b.id));
}
export function upcomingDays(events: CalendarEvent[], now: number) {
  const today=japanDay(now);
  return [today,nextDay(today)].map(day=>({day,events:eventsOnDay(events,day).filter(e=>e.status==='scheduled')}));
}
export function isOverdue(event: CalendarEvent, now: number) {
  // All-day appointments have no start time; mark overdue only after their day ends.
  return event.status==='scheduled' && now>Date.parse(event.all_day ? event.ends_at || event.starts_at : event.starts_at);
}
export function eventTime(event: CalendarEvent) {
  return event.all_day ? '終日' : new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(event.starts_at));
}
export function pastPendingEvents(events: CalendarEvent[], now: number) {
  const displayed=new Set(upcomingDays(events,now).flatMap(group=>group.events.map(event=>event.id)));
  return events.filter(event=>!displayed.has(event.id)&&isOverdue(event,now))
    .sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.id.localeCompare(b.id));
}
export function parseCalendarInput(input: unknown) {
  if (!input || typeof input!=='object') return null;
  const v=input as Record<string,unknown>;
  if (typeof v.id!=='string' || !UUID.test(v.id) || (v.repairId!==null&&(!Number.isSafeInteger(v.repairId) || Number(v.repairId)<=0)) ||
    (v.dispatchId!==null && (typeof v.dispatchId!=='string'||!UUID.test(v.dispatchId))) ||
    (v.repairId===null&&v.dispatchId!==null) ||
    (v.title!==undefined&&(typeof v.title!=='string'||!v.title.trim()||v.title.trim().length>300)) ||
    ((v.repairId===null||v.edit===true)&&typeof v.title!=='string') ||
    typeof v.eventType!=='string' || !Object.hasOwn(EVENT_TYPES,v.eventType) ||
    typeof v.date!=='string' || typeof v.start!=='string' || typeof v.end!=='string' ||
    typeof v.notes!=='string' || v.notes.length>3000 || typeof v.allDay!=='boolean' || typeof v.edit!=='boolean') return null;
  const starts=localInstant(v.date,v.allDay?'00:00':v.start);
  if (!starts) return null;
  const ends=v.allDay ? localInstant(nextDay(v.date),'00:00') : v.end ? localInstant(v.date,v.end) : null;
  if ((!v.allDay&&v.end&&!ends) || (ends&&ends<=starts)) return null;
  return {id:v.id,title:typeof v.title==='string'?v.title.trim():null,repairId:v.repairId===null?null:Number(v.repairId),dispatchId:v.dispatchId as string|null,eventType:v.eventType as keyof typeof EVENT_TYPES,
    starts,ends,notes:v.notes.trim()||null,allDay:v.allDay,edit:v.edit};
}
