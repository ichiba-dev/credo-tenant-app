"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getTenantContext } from "@/lib/supabase-auth/tenant";

const LINK_TOKEN_LIFETIME_MS = 10 * 60 * 1000;

export async function startTenantLineLink(): Promise<never> {
  const context = await getTenantContext();
  if (!context.ok) {
    redirect(context.reason === "unauthenticated" ? "/tenant/login?next=%2Ftenant" : "/tenant?line=account");
  }

  const { tenantId, organizationId } = context.tenant;
  const supabase = createServerSupabaseClient();
  let destination = "/tenant?line=error";

  try {
    const { data: activeLink, error: activeLinkError } = await supabase
      .from("tenant_line_accounts")
      .select("id, organization_id, tenant_account_id")
      .eq("organization_id", organizationId)
      .eq("tenant_account_id", tenantId)
      .eq("is_active", true)
      .maybeSingle();

    if (activeLinkError) {
      destination = "/tenant?line=error";
    } else if (activeLink && (activeLink.organization_id !== organizationId || activeLink.tenant_account_id !== tenantId)) {
      destination = "/tenant?line=error";
    } else if (activeLink) {
      destination = "/tenant?line=already-linked";
    } else {
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + LINK_TOKEN_LIFETIME_MS);

      const { error: expireError } = await supabase
        .from("tenant_line_link_tokens")
        .update({ used_at: issuedAt.toISOString() })
        .eq("organization_id", organizationId)
        .eq("tenant_account_id", tenantId)
        .is("used_at", null)
        .gt("expires_at", issuedAt.toISOString());

      if (!expireError) {
        const rawToken = randomBytes(32).toString("base64url");
        const tokenHash = `\\x${createHash("sha256").update(rawToken).digest("hex")}`;
        const { data: inserted, error: insertError } = await supabase
          .from("tenant_line_link_tokens")
          .insert({
            organization_id: organizationId,
            tenant_account_id: tenantId,
            token_hash: tokenHash,
            expires_at: expiresAt.toISOString(),
            used_at: null,
          })
          .select("id")
          .single();

        if (!insertError && inserted?.id) {
          // A second concurrent request may have inserted after the first expiry pass.
          // Keep at most this request's token pending; a race can fail closed by expiring both.
          const { error: concurrentExpiryError } = await supabase
            .from("tenant_line_link_tokens")
            .update({ used_at: issuedAt.toISOString() })
            .eq("organization_id", organizationId)
            .eq("tenant_account_id", tenantId)
            .is("used_at", null)
            .gt("expires_at", issuedAt.toISOString())
            .neq("token_hash", tokenHash);

          if (!concurrentExpiryError) {
            destination = `/tenant/line/link?token=${encodeURIComponent(rawToken)}`;
          } else {
            await supabase
              .from("tenant_line_link_tokens")
              .update({ used_at: new Date().toISOString() })
              .eq("token_hash", tokenHash)
              .is("used_at", null);
          }
        }
      }
    }
  } catch {
    destination = "/tenant?line=error";
  }

  redirect(destination);
}
