import { bytea } from "@/lib/outbound-crypto";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { isLiveUploadState, isSameOrigin, isUuid, readUploadState, validateDispatch,
  vendorQuotePath, verifyUploadedPdf } from "@/lib/vendor-quote-upload";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ repairId: string; dispatchId: string }> };
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return fail(403,"Forbidden");
  const staff = await getStaffContext();
  if (!staff.ok) return fail(staff.reason === "unauthenticated" ? 401 : 403,"Staff access required");
  if (!staff.canUpdate) return fail(403,"Read only");
  const { repairId: rawRepairId, dispatchId } = await context.params;
  const repairId = Number(rawRepairId);
  if (!Number.isSafeInteger(repairId) || repairId <= 0 || !isUuid(dispatchId)) return fail(400,"Invalid scope");
  if (Number(request.headers.get("content-length")) > 64_000) return fail(413,"Metadata too large");
  let body: Record<string,unknown>;
  try {
    const text = await request.text();
    if (text.length > 64_000) return fail(413,"Metadata too large");
    body = JSON.parse(text) as Record<string,unknown>;
  } catch { return fail(400,"Invalid request"); }
  const state = readUploadState(body.ticket);
  if (!state || state.actor !== staff.userId || state.organizationId !== staff.organizationId
    || state.repairId !== repairId || state.dispatchId !== dispatchId) return fail(403,"Upload scope mismatch");
  if (!isLiveUploadState(state)) return fail(410,"Upload ticket expired");
  if (body.path !== vendorQuotePath(state) || body.sha256 !== state.sha256
    || body.size !== state.size || body.mime !== "application/pdf") return fail(400,"Upload metadata mismatch");
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100
    || (body.validUntil !== null && body.validUntil !== undefined
      && (typeof body.validUntil !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.validUntil)))
    || (body.vendorQuoteNumber !== null && body.vendorQuoteNumber !== undefined
      && (typeof body.vendorQuoteNumber !== "string" || body.vendorQuoteNumber.length > 100))
    || !["floor","round","ceil"].includes(String(body.taxRounding))) return fail(400,"Invalid quote");
  if (!await validateDispatch(staff.organizationId,repairId,dispatchId)) return fail(404,"Dispatch unavailable");

  try { await verifyUploadedPdf(state); }
  catch { return fail(409,"PDF verification failed"); }
  if (!isLiveUploadState(state)) return fail(410,"Upload ticket expired");
  const { data, error } = await createServerSupabaseClient().rpc("record_vendor_quote_revision",{
    p_org:state.organizationId,p_dispatch:state.dispatchId,p_quote_id:state.quoteId,
    p_file_id:state.fileId,p_request_id:state.requestId,p_actor:staff.userId,
    p_upload_issued_at:state.uploadIssuedAt,p_received_at:state.receivedAt,
    p_valid_until:body.validUntil ?? null,p_vendor_quote_number:body.vendorQuoteNumber ?? null,
    p_tax_rounding:body.taxRounding,p_lines:body.lines,p_original_filename:state.filename,
    p_file_size:state.size,p_content_sha256:bytea(Buffer.from(state.sha256,"hex")),
  });
  if (error || !data) return fail(409,"Quote revision could not be recorded");
  return Response.json({ ok:true, quoteId:state.quoteId, revisionNo:data.revision_no },{ headers });
}
