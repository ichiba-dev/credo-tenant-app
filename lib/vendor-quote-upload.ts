import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { shaBytea } from "@/lib/outbound-crypto";

export const VENDOR_QUOTE_BUCKET = "vendor-quotes";
export const MAX_VENDOR_QUOTE_PDF_BYTES = 15 * 1024 * 1024;
const STATE_TTL_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

export type VendorQuoteUploadState = {
  actor: string; organizationId: string; repairId: number; dispatchId: string;
  quoteId: string; fileId: string; requestId: string; filename: string;
  size: number; sha256: string; receivedAt: string; uploadIssuedAt: string; expiresAt: number;
};

export function isUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
export function isSha256(value: unknown): value is string { return typeof value === "string" && SHA256.test(value); }
export function isValidPdfInput(input: { filename: unknown; size: unknown; mime: unknown; sha256: unknown; requestId: unknown }) {
  return typeof input.filename === "string" && input.filename.length > 0 && input.filename.length <= 255
    && !/[\u0000-\u001f\u007f]/.test(input.filename)
    && Number.isSafeInteger(input.size) && Number(input.size) > 0 && Number(input.size) <= MAX_VENDOR_QUOTE_PDF_BYTES
    && input.mime === "application/pdf" && isSha256(input.sha256) && isUuid(input.requestId);
}
export function vendorQuotePath(state: Pick<VendorQuoteUploadState,"organizationId"|"repairId"|"dispatchId"|"quoteId"|"fileId">) {
  return `${state.organizationId}/${state.repairId}/${state.dispatchId}/${state.quoteId}/${state.fileId}.pdf`;
}
function key() {
  const raw = process.env.OUTBOUND_TOKEN_SECRET;
  if (!raw) throw new Error("VENDOR_UPLOAD_SECRET_UNAVAILABLE");
  const bytes = Buffer.from(raw,"base64");
  if (bytes.length !== 32) throw new Error("VENDOR_UPLOAD_SECRET_INVALID");
  return bytes;
}
export function createUploadState(state: VendorQuoteUploadState) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256",key()).update(`vendor-quote-upload-v1:${payload}`).digest("base64url");
  return { state, ticket: `${payload}.${signature}` };
}
export function isLiveUploadState(state: VendorQuoteUploadState, now = Date.now()) {
  const issued = Date.parse(state.uploadIssuedAt);
  return Number.isFinite(issued) && state.expiresAt === issued + STATE_TTL_MS
    && now >= issued && now < state.expiresAt;
}
export function readUploadState(ticket: unknown): VendorQuoteUploadState | null {
  if (typeof ticket !== "string" || ticket.length > 2048) return null;
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  const expected = createHmac("sha256",key()).update(`vendor-quote-upload-v1:${parts[0]}`).digest();
  let actual: Buffer;
  try { actual = Buffer.from(parts[1],"base64url"); }
  catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8")) as VendorQuoteUploadState;
    if (!isUuid(state.actor) || !isUuid(state.organizationId) || !Number.isSafeInteger(state.repairId)
      || state.repairId <= 0 || !isUuid(state.dispatchId) || !isUuid(state.quoteId)
      || !isUuid(state.fileId) || !isValidPdfInput({filename:state.filename,size:state.size,
        mime:"application/pdf",sha256:state.sha256,requestId:state.requestId})
      || !Number.isSafeInteger(state.expiresAt) || typeof state.receivedAt !== "string"
      || typeof state.uploadIssuedAt !== "string"
      || !Number.isFinite(Date.parse(state.receivedAt))
      || !Number.isFinite(Date.parse(state.uploadIssuedAt))) return null;
    return state;
  } catch { return null; }
}
export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}
export async function validateDispatch(organizationId: string, repairId: number, dispatchId: string) {
  const db = createServerSupabaseClient();
  const { data, error } = await db.from("repair_vendor_dispatches")
    .select("id,organization_id,repair_request_id,status")
    .eq("organization_id",organizationId).eq("repair_request_id",repairId).eq("id",dispatchId).maybeSingle();
  if (error || !data || data.status === "candidate" || data.status === "cancelled") return false;
  const { data: repair, error: repairError } = await db.from("repair_requests")
    .select("id").eq("organization_id",organizationId).eq("id",repairId).maybeSingle();
  return !repairError && Boolean(repair);
}
export async function verifyUploadedPdf(state: VendorQuoteUploadState) {
  const storage = createServerSupabaseClient().storage.from(VENDOR_QUOTE_BUCKET);
  const path = vendorQuotePath(state);
  const { data: info, error: infoError } = await storage.info(path);
  const objectState = info as (typeof info & { isDeleteMarker?: boolean; archivedAt?: string | null });
  if (infoError || !info || info.name !== path || objectState.isDeleteMarker || objectState.archivedAt
    || info.size !== state.size
    || info.contentType !== "application/pdf" || info.metadata?.sha256 !== state.sha256) {
    throw new Error("VENDOR_PDF_METADATA_MISMATCH");
  }
  const { data: file, error: downloadError } = await storage.download(path);
  if (downloadError || !file) throw new Error("VENDOR_PDF_MISSING");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== state.size || bytes.length > MAX_VENDOR_QUOTE_PDF_BYTES
    || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44
    || bytes[3] !== 0x46 || bytes[4] !== 0x2d) throw new Error("VENDOR_PDF_BYTES_INVALID");
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== state.sha256) throw new Error("VENDOR_PDF_HASH_MISMATCH");
  return { path, size: bytes.length, mime: "application/pdf" as const, sha256: actual,
    shaBytea: shaBytea(bytes) };
}
