import "server-only";
import type { getStaffContext } from "@/lib/supabase-auth/staff";
import type { CalendarEvent } from "./calendar-state";
type Context=Extract<Awaited<ReturnType<typeof getStaffContext>>,{ok:true}>;
// A null lower bound is the overview: retain every overdue scheduled appointment.
export async function getCalendarEvents(context: Context, from: string | null, until: string): Promise<CalendarEvent[]> {
  const rows: CalendarEvent[]=[];
  for (let offset=0;;offset+=500) {
    let query=context.supabase.from('calendar_events')
      .select('id,title,event_type,starts_at,ends_at,all_day,status,repair_request_id,vendor_dispatch_id,notes,source_type')
      .eq('organization_id',context.organizationId).lt('starts_at',until);
    query=from ? query.or(`starts_at.gte.${from},ends_at.gt.${from}`) : query.eq('status','scheduled');
    const result=await query.order('starts_at').order('id').range(offset,offset+499);
    if (result.error) throw new Error('CALENDAR_UNAVAILABLE');
    rows.push(...(result.data??[]) as CalendarEvent[]);
    if ((result.data??[]).length<500) return rows;
  }
}
