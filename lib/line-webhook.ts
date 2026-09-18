import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { findLineTenant, lineSentAt as toLineSentAt } from "./line-tenant";

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
    const link = await findLineTenant(db, userId, signal);
    if (!link) continue;
    const lineSentAt = toLineSentAt(event.timestamp);
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
