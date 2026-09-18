import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase-server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// One shared deadline bounds all DB requests in a webhook batch.
export async function saveLineTextMessages(events: unknown[]) {
  let db: ReturnType<typeof createServerSupabaseClient> | undefined;
  const signal = AbortSignal.timeout(8_000);
  for (const event of events) {
    if (!isRecord(event) || event.type !== "message" ||
      !isRecord(event.source) || event.source.type !== "user" ||
      !isRecord(event.message) || event.message.type !== "text") continue;
    const { userId } = event.source;
    const { id, text } = event.message;
    // Do not acknowledge a target event that cannot be safely persisted.
    if (typeof userId !== "string" || !userId.trim() ||
      typeof id !== "string" || !id.trim() ||
      typeof text !== "string" || text.length === 0) throw new Error("LINE_MESSAGE_INVALID");

    db ??= createServerSupabaseClient();
    const { data: links, error: linkError } = await db.from("tenant_line_accounts")
      .select("tenant_account_id, organization_id")
      .eq("line_user_id", userId).eq("is_active", true).is("unlinked_at", null)
      .limit(2).abortSignal(signal);
    if (linkError || !links) throw new Error("LINE_LOOKUP_FAILED");
    if (links.length !== 1) continue;
    const link = links[0];
    if (!link.tenant_account_id || !link.organization_id) continue;

    const { data: tenant, error: tenantError } = await db.from("tenant_accounts")
      .select("id, organization_id").eq("id", link.tenant_account_id)
      .eq("organization_id", link.organization_id).eq("is_active", true)
      .abortSignal(signal).maybeSingle();
    if (tenantError) throw new Error("LINE_LOOKUP_FAILED");
    if (!tenant || tenant.id !== link.tenant_account_id ||
      tenant.organization_id !== link.organization_id) continue;

    const { data: organization, error: organizationError } = await db.from("organizations")
      .select("id").eq("id", link.organization_id).eq("is_active", true)
      .abortSignal(signal).maybeSingle();
    if (organizationError) throw new Error("LINE_LOOKUP_FAILED");
    if (!organization || organization.id !== link.organization_id) continue;

    const timestamp = event.timestamp;
    const date = typeof timestamp === "number" && Number.isSafeInteger(timestamp) && timestamp >= 0
      ? new Date(timestamp) : null;
    const lineSentAt = date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
    const { error: insertError } = await db.from("tenant_line_messages").insert({
      organization_id: link.organization_id,
      tenant_account_id: link.tenant_account_id,
      repair_request_id: null,
      sender_type: "tenant",
      message: text,
      line_message_id: id,
      channel: "line",
      line_sent_at: lineSentAt,
    }).abortSignal(signal);
    if (insertError) {
      if (insertError.code !== "23505") throw new Error("LINE_SAVE_FAILED");
      // Confirm the conflicting message ID; unrelated unique violations must fail.
      const { data: duplicate, error: duplicateError } = await db.from("tenant_line_messages")
        .select("line_message_id").eq("line_message_id", id)
        .abortSignal(signal).maybeSingle();
      if (duplicateError || duplicate?.line_message_id !== id) throw new Error("LINE_SAVE_FAILED");
    }
  }
}
