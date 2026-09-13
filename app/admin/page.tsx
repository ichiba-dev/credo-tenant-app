import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { getAdminRepairs } from "./data";
import AdminRepairs from "./admin-repairs";
import { getAdminEstimateData } from "./estimate-data";
import { getAdminTenantMessages } from "./message-data";

export default async function AdminPage() {
  const context = await getStaffContext();
  if (!context.ok) redirect("/admin/login");
  let repairs;
  try {
    repairs = await getAdminRepairs(context);
    const estimates = await getAdminEstimateData(context.organizationId, repairs.map((repair) => repair.id));
    const messages = await getAdminTenantMessages(context.organizationId, repairs.map((repair) => repair.id));
    repairs = repairs.map((repair) => ({ ...repair, owner_report_estimates: estimates[repair.id] ?? null, tenant_messages: messages[repair.id] ?? [] }));
  } catch {
    return <main className="p-6"><p role="alert">案件・写真・見積書を取得できませんでした。時間をおいて再読み込みしてください。</p></main>;
  }
  return <AdminRepairs key={context.organizationId} repairs={repairs} canUpdate={context.canUpdate} />;
}
