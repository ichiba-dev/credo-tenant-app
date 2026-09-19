import "server-only";
import type { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { UnassignedLineAttachment } from "./types";
type Context = Extract<Awaited<ReturnType<typeof getStaffContext>>, { ok: true }>;

export async function getUnassignedLineAttachments(context: Context): Promise<UnassignedLineAttachment[]> {
  if (!context.ok || !context.organizationId) throw new Error("LINE_ATTACHMENTS_UNAVAILABLE");
  const db = createServerSupabaseClient();
  const signal = AbortSignal.timeout(8_000);
  const { data, error } = await db.from("tenant_line_attachments")
    .select("id, organization_id, tenant_account_id, repair_request_id, media_type, original_filename, file_size, created_at")
    .eq("organization_id", context.organizationId).is("repair_request_id", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50).abortSignal(signal);
  if (error || !data || data.length > 50 || data.some(f => f.organization_id !== context.organizationId ||
    f.repair_request_id !== null || !f.tenant_account_id || !["image", "pdf"].includes(f.media_type))) throw new Error("LINE_ATTACHMENTS_UNAVAILABLE");
  if (!data.length) return [];
  const ids = [...new Set(data.map(f => f.tenant_account_id as string))];
  const { data: tenants, error: tenantError } = await db.from("tenant_accounts")
    .select("id, organization_id, display_name").eq("organization_id", context.organizationId).in("id", ids).abortSignal(signal);
  if (tenantError || !tenants || tenants.some(t => t.organization_id !== context.organizationId || !ids.includes(t.id))) throw new Error("LINE_ATTACHMENTS_UNAVAILABLE");
  const names = new Map(tenants.map(t => [t.id, t.display_name || "入居者"]));
  if (ids.some(id => !names.has(id))) throw new Error("LINE_ATTACHMENTS_UNAVAILABLE");
  return data.map(f => ({ id: f.id, tenant_name: names.get(f.tenant_account_id)!, media_type: f.media_type as "image" | "pdf",
    original_filename: f.original_filename, file_size: Number(f.file_size), created_at: f.created_at }));
}
