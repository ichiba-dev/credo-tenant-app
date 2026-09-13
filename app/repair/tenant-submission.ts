import "server-only";

import { createAuthServerClient } from "@/lib/supabase-auth/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export type RepairSubmissionActor =
  | { kind: "anonymous" }
  | { kind: "tenant"; tenantId: string; organizationId: string };

export type RepairSubmissionActorResult =
  | { ok: true; actor: RepairSubmissionActor }
  | { ok: false; message: string };

const accountError = "\u5165\u5c45\u8005\u30a2\u30ab\u30a6\u30f3\u30c8\u304c\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002\u7ba1\u7406\u4f1a\u793e\u3078\u304a\u554f\u3044\u5408\u308f\u305b\u304f\u3060\u3055\u3044\u3002";

export async function resolveRepairSubmissionActor(): Promise<RepairSubmissionActorResult> {
  try {
    const auth = await createAuthServerClient();
    const { data: { user }, error } = await auth.auth.getUser();
    if (!user) {
      // A missing session is the supported anonymous path. Other auth failures fail closed.
      if (error && error.name !== "AuthSessionMissingError") return { ok: false, message: accountError };
      return { ok: true, actor: { kind: "anonymous" } };
    }
    if (error) return { ok: false, message: accountError };

    const { data: tenant, error: tenantError } = await createServerSupabaseClient()
      .from("tenant_accounts")
      .select("id, organization_id")
      .eq("auth_user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (tenantError || !tenant?.id || !tenant.organization_id) return { ok: false, message: accountError };
    return { ok: true, actor: { kind: "tenant", tenantId: tenant.id, organizationId: tenant.organization_id } };
  } catch {
    return { ok: false, message: accountError };
  }
}
