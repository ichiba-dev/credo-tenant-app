import "server-only";
import { randomUUID } from "node:crypto";
import { createServerSupabaseClient } from "./supabase-server";
import { findLineTenant, lineSentAt } from "./line-tenant";
import { hasMatchingEstimateMagic, isAllowedEstimateMime } from "./estimate-files";

const bucket = "tenant-line-files";
const deadline = () => AbortSignal.timeout(8_000);
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export function safeLineFilename(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = Array.from(value.normalize("NFC").replace(/[\u0000-\u001f\u007f/\\\u202a-\u202e\u2066-\u2069]/g, "_").replace(/\.{2,}/g, "_").trim()).slice(0, 255).join("");
  return name && name !== "." ? name : null;
}

async function content(id: string, image: boolean, signal: AbortSignal) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CONTENT_FAILED");
  const response = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(id)}/content`, {
    headers: { Authorization: `Bearer ${token}` }, signal, cache: "no-store", redirect: "error",
  });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok) { await response.body?.cancel(); throw new Error("LINE_CONTENT_FAILED"); }
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!isAllowedEstimateMime(mime) || (image ? mime === "application/pdf" : mime !== "application/pdf")) {
    await response.body?.cancel(); return null;
  }
  const max = (image ? 10 : 15) * 1024 * 1024;
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > max) { await response.body?.cancel(); return null; }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) { await reader.cancel(); return null; }
      chunks.push(part.value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error("LINE_CONTENT_FAILED");
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks, size);
  return size && hasMatchingEstimateMagic(bytes, mime) ? { bytes, mime, size } : null;
}

export async function saveLineAttachments(events: unknown[]) {
  // Bound the whole media batch, in addition to individual storage/DB operations.
  const signal = AbortSignal.timeout(25_000);
  let db: ReturnType<typeof createServerSupabaseClient> | undefined;
  for (const event of events) {
    if (!record(event) || event.type !== "message" || !record(event.source) || event.source.type !== "user" || !record(event.message)) continue;
    const message = event.message;
    if (message.type !== "image" && message.type !== "file") continue;
    if (message.type === "image" && message.contentProvider !== undefined &&
      (!record(message.contentProvider) || message.contentProvider.type !== "line")) continue;
    if (typeof event.source.userId !== "string" || !event.source.userId.trim() || typeof message.id !== "string" || !message.id.trim() || message.id.length > 256) throw new Error("LINE_MESSAGE_INVALID");
    signal.throwIfAborted();
    db ??= createServerSupabaseClient((input, init) => fetch(input, {
      ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline()]) : deadline(),
    }));
    const tenant = await findLineTenant(db, event.source.userId, signal);
    if (!tenant) continue;
    const lookup = async (requestSignal: AbortSignal) => {
      const result = await db!.from("tenant_line_attachments").select("id, storage_path, organization_id, tenant_account_id")
        .eq("line_message_id", message.id).abortSignal(requestSignal).maybeSingle();
      if (result.error) throw new Error("LINE_ATTACHMENT_LOOKUP_FAILED");
      return result.data;
    };
    if (await lookup(signal)) continue;
    const file = await content(message.id, message.type === "image", AbortSignal.any([signal, deadline()]));
    if (!file) continue;
    const id = randomUUID();
    const ext = file.mime === "image/jpeg" ? "jpg" : file.mime === "image/png" ? "png" : "pdf";
    const path = `${tenant.organization_id}/line/${tenant.tenant_account_id}/${id}.${ext}`;
    const storage = db.storage.from(bucket);
    // Storage uses the bounded fetch supplied to the service-role client.
    const cleanup = async () => { try { await storage.remove([path]); } catch { /* Reconcile orphan objects separately. */ } };
    const uploaded = await storage.upload(path, file.bytes, { contentType: file.mime, upsert: false });
    if (uploaded.error || uploaded.data?.path !== path) throw new Error("LINE_ATTACHMENT_UPLOAD_FAILED");
    let insertionError: { code?: string } | null = null;
    try {
      const inserted = await db.from("tenant_line_attachments").insert({
        id, organization_id: tenant.organization_id, tenant_account_id: tenant.tenant_account_id,
        repair_request_id: null, line_message_id: message.id, media_type: message.type === "image" ? "image" : "pdf",
        storage_path: path, original_filename: message.type === "file" ? safeLineFilename(message.fileName) : null,
        mime_type: file.mime, file_size: file.size, line_sent_at: lineSentAt(event.timestamp),
      }).abortSignal(signal);
      if (!inserted.error) continue;
      insertionError = inserted.error;
    } catch { /* Uncertain insert: inspect the authoritative row before removal. */ }
    if (insertionError?.code && /^[0-9A-Z]{5}$/.test(insertionError.code) && insertionError.code !== "23505" && !insertionError.code.startsWith("08") && insertionError.code !== "57014") {
      await cleanup(); throw new Error("LINE_ATTACHMENT_SAVE_FAILED");
    }
    // A fresh deadline is necessary when the original operation timed out.
    const stored = await lookup(deadline());
    if (stored) {
      if (stored.id !== id && stored.storage_path !== path) await cleanup();
      if (stored.organization_id !== tenant.organization_id || stored.tenant_account_id !== tenant.tenant_account_id) throw new Error("LINE_ATTACHMENT_SCOPE_FAILED");
      continue;
    }
    await cleanup();
    throw new Error("LINE_ATTACHMENT_SAVE_FAILED");
  }
}
