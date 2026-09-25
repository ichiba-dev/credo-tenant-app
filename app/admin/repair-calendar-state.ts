import { japanDay, localInstant, type CalendarEvent } from "./calendar-state";
import { typeLabel } from "./calendar/scheduler";

export type RepairCalendarEvent=CalendarEvent & {updated_at:string};
export const calendarStatus={scheduled:'予定',completed:'完了',cancelled:'キャンセル'};
export function repairCalendarEvents(events:RepairCalendarEvent[],repairId:number) {
  return events.filter(e=>e.repair_request_id===repairId).sort((a,b)=>
    Number(b.status==='scheduled')-Number(a.status==='scheduled')||a.starts_at.localeCompare(b.starts_at)||a.id.localeCompare(b.id));
}
export function repairCalendarLink(event:CalendarEvent) {
  const day=japanDay(Date.parse(event.starts_at));
  return `/admin/calendar?month=${day.slice(0,7)}&day=${day}&view=day`;
}
export function repairCalendarTimeline(history:string|null,events:RepairCalendarEvent[]) {
  const entries:{id:string;at:string|null;text:string;event?:RepairCalendarEvent}[]=[];
  for(const [index,line] of (history??'').split('\n').entries()) {
    if(!line.trim())continue;
    const match=/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.+)$/.exec(line.trim());
    const at=match?localInstant(`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`,`${match[4].padStart(2,'0')}:${match[5]}`):null;
    entries.push({id:`history-${index}`,at:at&&match?new Date(Date.parse(at)+Number(match[6]??0)*1000).toISOString():null,text:at&&match?match[7]:line});
  }
  for(const event of events) {
    entries.push({id:`${event.id}-planned`,at:event.starts_at,text:`${typeLabel(event.event_type)}予定 · ${event.title}`,event});
    if(event.status==='completed'||event.status==='cancelled')entries.push({id:`${event.id}-closed`,at:event.updated_at,
      text:`${typeLabel(event.event_type)}予定を${calendarStatus[event.status]} · ${event.title}`,event});
  }
  return entries.sort((a,b)=>(a.at?Date.parse(a.at):Infinity)-(b.at?Date.parse(b.at):Infinity)||a.id.localeCompare(b.id));
}
