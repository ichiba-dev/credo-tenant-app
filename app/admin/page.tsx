import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { getAdminRepairs } from "./data";
import AdminRepairs from "./admin-repairs";
import { getAdminEstimateData } from "./estimate-data";
import { getAdminTenantMessages } from "./message-data";
import { getUnassignedLineMessages } from "./line-message-data";
import LineMessageSection from "./line-message-section";
import type { UnassignedLineMessage } from "./types";

export default async function AdminPage() {
  const context = await getStaffContext();
  if (!context.ok) redirect("/admin/login");
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
  return <AdminRepairs key={context.organizationId} repairs={repairs} canUpdate={context.canUpdate}>
    <LineMessageSection messages={lineMessages} unavailable={lineMessagesUnavailable} canUpdate={context.canUpdate} />
  </AdminRepairs>;
}
