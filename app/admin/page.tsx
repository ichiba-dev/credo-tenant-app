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
import UnassignedLineNotice from "./unassigned-line-notice";
import { getCalendarEvents } from "./calendar-data";
import { japanDay, nextDay } from "./calendar-state";
import CalendarOverview from "./calendar-overview";
import AdminWeekCalendar from "./admin-week-calendar";
import { weekDays } from "./calendar/scheduler";

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
  const now=Date.now(),today=japanDay(now);
  let calendarEvents;
  const calendarUntil=[nextDay(today,2),nextDay(weekDays(today)[6])].sort().at(-1)!;
  try {calendarEvents=await getCalendarEvents(context,null,`${calendarUntil}T00:00:00+09:00`);}
  catch {calendarEvents=null;}
  return <AdminRepairs key={context.organizationId} repairs={repairs} canUpdate={context.canUpdate} replyScope={`${context.organizationId}:${context.userId}`} calendarOverview={
    calendarEvents?<CalendarOverview events={calendarEvents} initialNow={now} canUpdate={context.canUpdate}/>:<p role="alert" className="mb-3 text-sm text-slate-600">予定を取得できませんでした。再読み込みして確認してください。</p>
  } calendarWeek={calendarEvents?<AdminWeekCalendar events={calendarEvents} initialNow={now} canUpdate={context.canUpdate}/>:null}>
    <UnassignedLineNotice messageCount={lineMessages.length} attachmentCount={attachments.length}
      messagesUnavailable={lineMessagesUnavailable} attachmentsUnavailable={attachmentsUnavailable}>
      {(lineMessages.length > 0 || lineMessagesUnavailable) && <LineMessageSection messages={lineMessages} unavailable={lineMessagesUnavailable} canUpdate={context.canUpdate} />}
      {(attachments.length > 0 || attachmentsUnavailable) && <LineAttachmentSection attachments={attachments} unavailable={attachmentsUnavailable} canUpdate={context.canUpdate} />}
    </UnassignedLineNotice>
  </AdminRepairs>;
}
