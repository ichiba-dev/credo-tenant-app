import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { TenantContext } from "@/lib/supabase-auth/tenant";

export type TenantLineConnection = { linkedAt: string } | null;

export async function getTenantLineConnection(tenant: TenantContext): Promise<TenantLineConnection> {
  const { data, error } = await createServerSupabaseClient()
    .from("tenant_line_accounts")
    .select("organization_id, tenant_account_id, linked_at")
    .eq("organization_id", tenant.organizationId)
    .eq("tenant_account_id", tenant.tenantId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error("TENANT_LINE_CONNECTION_UNAVAILABLE");
  if (!data) return null;
  if (data.organization_id !== tenant.organizationId || data.tenant_account_id !== tenant.tenantId) {
    throw new Error("TENANT_LINE_CONNECTION_SCOPE_MISMATCH");
  }
  return { linkedAt: data.linked_at };
}
