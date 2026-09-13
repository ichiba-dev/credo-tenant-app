import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase-server";

export type OwnerRepairListItem = {
  repairId: number;
  propertyName: string;
  roomNumber: string;
  category: string;
  description: string;
  repairCreatedAt: string;
  reportCreatedAt: string;
  decision: string | null;
};

export async function getOwnerRepairList(ownerId: string | number): Promise<OwnerRepairListItem[]> {
  const service = createServerSupabaseClient();
  const { data: recipients, error: recipientError } = await service
    .from("owner_report_recipients")
    .select("owner_id, owner_report_id, organization_id")
    .eq("owner_id", ownerId);
  if (recipientError || !recipients) throw new Error("OWNER_REPAIR_LIST_UNAVAILABLE");
  if (recipients.some((row) => row.owner_id !== ownerId || !row.owner_report_id || !row.organization_id)) {
    throw new Error("OWNER_REPAIR_LIST_SCOPE_INVALID");
  }

  const recipientByReport = new Map<string, string>();
  for (const row of recipients) recipientByReport.set(row.owner_report_id, row.organization_id);
  const reportIds = [...recipientByReport.keys()];
  if (reportIds.length === 0) return [];

  const { data: reports, error: reportError } = await service
    .from("owner_reports")
    .select("id, organization_id, repair_request_id, created_at")
    .in("id", reportIds)
    .order("created_at", { ascending: false });
  if (reportError || !reports) throw new Error("OWNER_REPAIR_LIST_UNAVAILABLE");
  if (reports.length !== reportIds.length || reports.some((report) =>
    recipientByReport.get(report.id) !== report.organization_id || !Number.isSafeInteger(report.repair_request_id))) {
    throw new Error("OWNER_REPAIR_LIST_SCOPE_INVALID");
  }

  const latestByRepair = new Map<number, typeof reports[number]>();
  for (const report of reports) {
    if (!latestByRepair.has(report.repair_request_id)) latestByRepair.set(report.repair_request_id, report);
  }
  const selectedReports = [...latestByRepair.values()];
  const repairIds = selectedReports.map((report) => report.repair_request_id);

  const [{ data: repairs, error: repairError }, { data: approvals, error: approvalError }] = await Promise.all([
    service.from("repair_requests")
      .select("id, organization_id, property_name, room_number, category, description, created_at")
      .in("id", repairIds),
    service.from("owner_approvals")
      .select("owner_id, owner_report_id, organization_id, decision")
      .eq("owner_id", ownerId)
      .in("owner_report_id", selectedReports.map((report) => report.id)),
  ]);
  if (repairError || approvalError || !repairs || !approvals) throw new Error("OWNER_REPAIR_LIST_UNAVAILABLE");

  const reportByRepair = new Map(selectedReports.map((report) => [report.repair_request_id, report]));
  if (repairs.length !== repairIds.length || repairs.some((repair) =>
    reportByRepair.get(repair.id)?.organization_id !== repair.organization_id)) {
    throw new Error("OWNER_REPAIR_LIST_SCOPE_INVALID");
  }
  const reportById = new Map(selectedReports.map((report) => [report.id, report]));
  if (approvals.some((approval) => approval.owner_id !== ownerId ||
    reportById.get(approval.owner_report_id)?.organization_id !== approval.organization_id)) {
    throw new Error("OWNER_REPAIR_LIST_SCOPE_INVALID");
  }
  const approvalByReport = new Map(approvals.map((approval) => [approval.owner_report_id, approval.decision as string | null]));

  return repairs.map((repair) => {
    const report = reportByRepair.get(repair.id)!;
    return {
      repairId: repair.id,
      propertyName: repair.property_name,
      roomNumber: repair.room_number,
      category: repair.category,
      description: repair.description,
      repairCreatedAt: repair.created_at,
      reportCreatedAt: report.created_at,
      decision: approvalByReport.get(report.id) ?? null,
    };
  }).sort((a, b) => b.reportCreatedAt.localeCompare(a.reportCreatedAt));
}
