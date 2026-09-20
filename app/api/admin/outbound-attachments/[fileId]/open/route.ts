import { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { OUTBOUND_BUCKET } from "@/lib/outbound-media";
import { parseRepairId } from "@/lib/repair-id";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const deny = () => new Response("File unavailable", { status: 404, headers });
export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const staff=await getStaffContext();
    if(!staff.ok) return deny();
    const {fileId}=await context.params;
    const repair=parseRepairId(new URL(request.url).searchParams.get("repairId") ?? "");
    if(!/^[0-9a-f-]{36}$/i.test(fileId) || repair===null) return deny();
    const db=createServerSupabaseClient();
    const {data:a,error}=await db.from("staff_line_attachments")
      .select("id,organization_id,tenant_account_id,repair_request_id,media_type,mime_type,upload_state,storage_path")
      .eq("id",fileId).eq("organization_id",staff.organizationId).eq("repair_request_id",repair).maybeSingle();
    if(error || !a || a.id!==fileId || a.organization_id!==staff.organizationId || a.repair_request_id!==repair
      || a.upload_state!=="ready" || !a.storage_path) return deny();
    const expected=`${staff.organizationId}/line-outbound/${repair}/${fileId}.${a.mime_type==="image/jpeg"?"jpg":a.mime_type==="image/png"?"png":a.mime_type==="application/pdf"?"pdf":"invalid"}`;
    if(a.storage_path!==expected) return deny();
    const [{data:repairRow},{data:push}]=await Promise.all([
      db.from("repair_requests").select("id").eq("id",repair).eq("organization_id",staff.organizationId)
        .eq("tenant_account_id",a.tenant_account_id).maybeSingle(),
      db.from("staff_line_attachment_pushes").select("id").eq("organization_id",staff.organizationId)
        .eq("tenant_account_id",a.tenant_account_id).eq("attachment_id",fileId).eq("status","accepted").maybeSingle(),
    ]);
    if(!repairRow || !push) return deny();
    const signed=await db.storage.from(OUTBOUND_BUCKET).createSignedUrl(expected,a.media_type==="image"?300:120);
    if(signed.error || !signed.data?.signedUrl) return deny();
    return new Response(null,{status:303,headers:{...headers,Location:signed.data.signedUrl}});
  }catch{return deny();}
}
