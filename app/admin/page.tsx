import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { getAdminRepairs } from "./data";
import AdminRepairs from "./admin-repairs";
import { getAdminEstimateData } from "./estimate-data";
import { getAdminTenantMessages } from "./message-data";
import { getUnassignedLineMessages } from "./line-message-data";
import LineMessageSection from "./line-message-section";
import type { UnassignedLineMessage } from "./types";
import { getLinkedLineMessages, mergeRepairMessages } from "./linked-line-message-data";
import { getUnassignedLineAttachments } from "./line-attachment-data";
import LineAttachmentSection from "./line-attachment-section";
import type { UnassignedLineAttachment } from "./types";
import { getLinkedLineAttachments } from "./linked-line-attachment-data";
import { getOutboundAttachments } from "./outbound-attachment-data";
import { getVendorDispatchData } from "./vendor-dispatch-data";

export default async function AdminPage() {
  const context = await getStaffContext();
  if (!context.ok) redirect("/admin/login");
  let attachments: UnassignedLineAttachment[] = [];
  let attachmentsUnavailable = false;
  try { attachments = await getUnassignedLineAttachments(context); }
  catch { attachmentsUnavailable = true; }
  let lineMessages: UnassignedLineMessage[] = [];
  let lineMessagesUnavailable = false;
  try {
    lineMessages = await getUnassignedLineMessages(context);
  } catch {
    lineMessagesUnavailable = true;
  }
  let repairs;
  try {
    repairs = await getAdminRepairs(context);
    const estimates = await getAdminEstimateData(context.organizationId, repairs.map((repair) => repair.id));
    const messages = await getAdminTenantMessages(context.organizationId, repairs.map((repair) => repair.id));
    repairs = repairs.map((repair) => ({ ...repair, owner_report_estimates: estimates[repair.id] ?? null, tenant_messages: messages[repair.id] ?? [] }));
  } catch {
    return <main className="p-6"><p role="alert">案件・写真・見積書を取得できませんでした。時間をおいて再読み込みしてください。</p></main>;
  }
  try {
    const linked = await getLinkedLineMessages(context, repairs.map(repair => repair.id));
    repairs = repairs.map(repair => ({ ...repair, tenant_messages: mergeRepairMessages(repair.tenant_messages, linked[repair.id] ?? []) }));
  } catch {
    repairs = repairs.map(repair => ({ ...repair, line_messages_unavailable: true }));
  }
  try {
    const linkedAttachments = await getLinkedLineAttachments(context, repairs.map(repair => repair.id));
    repairs = repairs.map(repair => ({ ...repair, tenant_messages: mergeRepairMessages(repair.tenant_messages, linkedAttachments[repair.id] ?? []) }));
  } catch {
    repairs = repairs.map(repair => ({ ...repair, line_attachments_unavailable: true }));
  }
  try {
    const outbound = await getOutboundAttachments(context.organizationId, repairs.map(repair => repair.id));
    repairs = repairs.map(repair => ({ ...repair, tenant_messages: mergeRepairMessages(repair.tenant_messages, outbound[repair.id] ?? []) }));
  } catch {
    repairs = repairs.map(repair => ({ ...repair, line_attachments_unavailable: true }));
  }
  try {
    const vendorData = await getVendorDispatchData(context, repairs.map((repair) => repair.id));
    repairs = repairs.map((repair) => ({ ...repair,
      vendor_dispatches: vendorData.byRepair[repair.id] ?? [],
      vendor_candidates: vendorData.candidates,
    }));
  } catch {
    repairs = repairs.map((repair) => ({ ...repair, vendor_dispatch_unavailable: true }));
  }
  return <AdminRepairs key={context.organizationId} repairs={repairs} canUpdate={context.canUpdate} replyScope={`${context.organizationId}:${context.userId}`}>
    <LineMessageSection messages={lineMessages} unavailable={lineMessagesUnavailable} canUpdate={context.canUpdate} />
    <LineAttachmentSection attachments={attachments} unavailable={attachmentsUnavailable} canUpdate={context.canUpdate} />
  </AdminRepairs>;
}
