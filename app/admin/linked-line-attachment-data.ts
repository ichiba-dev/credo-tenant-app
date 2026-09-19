import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { getStaffContext } from "@/lib/supabase-auth/staff";
import type { TenantRepairMessage } from "./types";

type StaffContext = Extract<Awaited<ReturnType<typeof getStaffContext>>, { ok: true }>;

export async function getLinkedLineAttachments(context: StaffContext, repairIds: number[]): Promise<Record<number, TenantRepairMessage[]>> {
  const ids = [...new Set(repairIds)];
  if (!context.ok || !context.organizationId || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("LINE_ATTACHMENTS_UNAVAILABLE");
  if (!ids.length) return {};
  const db = createServerSupabaseClient();
  const signal = AbortSignal.timeout(8_000);
  const { data: files, error } = await db.from("tenant_line_attachments")
    .select("id, organization_id, tenant_account_id, repair_request_id, media_type, original_filename, file_size, line_sent_at, created_at")
    .eq("organization_id", context.organizationId).in("repair_request_id", ids)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).abortSignal(signal);
  if (error || !files || files.some(file => file.organization_id !== context.organizationId ||
    !ids.includes(file.repair_request_id) || !file.tenant_account_id || !["image", "pdf"].includes(file.media_type))) throw new Error("LINE_ATTACHMENTS_UNAVAILABLE");
  if (!files.length) return {};
  const tenantIds = [...new Set(files.map(file => file.tenant_account_id as string))];
  const { data: tenants, error: tenantError } = await db.from("tenant_accounts")
    .select("id, organization_id, display_name").eq("organization_id", context.organizationId)
    .in("id", tenantIds).abortSignal(signal);
  if (tenantError || !tenants || tenants.some(tenant => tenant.organization_id !== context.organizationId || !tenantIds.includes(tenant.id))) throw new Error("LINE_ATTACHMENTS_UNAVAILABLE");
  const names = new Map(tenants.map(tenant => [tenant.id, tenant.display_name || "入居者"]));
  if (tenantIds.some(id => !names.has(id))) throw new Error("LINE_ATTACHMENTS_UNAVAILABLE");
  const grouped: Record<number, TenantRepairMessage[]> = {};
  for (const file of files) {
    const sentAt = typeof file.line_sent_at === "string" && Number.isFinite(Date.parse(file.line_sent_at)) ? file.line_sent_at : file.created_at;
    if (!Number.isFinite(Date.parse(sentAt))) throw new Error("LINE_ATTACHMENTS_UNAVAILABLE");
    (grouped[file.repair_request_id] ??= []).push({
      id: `line-attachment:${file.id}`, channel: "line", sender_type: "tenant",
      sender_name: names.get(file.tenant_account_id)!, message: "", created_at: sentAt,
      attachment: { id: file.id, media_type: file.media_type, original_filename: file.original_filename, file_size: Number(file.file_size) },
    });
  }
  return grouped;
}
