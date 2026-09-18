import "server-only";
import type { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { UnassignedLineMessage } from "./types";

type StaffContext = Extract<Awaited<ReturnType<typeof getStaffContext>>, { ok: true }>;
const PAGE_SIZE = 50;

export async function getUnassignedLineMessages(context: StaffContext): Promise<UnassignedLineMessage[]> {
  const { organizationId } = context;
  if (!context.ok || !organizationId) throw new Error("LINE_MESSAGES_SCOPE_INVALID");
  const db = createServerSupabaseClient();
  const signal = AbortSignal.timeout(8_000);
  const { data: messages, error } = await db.from("tenant_line_messages")
    .select("id, organization_id, tenant_account_id, repair_request_id, channel, sender_type, message, created_at")
    .eq("organization_id", organizationId).is("repair_request_id", null)
    .eq("channel", "line").eq("sender_type", "tenant")
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(PAGE_SIZE).abortSignal(signal);
  if (error || !messages) throw new Error("LINE_MESSAGES_UNAVAILABLE");
  if (messages.length > PAGE_SIZE || messages.some(item => item.organization_id !== organizationId ||
    item.repair_request_id !== null || item.channel !== "line" || item.sender_type !== "tenant" ||
    !item.tenant_account_id)) throw new Error("LINE_MESSAGES_SCOPE_INVALID");
  if (!messages.length) return [];
  const tenantIds = [...new Set(messages.map(item => item.tenant_account_id as string))];
  const { data: tenants, error: tenantError } = await db.from("tenant_accounts")
    .select("id, organization_id, display_name").eq("organization_id", organizationId)
    .in("id", tenantIds).abortSignal(signal);
  if (tenantError || !tenants || tenants.some(item => item.organization_id !== organizationId ||
    !tenantIds.includes(item.id))) throw new Error("LINE_MESSAGE_SENDERS_UNAVAILABLE");
  const names = new Map(tenants.map(item => [item.id, item.display_name || "入居者"]));
  if (tenantIds.some(id => !names.has(id))) throw new Error("LINE_MESSAGE_SENDERS_UNAVAILABLE");
  return messages.map(item => ({ id: item.id, tenant_name: names.get(item.tenant_account_id)!,
    message: item.message, created_at: item.created_at }));
}
