import "server-only";

import { createAuthServerClient } from "@/lib/supabase-auth/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export type TenantContext = {
  tenantId: string;
  organizationId: string;
  displayName: string;
};

export type TenantContextResult =
  | { ok: true; tenant: TenantContext }
  | { ok: false; reason: "unauthenticated" | "forbidden" | "unavailable" };

export async function getTenantContext(): Promise<TenantContextResult> {
  const auth = await createAuthServerClient();
  const { data: { user }, error: authError } = await auth.auth.getUser();
  if (authError || !user) return { ok: false, reason: "unauthenticated" };

  try {
    const { data, error } = await createServerSupabaseClient()
      .from("tenant_accounts")
      .select("id, organization_id, display_name")
      .eq("auth_user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (error) return { ok: false, reason: "unavailable" };
    if (!data?.id || !data.organization_id) return { ok: false, reason: "forbidden" };
    return { ok: true, tenant: {
      tenantId: data.id,
      organizationId: data.organization_id,
      displayName: data.display_name || "入居者",
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
