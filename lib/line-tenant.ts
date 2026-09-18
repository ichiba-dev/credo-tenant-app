import "server-only";
import type { createServerSupabaseClient } from "./supabase-server";

export async function findLineTenant(db: ReturnType<typeof createServerSupabaseClient>, userId: string, signal: AbortSignal) {
  const { data: links, error } = await db.from("tenant_line_accounts")
    .select("tenant_account_id, organization_id").eq("line_user_id", userId)
    .eq("is_active", true).is("unlinked_at", null).limit(2).abortSignal(signal);
  if (error || !links) throw new Error("LINE_LOOKUP_FAILED");
  if (links.length !== 1) return null;
  const link = links[0];
  if (!link.tenant_account_id || !link.organization_id) return null;
  const { data: tenant, error: tenantError } = await db.from("tenant_accounts")
    .select("id, organization_id").eq("id", link.tenant_account_id)
    .eq("organization_id", link.organization_id).eq("is_active", true).abortSignal(signal).maybeSingle();
  if (tenantError) throw new Error("LINE_LOOKUP_FAILED");
  if (!tenant || tenant.id !== link.tenant_account_id || tenant.organization_id !== link.organization_id) return null;
  const { data: org, error: orgError } = await db.from("organizations")
    .select("id").eq("id", link.organization_id).eq("is_active", true).abortSignal(signal).maybeSingle();
  if (orgError) throw new Error("LINE_LOOKUP_FAILED");
  return org?.id === link.organization_id ? link : null;
}

export function lineSentAt(timestamp: unknown) {
  const date = typeof timestamp === "number" && Number.isSafeInteger(timestamp) && timestamp >= 0 ? new Date(timestamp) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
