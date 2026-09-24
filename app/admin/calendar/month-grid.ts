import { nextDay } from "../calendar-state";

export function shiftMonth(month: string, offset: number) {
  return new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5))-1+offset,1)).toISOString().slice(0,7);
}

// Full Sunday?Saturday weeks, with at least five rows even in a four-week February.
export function monthDays(month: string) {
  const first=month+'-01';
  const offset=new Date(first+'T00:00:00Z').getUTCDay();
  const last=Number(nextDay(shiftMonth(month,1)+'-01',-1).slice(-2));
  const size=Math.max(35,Math.ceil((offset+last)/7)*7);
  return Array.from({length:size},(_,i)=>nextDay(first,i-offset));
}
