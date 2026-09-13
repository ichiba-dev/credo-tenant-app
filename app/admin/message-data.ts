import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { TenantRepairMessage } from "./types";

export async function getAdminTenantMessages(organizationId: string, repairIds: number[]): Promise<Record<number, TenantRepairMessage[]>> {
  if (!organizationId || repairIds.length === 0) return {};
  const ids = [...new Set(repairIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length !== repairIds.length) throw new Error("INVALID_REPAIR_SCOPE");
  const supabase = createServerSupabaseClient();
  const { data: messages, error } = await supabase.from("repair_messages")
    .select("id, organization_id, repair_request_id, sender_type, tenant_account_id, staff_auth_user_id, message, created_at")
    .eq("organization_id", organizationId).in("repair_request_id", ids).in("sender_type", ["tenant", "staff"])
    .order("created_at", { ascending: true }).order("id", { ascending: true });
  if (error || !messages) throw new Error("ADMIN_MESSAGES_UNAVAILABLE");
  if (messages.some((item) => item.organization_id !== organizationId || !["tenant", "staff"].includes(item.sender_type) || !ids.includes(item.repair_request_id) || (item.sender_type === "tenant" ? !item.tenant_account_id || item.staff_auth_user_id : item.tenant_account_id || !item.staff_auth_user_id))) throw new Error("ADMIN_MESSAGE_SCOPE_MISMATCH");

  const names = new Map<string, string>();
  const tenantIds = [...new Set(messages.filter((item) => item.sender_type === "tenant").map((item) => item.tenant_account_id as string))];
  if (tenantIds.length) {
    const { data, error: tenantError } = await supabase.from("tenant_accounts").select("id, organization_id, display_name").eq("organization_id", organizationId).in("id", tenantIds);
    if (tenantError || !data || data.some((item) => item.organization_id !== organizationId || !tenantIds.includes(item.id))) throw new Error("ADMIN_MESSAGE_SENDERS_UNAVAILABLE");
    for (const item of data) names.set(`tenant:${item.id}`, item.display_name || "\u5165\u5c45\u8005");
  }
  const staffIds = [...new Set(messages.filter((item) => item.sender_type === "staff").map((item) => item.staff_auth_user_id as string))];
  if (staffIds.length) {
    const { data, error: staffError } = await supabase.from("organization_members").select("organization_id, auth_user_id, display_name").eq("organization_id", organizationId).in("auth_user_id", staffIds);
    if (staffError || !data || data.some((item) => item.organization_id !== organizationId || !staffIds.includes(item.auth_user_id))) throw new Error("ADMIN_MESSAGE_STAFF_UNAVAILABLE");
    for (const item of data) names.set(`staff:${item.auth_user_id}`, item.display_name || "\u7ba1\u7406\u4f1a\u793e");
  }
  const grouped: Record<number, TenantRepairMessage[]> = {};
  for (const item of messages) (grouped[item.repair_request_id] ??= []).push({ id: item.id, sender_type: item.sender_type as "tenant" | "staff", sender_name: item.sender_type === "tenant" ? names.get(`tenant:${item.tenant_account_id}`) || "\u5165\u5c45\u8005" : names.get(`staff:${item.staff_auth_user_id}`) || "\u7ba1\u7406\u4f1a\u793e", message: item.message, created_at: item.created_at });
  return grouped;
}
