import { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  ESTIMATE_BUCKET, MAX_ESTIMATE_FILES, MAX_ESTIMATE_FILE_SIZE,
  createEstimateStoragePath, hasMatchingEstimateMagic,
  isAllowedEstimateMime, validateOriginalFilename,
} from "@/lib/estimate-files";

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

type Context = { params: Promise<{ repairId: string }> };

export async function POST(request: Request, context: Context) {
  const staff = await getStaffContext();
  if (!staff.ok) return jsonError("ログインまたはスタッフ所属を確認できません。", staff.reason === "unauthenticated" ? 401 : 403);
  if (!staff.canUpdate) return jsonError("閲覧専用ユーザーは見積書を追加できません。", 403);

  const repairId = Number((await context.params).repairId);
  if (!Number.isSafeInteger(repairId) || repairId <= 0) return jsonError("案件IDが正しくありません。", 400);

  let formData: FormData;
  try { formData = await request.formData(); }
  catch { return jsonError("ファイルを読み取れませんでした。", 400); }
  const file = formData.get("file");
  if (!(file instanceof File)) return jsonError("ファイルを選択してください。", 400);
  if (!validateOriginalFilename(file.name)) return jsonError("ファイル名は1〜255文字で指定してください。", 400);
  if (file.size <= 0 || file.size > MAX_ESTIMATE_FILE_SIZE) return jsonError("ファイルは15MB以下にしてください。", 413);
  if (!isAllowedEstimateMime(file.type)) return jsonError("PDF、JPEG、PNGのみアップロードできます。", 415);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasMatchingEstimateMagic(bytes, file.type)) return jsonError("ファイルの内容と形式が一致しません。", 415);

  const service = createServerSupabaseClient();
  const { data: repair, error: repairError } = await service.from("repair_requests")
    .select("id, organization_id").eq("id", repairId).eq("organization_id", staff.organizationId).maybeSingle();
  if (repairError || !repair || repair.organization_id !== staff.organizationId) return jsonError("対象案件を確認できません。", 404);

  const { data: report, error: reportError } = await service.from("owner_reports")
    .select("id, repair_request_id").eq("repair_request_id", repair.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (reportError || !report || report.repair_request_id !== repair.id) return jsonError("先にオーナー報告を作成してください。", 409);

  const { data: existing, error: existingError } = await service.from("owner_report_estimate_files")
    .select("id, sort_order").eq("organization_id", staff.organizationId)
    .eq("repair_request_id", repair.id).eq("owner_report_id", report.id).is("deleted_at", null);
  if (existingError || !existing) return jsonError("登録済み見積書を確認できません。", 500);
  if (existing.length >= MAX_ESTIMATE_FILES) return jsonError("見積書は最大10ファイルです。", 409);

  const fileId = crypto.randomUUID();
  const storagePath = createEstimateStoragePath(staff.organizationId, repair.id, report.id, fileId, file.type);
  const storage = service.storage.from(ESTIMATE_BUCKET);
  const { error: uploadError } = await storage.upload(storagePath, bytes, { contentType: file.type, upsert: false });
  if (uploadError) return jsonError("Storageへのアップロードに失敗しました。", 500);

  const sortOrder = existing.reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), 0) + 1;
  const { error: insertError } = await service.from("owner_report_estimate_files").insert({
    id: fileId, organization_id: staff.organizationId, repair_request_id: repair.id,
    owner_report_id: report.id, storage_path: storagePath, original_filename: file.name,
    mime_type: file.type, file_size: file.size, sort_order: sortOrder, uploaded_by: staff.userId,
  });
  if (insertError) {
    await storage.remove([storagePath]);
    return jsonError("見積書情報の登録に失敗しました。再読み込みしてご確認ください。", 500);
  }
  return Response.json({ ok: true }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
