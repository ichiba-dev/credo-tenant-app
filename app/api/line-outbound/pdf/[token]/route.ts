import { createServerSupabaseClient } from "@/lib/supabase-server";
import { digestMatches, shaBytea } from "@/lib/outbound-crypto";
import { OUTBOUND_BUCKET } from "@/lib/outbound-media";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const deny = () => new Response("File unavailable", { status: 404, headers });

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return deny();
    const db = createServerSupabaseClient();
    const { data: match, error } = await db.from("staff_line_attachment_tokens")
      .select("id,organization_id,tenant_account_id,attachment_id,token_hash,expires_at,revoked_at")
      .eq("token_hash", shaBytea(token)).maybeSingle();
    if (error || !match || !digestMatches(match.token_hash, token) || match.revoked_at || Date.parse(match.expires_at) <= Date.now()) return deny();
    const { data: attachment, error: attachmentError } = await db.from("staff_line_attachments")
      .select("id,organization_id,tenant_account_id,repair_request_id,media_type,mime_type,upload_state,storage_path")
      .eq("id", match.attachment_id).eq("organization_id", match.organization_id)
      .eq("tenant_account_id", match.tenant_account_id).maybeSingle();
    if (attachmentError || !attachment || attachment.id !== match.attachment_id
      || attachment.organization_id !== match.organization_id || attachment.tenant_account_id !== match.tenant_account_id
      || attachment.media_type !== "pdf"
      || attachment.mime_type !== "application/pdf" || attachment.upload_state !== "ready") return deny();
    const expected = `${attachment.organization_id}/line-outbound/${attachment.repair_request_id}/${attachment.id}.pdf`;
    if (attachment.storage_path !== expected) return deny();
    const [{ data: org }, { data: tenant }, { data: repair }] = await Promise.all([
      db.from("organizations").select("id").eq("id", match.organization_id).eq("is_active", true).maybeSingle(),
      db.from("tenant_accounts").select("id,organization_id").eq("id", match.tenant_account_id)
        .eq("organization_id", match.organization_id).eq("is_active", true).maybeSingle(),
      db.from("repair_requests").select("id,organization_id,tenant_account_id")
        .eq("id", attachment.repair_request_id).eq("organization_id", match.organization_id)
        .eq("tenant_account_id", match.tenant_account_id).maybeSingle(),
    ]);
    if (!org || org.id !== match.organization_id || !tenant || tenant.id !== match.tenant_account_id
      || tenant.organization_id !== match.organization_id || !repair || repair.id !== attachment.repair_request_id
      || repair.organization_id !== match.organization_id || repair.tenant_account_id !== match.tenant_account_id) return deny();
    const signed = await db.storage.from(OUTBOUND_BUCKET).createSignedUrl(expected, 120);
    if (signed.error || !signed.data?.signedUrl) return deny();
    const url = new URL(signed.data.signedUrl);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return deny();
    return new Response(null, { status: 303, headers: { ...headers, Location: url.toString() } });
  } catch { return deny(); }
}
