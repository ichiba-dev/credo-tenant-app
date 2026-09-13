import { createAuthServerClient } from "@/lib/supabase-auth/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { ESTIMATE_BUCKET, isExpectedEstimateStoragePath } from "@/lib/estimate-files";
import { parseRepairId } from "@/lib/repair-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ repairId: string; fileId: string }> };

function failure(status: number) {
  return new Response(status === 404 ? "見積書が見つかりません。" : "見積書を表示できません。", {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

export async function GET(_request: Request, context: Context) {
  const { repairId: rawRepairId, fileId } = await context.params;
  const repairId = parseRepairId(rawRepairId);
  if (repairId === null || !UUID.test(fileId)) return failure(404);

  const auth = await createAuthServerClient();
  const { data: { user }, error: authError } = await auth.auth.getUser();
  if (authError || !user) return failure(401);

  const service = createServerSupabaseClient();
  const { data: owner, error: ownerError } = await service.from("owners")
    .select("id").eq("auth_user_id", user.id).maybeSingle();
  if (ownerError || !owner) return failure(404);

  const { data: file, error: fileError } = await service.from("owner_report_estimate_files")
    .select("id, organization_id, repair_request_id, owner_report_id, storage_path")
    .eq("id", fileId).eq("repair_request_id", repairId).is("deleted_at", null).maybeSingle();
  if (fileError || !file || file.repair_request_id !== repairId) return failure(404);

  const [recipientResult, reportResult, repairResult] = await Promise.all([
    service.from("owner_report_recipients")
      .select("owner_report_id, owner_id, organization_id")
      .eq("owner_report_id", file.owner_report_id).eq("owner_id", owner.id)
      .eq("organization_id", file.organization_id).maybeSingle(),
    service.from("owner_reports")
      .select("id, repair_request_id, organization_id")
      .eq("id", file.owner_report_id).eq("repair_request_id", repairId)
      .eq("organization_id", file.organization_id).maybeSingle(),
    service.from("repair_requests")
      .select("id, organization_id").eq("id", repairId)
      .eq("organization_id", file.organization_id).maybeSingle(),
  ]);
  if (recipientResult.error || reportResult.error || repairResult.error ||
      !recipientResult.data || !reportResult.data || !repairResult.data) return failure(404);
  if (recipientResult.data.owner_report_id !== file.owner_report_id || recipientResult.data.owner_id !== owner.id ||
      recipientResult.data.organization_id !== file.organization_id || reportResult.data.organization_id !== file.organization_id ||
      reportResult.data.repair_request_id !== repairId || repairResult.data.organization_id !== file.organization_id) return failure(403);
  if (!isExpectedEstimateStoragePath(file.storage_path, file.organization_id, repairId, file.owner_report_id)) return failure(403);

  const { data: signed, error: signError } = await service.storage.from(ESTIMATE_BUCKET).createSignedUrl(file.storage_path, 120);
  if (signError || !signed?.signedUrl) return failure(503);
  return Response.redirect(signed.signedUrl, 303);
}
