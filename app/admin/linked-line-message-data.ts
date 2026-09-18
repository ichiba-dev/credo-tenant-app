import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { getStaffContext } from "@/lib/supabase-auth/staff";
import type { TenantRepairMessage } from "./types";

type StaffContext = Extract<Awaited<ReturnType<typeof getStaffContext>>, { ok: true }>;

export async function getLinkedLineMessages(context: StaffContext, repairIds: number[]): Promise<Record<number, TenantRepairMessage[]>> {
  if (!context.ok || !context.organizationId) throw new Error("LINE_SCOPE_INVALID");
  const ids = [...new Set(repairIds)];
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("LINE_SCOPE_INVALID");
  if (!ids.length) return {};
  const db = createServerSupabaseClient();
  const signal = AbortSignal.timeout(8_000);
  const { data: messages, error } = await db.from("tenant_line_messages")
    .select("id, organization_id, tenant_account_id, repair_request_id, sender_type, channel, message, line_sent_at, created_at")
    .eq("organization_id", context.organizationId).in("repair_request_id", ids)
    .eq("sender_type", "tenant").eq("channel", "line")
    .order("created_at", { ascending: true }).order("id", { ascending: true }).abortSignal(signal);
  if (error || !messages || messages.some(item => item.organization_id !== context.organizationId ||
    !ids.includes(item.repair_request_id) || item.channel !== "line" || item.sender_type !== "tenant" ||
    !item.tenant_account_id)) throw new Error("LINE_MESSAGES_UNAVAILABLE");
  if (!messages.length) return {};
  const tenantIds = [...new Set(messages.map(item => item.tenant_account_id as string))];
  const { data: tenants, error: tenantError } = await db.from("tenant_accounts")
    .select("id, organization_id, display_name").eq("organization_id", context.organizationId)
    .in("id", tenantIds).abortSignal(signal);
  if (tenantError || !tenants || tenants.some(item => item.organization_id !== context.organizationId ||
    !tenantIds.includes(item.id))) throw new Error("LINE_SENDERS_UNAVAILABLE");
  const names = new Map(tenants.map(item => [item.id, item.display_name || "入居者"]));
  if (tenantIds.some(id => !names.has(id))) throw new Error("LINE_SENDERS_UNAVAILABLE");
  const grouped: Record<number, TenantRepairMessage[]> = {};
  for (const item of messages) {
    const sentAt = typeof item.line_sent_at === "string" && Number.isFinite(Date.parse(item.line_sent_at))
      ? item.line_sent_at : item.created_at;
    if (!Number.isFinite(Date.parse(sentAt))) throw new Error("LINE_DATE_INVALID");
    (grouped[item.repair_request_id] ??= []).push({ id: `line:${item.id}`, sender_type: "tenant",
      sender_name: names.get(item.tenant_account_id)!, message: item.message, created_at: sentAt, channel: "line" });
  }
  return grouped;
}

export function mergeRepairMessages(existing: TenantRepairMessage[], line: TenantRepairMessage[]): TenantRepairMessage[] {
  return [...existing, ...line].sort((a, b) => {
    const date = Date.parse(a.created_at) - Date.parse(b.created_at);
    if (date) return date;
    const aKey = `${a.channel === "line" ? "line" : "repair"}:${a.id}`;
    const bKey = `${b.channel === "line" ? "line" : "repair"}:${b.id}`;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
}
