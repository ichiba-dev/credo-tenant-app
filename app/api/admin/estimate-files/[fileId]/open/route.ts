import { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { ESTIMATE_BUCKET, isExpectedEstimateStoragePath } from "@/lib/estimate-files";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ fileId: string }> };

function failure(status: number) {
  return new Response(status === 404 ? "見積書が見つかりません。" : "見積書を表示できません。", {
    status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

export async function GET(_request: Request, context: Context) {
  const staff = await getStaffContext();
  if (!staff.ok) return failure(staff.reason === "unauthenticated" ? 401 : 403);
  const fileId = (await context.params).fileId;
  if (!UUID.test(fileId)) return failure(404);

  const service = createServerSupabaseClient();
  const { data: file, error } = await service.from("owner_report_estimate_files")
    .select("id, organization_id, repair_request_id, owner_report_id, storage_path")
    .eq("id", fileId).eq("organization_id", staff.organizationId).is("deleted_at", null).maybeSingle();
  if (error || !file || file.organization_id !== staff.organizationId) return failure(404);

  const [repairResult, reportResult] = await Promise.all([
    service.from("repair_requests").select("id, organization_id").eq("id", file.repair_request_id)
      .eq("organization_id", staff.organizationId).maybeSingle(),
    service.from("owner_reports").select("id, repair_request_id").eq("id", file.owner_report_id)
      .eq("repair_request_id", file.repair_request_id).maybeSingle(),
  ]);
  if (repairResult.error || reportResult.error || !repairResult.data || !reportResult.data) return failure(404);
  if (!isExpectedEstimateStoragePath(file.storage_path, staff.organizationId, file.repair_request_id, file.owner_report_id)) return failure(403);

  const { data, error: signError } = await service.storage.from(ESTIMATE_BUCKET).createSignedUrl(file.storage_path, 120);
  if (signError || !data?.signedUrl) return failure(503);
  return Response.redirect(data.signedUrl, 303);
}
