import { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { attachmentUuid, isLineAttachmentPath, LINE_ATTACHMENT_BUCKET } from "@/lib/line-attachment-access";
import { parseRepairId } from "@/lib/repair-id";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const failure = (status: number) => new Response("添付ファイルを表示できません。", { status, headers });
export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const staff = await getStaffContext();
    if (!staff.ok) return staff.reason === "unauthenticated" ? new Response(null, { status: 303, headers: { ...headers, Location: new URL("/admin/login", request.url).toString() } }) : failure(403);
    const { fileId } = await context.params;
    if (!attachmentUuid.test(fileId)) return failure(404);
    const requestedIds = new URL(request.url).searchParams.getAll("repairId");
    const repairId = requestedIds.length === 1 ? parseRepairId(requestedIds[0]) : null;
    if (requestedIds.length && repairId === null) return failure(404);
    const signal = AbortSignal.timeout(8_000);
    const db = createServerSupabaseClient((input, init) => fetch(input, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }));
    let query = db.from("tenant_line_attachments")
      .select("id, organization_id, tenant_account_id, repair_request_id, storage_path, media_type, mime_type")
      .eq("id", fileId).eq("organization_id", staff.organizationId);
    query = repairId === null ? query.is("repair_request_id", null) : query.eq("repair_request_id", repairId);
    const { data: file, error } = await query.abortSignal(signal).maybeSingle();
    if (error) return failure(503);
    if (!file || file.id !== fileId || file.organization_id !== staff.organizationId || file.repair_request_id !== repairId) return failure(404);
    if (!isLineAttachmentPath(file, staff.organizationId)) return failure(403);
    if (repairId !== null) {
      const { data: repair, error: repairError } = await db.from("repair_requests")
        .select("id, organization_id, tenant_account_id").eq("id", repairId)
        .eq("organization_id", staff.organizationId).eq("tenant_account_id", file.tenant_account_id)
        .abortSignal(signal).maybeSingle();
      if (repairError) return failure(503);
      if (!repair || repair.id !== repairId || repair.organization_id !== staff.organizationId || repair.tenant_account_id !== file.tenant_account_id) return failure(404);
    }
    const { data: tenant, error: tenantError } = await db.from("tenant_accounts").select("id, organization_id")
      .eq("id", file.tenant_account_id).eq("organization_id", staff.organizationId).abortSignal(signal).maybeSingle();
    if (tenantError) return failure(503);
    if (!tenant || tenant.id !== file.tenant_account_id || tenant.organization_id !== staff.organizationId) return failure(404);
    const signed = await db.storage.from(LINE_ATTACHMENT_BUCKET).createSignedUrl(file.storage_path, file.media_type === "image" ? 300 : 120);
    if (signed.error || !signed.data?.signedUrl) return failure(503);
    return new Response(null, { status: 303, headers: { ...headers, Location: signed.data.signedUrl } });
  } catch { return failure(503); }
}
