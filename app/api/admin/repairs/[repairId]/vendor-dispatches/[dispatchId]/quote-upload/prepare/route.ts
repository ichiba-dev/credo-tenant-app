import { getStaffContext } from "@/lib/supabase-auth/staff";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { bytea } from "@/lib/outbound-crypto";
import { createUploadState, isSameOrigin, isUuid, isValidPdfInput,
  isLiveUploadState, validateDispatch, vendorQuotePath, VENDOR_QUOTE_BUCKET } from "@/lib/vendor-quote-upload";

export const runtime = "nodejs";
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
  let body: Record<string,unknown>;
  try { body = await request.json() as Record<string,unknown>; }
  catch { return fail(400,"Invalid request"); }
  if (!isValidPdfInput({filename:body.filename,size:body.size,mime:body.mime,
    sha256:body.sha256,requestId:body.requestId})) return fail(400,"Invalid PDF");
  if (typeof body.receivedAt !== "string" || !Number.isFinite(Date.parse(body.receivedAt)))
    return fail(400,"Invalid received time");
  if (!await validateDispatch(staff.organizationId,repairId,dispatchId)) return fail(404,"Dispatch unavailable");
  const service = createServerSupabaseClient();
  const { data: reservation, error: reserveError } = await service.rpc("prepare_vendor_quote_upload",{
    p_org:staff.organizationId,p_repair:repairId,p_dispatch:dispatchId,p_actor:staff.userId,
    p_request_id:body.requestId,p_received_at:body.receivedAt,
    p_filename:body.filename,p_file_size:body.size,
    p_content_sha256:bytea(Buffer.from((body.sha256 as string).toLowerCase(),"hex")),
  });
  if (reserveError || !reservation) return fail(409,"Upload reservation failed");
  const { state, ticket } = createUploadState({actor:reservation.actor_auth_user_id,
    organizationId:reservation.organization_id,repairId:reservation.repair_request_id,
    dispatchId:reservation.dispatch_id,requestId:reservation.request_id,
    quoteId:reservation.quote_id,fileId:reservation.file_id,filename:reservation.original_filename,
    size:reservation.file_size,sha256:(body.sha256 as string).toLowerCase(),
    receivedAt:reservation.received_at,uploadIssuedAt:reservation.issued_at,
    expiresAt:Date.parse(reservation.expires_at)});
  if (state.actor !== staff.userId || state.organizationId !== staff.organizationId
    || state.repairId !== repairId || state.dispatchId !== dispatchId
    || state.requestId !== body.requestId || state.filename !== body.filename
    || Date.parse(state.receivedAt) !== Date.parse(body.receivedAt) || state.size !== body.size
    || !isLiveUploadState(state)) return fail(410,"Upload reservation expired or mismatched");
  const path = vendorQuotePath(state);
  const storage = service.storage.from(VENDOR_QUOTE_BUCKET);
  const { data: existing, error: infoError } = await storage.info(path);
  if (existing) {
    if (existing.name !== path || existing.size !== state.size
      || existing.contentType !== "application/pdf" || existing.metadata?.sha256 !== state.sha256)
      return fail(409,"Existing PDF mismatch");
    return Response.json({ path, uploadToken:null, ticket, uploaded:true,
      expiresAt:new Date(state.expiresAt).toISOString() }, { headers });
  }
  if (infoError && infoError.statusCode !== "404" && infoError.statusCode !== "400")
    return fail(503,"Storage lookup unavailable");
  const { data, error } = await storage.createSignedUploadUrl(path,{upsert:false});
  if (error || !data) return fail(503,"Upload unavailable");
  return Response.json({ path, uploadToken:data.token, ticket, uploaded:false,
    expiresAt:new Date(state.expiresAt).toISOString() }, { headers });
}
