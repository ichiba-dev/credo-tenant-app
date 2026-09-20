import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { TenantRepairMessage } from "./types";

export async function getOutboundAttachments(organizationId:string,repairIds:number[]):Promise<Record<number,TenantRepairMessage[]>> {
  if(!repairIds.length)return {};
  const db=createServerSupabaseClient();
  const {data:files,error}=await db.from("staff_line_attachments")
    .select("id,organization_id,tenant_account_id,repair_request_id,staff_auth_user_id,media_type,original_filename,file_size,finalized_at,upload_state")
    .eq("organization_id",organizationId).eq("upload_state","ready").in("repair_request_id",repairIds)
    .order("finalized_at",{ascending:true}).limit(500);
  if(error || !files)throw new Error("OUTBOUND_HISTORY_UNAVAILABLE");
  if(files.some(f=>f.organization_id!==organizationId || !repairIds.includes(f.repair_request_id)))throw new Error("OUTBOUND_HISTORY_SCOPE");
  if(!files.length)return {};
  const ids=files.map(f=>f.id);
  const {data:pushes,error:pushError}=await db.from("staff_line_attachment_pushes")
    .select("attachment_id,organization_id,tenant_account_id,status,accepted_at").eq("organization_id",organizationId)
    .eq("status","accepted").in("attachment_id",ids);
  if(pushError || !pushes)throw new Error("OUTBOUND_HISTORY_UNAVAILABLE");
  const accepted=new Map(pushes.filter(p=>p.organization_id===organizationId && !!p.accepted_at
    && files.some(f=>f.id===p.attachment_id && f.tenant_account_id===p.tenant_account_id))
    .map(p=>[p.attachment_id,p.accepted_at as string]));
  const grouped:Record<number,TenantRepairMessage[]>={};
  for(const f of files)if(accepted.has(f.id) && (f.media_type==="image" || f.media_type==="pdf") && f.finalized_at && f.file_size){
    (grouped[f.repair_request_id]??=[]).push({id:f.id,sender_type:"staff",sender_name:"管理会社",message:"",created_at:accepted.get(f.id)!,
      attachment:{id:f.id,media_type:f.media_type,original_filename:f.original_filename,file_size:Number(f.file_size),outbound:true}});
  }
  return grouped;
}
