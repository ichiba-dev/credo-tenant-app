import { bytea } from '@/lib/outbound-crypto';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createUploadState, isLiveUploadState, isSameOrigin, isValidPdfInput, readUploadState, vendorQuotePath, verifyUploadedPdf, VENDOR_QUOTE_BUCKET } from '@/lib/vendor-quote-upload';
import { inspectQuoteRequest, quoteRequestContext, quoteTokenHash } from '@/lib/vendor-quote-request';
import { optionalQuoteDate, optionalQuoteText, parseQuoteLines } from '@/lib/vendor-quote-input';

export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
const fail = (status: number) => Response.json({ message: 'リンクまたは入力内容を確認してください。期限切れの場合は管理会社へ再発行を依頼してください。' }, { status, headers });
export async function POST(request: Request, { params }: { params: Promise<{ operation: string }> }) {
  if (!isSameOrigin(request)) return fail(403);
  try {
    const text = await request.text();
    if (text.length > 64000) return fail(413);
    const body = JSON.parse(text) as Record<string, unknown>;
    if (!body || Array.isArray(body) || typeof body !== 'object' || !quoteTokenHash(body.token)) return fail(403);
    const { operation } = await params;
    if (operation === 'context') {
      const data = await quoteRequestContext(body.token);
      return data ? Response.json(data, { headers }) : fail(403);
    }
    if (!['prepare', 'finalize'].includes(operation)) return fail(404);
    const scope = await inspectQuoteRequest(body.token, operation === 'finalize');
    if (!scope) return fail(403);
    const db = createServerSupabaseClient();
    if (operation === 'prepare') {
      if (!isValidPdfInput(body as { filename: unknown; size: unknown; mime: unknown; sha256: unknown; requestId: unknown }) ||
        typeof body.filename !== 'string' || !/\.pdf$/i.test(body.filename) || /[\u0000-\u001f\u007f]/.test(body.filename)) return fail(400);
      const { data: reservation, error } = await db.rpc('prepare_requested_vendor_quote', {
        p_hash: quoteTokenHash(body.token), p_operation: body.requestId, p_filename: body.filename, p_size: body.size,
        p_sha: bytea(Buffer.from(body.sha256 as string, 'hex')),
      });
      if (error || !reservation) return fail(409);
      const { state, ticket } = createUploadState({ quoteRequestId: scope.id, actor: reservation.actor_auth_user_id, organizationId: reservation.organization_id,
        repairId: reservation.repair_request_id, dispatchId: reservation.dispatch_id, quoteId: reservation.quote_id, fileId: reservation.file_id,
        requestId: reservation.request_id, filename: reservation.original_filename, size: reservation.file_size,
        sha256: (body.sha256 as string).toLowerCase(), receivedAt: reservation.received_at,
        uploadIssuedAt: reservation.issued_at, expiresAt: Date.parse(reservation.expires_at) });
      if (!isLiveUploadState(state) || state.organizationId !== scope.organization_id || state.repairId !== scope.repair_request_id ||
        state.dispatchId !== scope.vendor_dispatch_id || state.actor !== scope.created_by_auth_user_id ||
        state.requestId !== body.requestId || state.size !== body.size || state.filename !== body.filename) return fail(409);
      const path = vendorQuotePath(state);
      const storage = db.storage.from(VENDOR_QUOTE_BUCKET);
      const { data: existing, error: lookupError } = await storage.info(path);
      if (existing) {
        if (existing.name !== path || existing.size !== state.size || existing.contentType !== 'application/pdf' || existing.metadata?.sha256 !== state.sha256) return fail(409);
        return Response.json({ path, ticket, uploaded: true, uploadToken: null, expiresAt: new Date(state.expiresAt).toISOString() }, { headers });
      }
      if (lookupError && !['400', '404'].includes(String(lookupError.statusCode))) return fail(503);
      const signed = await storage.createSignedUploadUrl(path, { upsert: false });
      return signed.error || !signed.data ? fail(503) : Response.json({ path, ticket, uploaded: false, uploadToken: signed.data.token, expiresAt: new Date(state.expiresAt).toISOString() }, { headers });
    }
    const state = readUploadState(body.ticket);
    const lines = parseQuoteLines(body.lines);
    const valid = optionalQuoteDate(body.validUntil), number = optionalQuoteText(body.vendorQuoteNumber, 100), notes = optionalQuoteText(body.notes, 2000);
    if (!state || state.quoteRequestId !== scope.id || !isLiveUploadState(state) || state.organizationId !== scope.organization_id || state.repairId !== scope.repair_request_id ||
      state.dispatchId !== scope.vendor_dispatch_id || state.actor !== scope.created_by_auth_user_id) return fail(403);
    if (!/\.pdf$/i.test(state.filename) || body.path !== vendorQuotePath(state) || body.size !== state.size || body.sha256 !== state.sha256 ||
      body.mime !== 'application/pdf' || !lines || valid === undefined || number === undefined || notes === undefined) return fail(400);
    const pdf = await verifyUploadedPdf(state);
    const { data: quote, error } = await db.rpc('submit_requested_vendor_quote', {
      p_hash: quoteTokenHash(body.token), p_quote: state.quoteId, p_file: state.fileId, p_operation: state.requestId,
      p_issued: state.uploadIssuedAt, p_received: state.receivedAt, p_valid: valid, p_number: number, p_lines: lines,
      p_filename: state.filename, p_size: pdf.size, p_sha: pdf.shaBytea, p_notes: notes,
    });
    return error || !quote ? fail(409) : Response.json({ ok: true }, { headers });
  } catch { return fail(400); }
}
