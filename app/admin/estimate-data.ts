import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { OwnerReportEstimates } from "./types";

export async function getAdminEstimateData(organizationId: string, repairIds: number[]): Promise<Record<number, OwnerReportEstimates | null>> {
  const result: Record<number, OwnerReportEstimates | null> = Object.fromEntries(repairIds.map((id) => [id, null]));
  if (!organizationId || repairIds.length === 0) return result;

  const service = createServerSupabaseClient();
  const { data: repairs, error: repairError } = await service.from("repair_requests")
    .select("id, organization_id")
    .eq("organization_id", organizationId)
    .in("id", repairIds);
  if (repairError || !repairs || repairs.length !== repairIds.length || repairs.some((row) => row.organization_id !== organizationId)) {
    throw new Error("見積書の対象案件を確認できませんでした。");
  }

  const { data: reports, error: reportError } = await service.from("owner_reports")
    .select("id, repair_request_id, created_at")
    .in("repair_request_id", repairIds)
    .order("created_at", { ascending: false });
  if (reportError || !reports) throw new Error("オーナー報告を取得できませんでした。");

  const reportByRepair = new Map<number, { id: string }>();
  for (const report of reports) {
    if (repairIds.includes(report.repair_request_id) && !reportByRepair.has(report.repair_request_id)) {
      reportByRepair.set(report.repair_request_id, { id: report.id });
    }
  }
  for (const repairId of reportByRepair.keys()) result[repairId] = { files: [] };
  if (reportByRepair.size === 0) return result;

  const reportIds = [...reportByRepair.values()].map((report) => report.id);
  const { data: files, error: fileError } = await service.from("owner_report_estimate_files")
    .select("id, organization_id, repair_request_id, owner_report_id, original_filename, mime_type, file_size, sort_order, created_at")
    .eq("organization_id", organizationId)
    .in("owner_report_id", reportIds)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  if (fileError || !files) throw new Error("見積書を取得できませんでした。");

  for (const file of files) {
    const report = reportByRepair.get(file.repair_request_id);
    if (!report || report.id !== file.owner_report_id || file.organization_id !== organizationId) {
      throw new Error("見積書の閲覧権限を確認できませんでした。");
    }
    result[file.repair_request_id]?.files.push({
      id: file.id,
      original_filename: file.original_filename,
      mime_type: file.mime_type,
      file_size: Number(file.file_size),
      sort_order: file.sort_order,
      created_at: file.created_at,
    });
  }
  return result;
}
