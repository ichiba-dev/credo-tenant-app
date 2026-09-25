"use server";
import { revalidatePath } from "next/cache";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { EVENT_TYPES, parseCalendarInput, UUID, type CalendarRepair } from "./calendar-state";

export async function findCalendarRepairs(search: string, repairId?: number): Promise<{items:CalendarRepair[];message:string}> {
  try {
    const context=await getStaffContext();
    if (!context.ok || typeof search!=='string' || search.length>100 || (repairId!==undefined&&(!Number.isSafeInteger(repairId)||repairId<=0))) return {items:[],message:'案件を取得できません。'};
    let query=context.supabase.from('repair_requests').select('id,property_name,room_number,category').eq('organization_id',context.organizationId);
    if (repairId!==undefined) query=query.eq('id',repairId);
    else query=query.ilike('property_name',`%${search.trim().replace(/[\\%_]/g,'\\$&')}%`);
    const result=await query.order('id',{ascending:false}).limit(30);
    if(result.error) return {items:[],message:'案件を取得できません。'};
    return {items:(result.data??[]) as CalendarRepair[],message:''};
  } catch { return {items:[],message:'案件を取得できません。'}; }
}

export async function saveCalendarEvent(input: unknown) {
  try {
    const context=await getStaffContext();
    if (!context.ok || !context.canUpdate) return {ok:false,message:"予定を変更する権限がありません。"};
    const parsed=parseCalendarInput(input);
    if (!parsed) return {ok:false,message:"日付・時刻・入力内容を確認してください。終了は開始より後に指定してください。"};
    let repair:CalendarRepair|null=null;
    if(parsed.repairId!==null) {
    const {data,error}=await context.supabase.from('repair_requests').select('id,property_name,room_number,category')
      .eq('organization_id',context.organizationId).eq('id',parsed.repairId).maybeSingle();
    if (error||!data) return {ok:false,message:"対象の修理案件を確認できません。"};
    repair=data as CalendarRepair;
    }
    if (parsed.dispatchId) {
      const result=await context.supabase.from('repair_vendor_dispatches').select('id')
        .eq('organization_id',context.organizationId).eq('repair_request_id',parsed.repairId).eq('id',parsed.dispatchId).maybeSingle();
      if (result.error||!result.data) return {ok:false,message:"対象の業者手配を確認できません。"};
    }
    const title=parsed.title??(repair?`${repair.property_name} ${repair.room_number}号室 - ${repair.category} ${EVENT_TYPES[parsed.eventType]}`.slice(0,300):'');
    if(!title) return {ok:false,message:'タイトルを入力してください。'};
    const fields={title,
      event_type:parsed.eventType,starts_at:parsed.starts,ends_at:parsed.ends,all_day:parsed.allDay,notes:parsed.notes};
    const table=context.supabase.from('calendar_events');
    let query;
    if (parsed.edit) {
      query=table.update(fields).eq('organization_id',context.organizationId).eq('id',parsed.id)
        .eq('status','scheduled');
      query=parsed.repairId===null?query.is('repair_request_id',null):query.eq('repair_request_id',parsed.repairId);
      query=parsed.dispatchId ? query.eq('vendor_dispatch_id',parsed.dispatchId) : query.is('vendor_dispatch_id',null);
    } else {
      query=table.insert({...fields,id:parsed.id,organization_id:context.organizationId,created_by:context.userId,
        repair_request_id:parsed.repairId,vendor_dispatch_id:parsed.dispatchId,source_type:parsed.dispatchId?'vendor_dispatch':parsed.repairId?'repair':'manual'});
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
