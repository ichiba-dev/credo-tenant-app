"use server";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import type { RepairCalendarEvent } from "./repair-calendar-state";

// Read only, through the staff session and existing calendar_events RLS.
export async function readRepairCalendar(repairId:number):Promise<{ok:boolean;events:RepairCalendarEvent[]}> {
  try {
    const context=await getStaffContext();
    if(!context.ok||!Number.isSafeInteger(repairId)||repairId<=0)return {ok:false,events:[]};
    const events:RepairCalendarEvent[]=[];
    for(let offset=0;;offset+=500) {
      const result=await context.supabase.from('calendar_events')
        .select('id,title,event_type,starts_at,ends_at,all_day,status,repair_request_id,vendor_dispatch_id,notes,source_type,updated_at')
        .eq('organization_id',context.organizationId).eq('repair_request_id',repairId)
        .order('starts_at').order('id').range(offset,offset+499);
      if(result.error)return {ok:false,events:[]};
      events.push(...(result.data??[]) as RepairCalendarEvent[]);
      if((result.data??[]).length<500)return {ok:true,events};
    }
  } catch {return {ok:false,events:[]};}
}
