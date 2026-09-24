"use server";
import { revalidatePath } from "next/cache";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { EVENT_TYPES, parseCalendarInput, UUID } from "./calendar-state";

export async function saveCalendarEvent(input: unknown) {
  try {
    const context=await getStaffContext();
    if (!context.ok || !context.canUpdate) return {ok:false,message:"予定を変更する権限がありません。"};
    const parsed=parseCalendarInput(input);
    if (!parsed) return {ok:false,message:"日付・時刻・入力内容を確認してください。終了は開始より後に指定してください。"};
    const {data:repair,error}=await context.supabase.from('repair_requests').select('id,property_name,room_number,category')
      .eq('organization_id',context.organizationId).eq('id',parsed.repairId).maybeSingle();
    if (error||!repair) return {ok:false,message:"対象の修理案件を確認できません。"};
    if (parsed.dispatchId) {
      const result=await context.supabase.from('repair_vendor_dispatches').select('id')
        .eq('organization_id',context.organizationId).eq('repair_request_id',parsed.repairId).eq('id',parsed.dispatchId).maybeSingle();
      if (result.error||!result.data) return {ok:false,message:"対象の業者手配を確認できません。"};
    }
    const fields={title:`${repair.property_name} ${repair.room_number}号室 - ${repair.category} ${EVENT_TYPES[parsed.eventType]}`.slice(0,300),
      event_type:parsed.eventType,starts_at:parsed.starts,ends_at:parsed.ends,all_day:parsed.allDay,notes:parsed.notes};
    const table=context.supabase.from('calendar_events');
    let query;
    if (parsed.edit) {
      query=table.update(fields).eq('organization_id',context.organizationId).eq('id',parsed.id)
        .eq('repair_request_id',parsed.repairId).eq('status','scheduled');
      query=parsed.dispatchId ? query.eq('vendor_dispatch_id',parsed.dispatchId) : query.is('vendor_dispatch_id',null);
    } else {
      query=table.insert({...fields,id:parsed.id,organization_id:context.organizationId,created_by:context.userId,
        repair_request_id:parsed.repairId,vendor_dispatch_id:parsed.dispatchId,source_type:parsed.dispatchId?'vendor_dispatch':'repair'});
    }
    const result=await query.select('id').maybeSingle();
    if (result.error||!result.data) return {ok:false,message:"保存できませんでした。再読み込みして登録状況を確認してください。"};
    revalidatePath('/admin');revalidatePath('/admin/calendar');
    return {ok:true,message:"予定を保存しました。"};
  } catch { return {ok:false,message:"予定を保存できませんでした。時間をおいて再試行してください。"}; }
}
export async function changeCalendarStatus(id: string, status: string) {
  try {
    const context=await getStaffContext();
    if (!context.ok||!context.canUpdate) return {ok:false,message:"予定を変更する権限がありません。"};
    if (typeof id!=='string'||!UUID.test(id)||!['completed','cancelled'].includes(status)) return {ok:false,message:"入力内容が不正です。"};
    const result=await context.supabase.from('calendar_events').update({status})
      .eq('organization_id',context.organizationId).eq('id',id).eq('status','scheduled').select('id').maybeSingle();
    if (result.error||!result.data) return {ok:false,message:"更新できませんでした。最新の予定を確認してください。"};
    revalidatePath('/admin');revalidatePath('/admin/calendar');
    return {ok:true,message:status==='completed'?'完了にしました。':'キャンセルしました。'};
  } catch { return {ok:false,message:"予定を変更できませんでした。"}; }
}
