import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { parseRepairId } from "@/lib/repair-id";
import { OUTBOUND_BUCKET, prepareOutboundMedia } from "@/lib/outbound-media";
import { decryptPayload, derivePdfToken, digestMatches, encryptPayload, shaBytea } from "@/lib/outbound-crypto";
import { classifyLinePush, imageLinePayload, pdfLinePayload } from "@/lib/outbound-line-payload";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR = 3600_000;
type Status = "accepted" | "sending" | "unknown" | "failed" | "expired";
type Attachment = { id:string; organization_id:string; tenant_account_id:string; repair_request_id:number; staff_auth_user_id:string;
  tenant_line_account_id:string; recipient_line_user_id:string; media_type:"image"|"pdf"; mime_type:string;
  source_sha256:string; source_file_size:number; upload_state:string; staging_path:string; storage_path:string|null;
  preview_storage_path:string|null; file_size:number|null; content_sha256:string|null };
type Push = { id:string; attachment_id:string; status:Status|"pending"; retry_key:string; lease_id:string|null;
  payload_ciphertext:string; payload_sha256:string; payload_expires_at:string; recipient_line_user_id:string };

function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function httpsUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hostname==="localhost" || url.hostname==="[::1]"
    || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname))
    throw new Error("OUTBOUND_HTTPS_REQUIRED");
  return url.toString();
}
function publicBase() {
  const value = process.env.OUTBOUND_PUBLIC_BASE_URL;
  if (!value) throw new Error("OUTBOUND_PUBLIC_URL_UNAVAILABLE");
  const url=new URL(httpsUrl(value));
  if(url.pathname!=="/" || url.search || url.hash || ["localhost","127.0.0.1"].includes(url.hostname))
    throw new Error("OUTBOUND_PUBLIC_URL_INVALID");
  return url.origin;
}
function attachmentPath(a:Attachment, kind:"staging"|"final"|"preview") {
  const root = `${a.organization_id}/${kind === "staging" ? "line-outbound-staging" : "line-outbound"}/${a.repair_request_id}/${a.id}`;
  return kind === "preview" ? `${root}.preview.jpg` : `${root}.${a.mime_type === "image/jpeg" ? "jpg" : a.mime_type === "image/png" ? "png" : "pdf"}`;
}
async function rpc<T>(db: ReturnType<typeof createServerSupabaseClient>, name:string, args:Record<string,unknown>):Promise<T> {
  const {data,error}=await db.rpc(name,args).abortSignal(AbortSignal.timeout(10_000));
  if(error || data == null) throw new Error(`OUTBOUND_RPC_${name.toUpperCase()}_FAILED`);
  return data as T;
}
async function ensureObject(db:ReturnType<typeof createServerSupabaseClient>,path:string,bytes:Buffer,mime:string) {
  const store=db.storage.from(OUTBOUND_BUCKET);
  const {error}=await store.upload(path,bytes,{contentType:mime,upsert:false});
  if(error && !/already exists|duplicate|409/i.test(error.message)) throw new Error("OUTBOUND_STORAGE_UPLOAD_FAILED");
  const {data, error:downloadError}=await store.download(path);
  if(downloadError || !data) throw new Error("OUTBOUND_STORAGE_VERIFY_FAILED");
  const actual=Buffer.from(await data.arrayBuffer());
  if(actual.length!==bytes.length || !digestMatches(shaBytea(bytes),actual)) throw new Error("OUTBOUND_STORAGE_MISMATCH");
}
export async function signedForLine(db:ReturnType<typeof createServerSupabaseClient>,path:string,mime:string) {
  const {data,error}=await db.storage.from(OUTBOUND_BUCKET).createSignedUrl(path,27*3600);
  if(error || !data?.signedUrl) throw new Error("OUTBOUND_SIGNED_URL_FAILED");
  const url=httpsUrl(data.signedUrl);
  const response=await fetch(url,{method:"GET",headers:{Range:"bytes=0-0"},signal:AbortSignal.timeout(8_000),cache:"no-store",redirect:"error"});
  await response.body?.cancel();
  if(!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith(mime))
    throw new Error("OUTBOUND_SIGNED_URL_UNAVAILABLE");
  return url;
}
function validPayload(payload:unknown,a:Attachment):payload is {to:string;messages:unknown[]} {
  if(typeof payload!=="object" || payload===null || Array.isArray(payload))return false;
  const value=payload as {to?:unknown;messages?:unknown};
  if(value.to!==a.recipient_line_user_id || !Array.isArray(value.messages) || value.messages.length!==1)return false;
  const message=value.messages[0];
  if(typeof message!=="object" || message===null || Array.isArray(message))return false;
  const m=message as {type?:unknown;originalContentUrl?:unknown;previewImageUrl?:unknown;text?:unknown};
  try {
    if(a.media_type==="image")return m.type==="image" && typeof m.originalContentUrl==="string"
      && typeof m.previewImageUrl==="string" && httpsUrl(m.originalContentUrl).includes(`/${OUTBOUND_BUCKET}/${attachmentPath(a,"final")}`)
      && httpsUrl(m.previewImageUrl).includes(`/${OUTBOUND_BUCKET}/${attachmentPath(a,"preview")}`);
    return m.type==="text" && typeof m.text==="string"
      && m.text.startsWith(`PDF: ${publicBase()}/api/line-outbound/pdf/`)
      && /^[A-Za-z0-9_-]{43}$/.test(m.text.split("/api/line-outbound/pdf/")[1] ?? "");
  } catch { return false; }
}
async function deliver(db:ReturnType<typeof createServerSupabaseClient>,a:Attachment,push:Push):Promise<Status> {
  if(push.status==="accepted" || push.status==="failed" || push.status==="expired") return push.status;
  const claims=await rpc<Push[]>(db,"claim_staff_line_attachment_push",{
    p_organization_id:a.organization_id,p_attachment_id:a.id,p_staff_auth_user_id:a.staff_auth_user_id });
  const claim=one(claims);
  if(!claim) return "sending";
  let outcome:"accepted"|"failed"|"unknown"="unknown";
  try {
    if(Date.parse(claim.payload_expires_at)<=Date.now()+2*HOUR) throw new Error("OUTBOUND_PAYLOAD_EXPIRED");
    const payload=decryptPayload(claim.payload_ciphertext);
    if(!validPayload(payload,a) || !digestMatches(claim.payload_sha256,JSON.stringify(payload)))
      throw new Error("OUTBOUND_PAYLOAD_MISMATCH");
    const token=process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if(!token) throw new Error("OUTBOUND_LINE_UNAVAILABLE");
    const response=await fetch("https://api.line.me/v2/bot/message/push",{
      method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","X-Line-Retry-Key":claim.retry_key},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(8_000),cache:"no-store",redirect:"error" });
    outcome=classifyLinePush(response.status,!!response.headers.get("x-line-accepted-request-id"));
  } catch { outcome="unknown"; }
  const finished=await rpc<string>(db,"finish_staff_line_attachment_push",{
    p_organization_id:a.organization_id,p_attachment_id:a.id,p_staff_auth_user_id:a.staff_auth_user_id,
    p_lease_id:claim.lease_id,p_result:outcome });
  return finished==="accepted" || finished==="failed" || finished==="unknown" ? finished : "unknown";
}

export async function sendOutboundAttachment(repairValue:string,requestId:string,file:File):Promise<{status:Status;attachmentId:string}> {
  const staff=await getStaffContext();
  if(!staff.ok || !staff.canUpdate) throw new Error("OUTBOUND_FORBIDDEN");
  const repairId=parseRepairId(repairValue);
  if(repairId===null || !uuid.test(requestId) || !(file instanceof File) || !file.name || file.name.length>255
    || /[\x00-\x1f\x7f/\\]/.test(file.name) || file.name==="." || file.name==="..") throw new Error("OUTBOUND_INPUT_INVALID");
  if(file.size<1 || file.size>15_728_640) throw new Error("OUTBOUND_INPUT_INVALID");
  const media=await prepareOutboundMedia(new Uint8Array(await file.arrayBuffer()),file.type);
  const db=createServerSupabaseClient();
  const reserved=await rpc<Attachment>(db,"reserve_staff_line_attachment",{
    p_organization_id:staff.organizationId,p_repair_request_id:repairId,p_staff_auth_user_id:staff.userId,
    p_request_id:requestId,p_media_type:media.mediaType,p_original_filename:file.name,p_mime_type:media.mime,
    p_source_file_size:media.source.length,p_source_sha256:shaBytea(media.source) });
  const a=one(reserved)!;
  if(a.organization_id!==staff.organizationId || a.staff_auth_user_id!==staff.userId || a.repair_request_id!==repairId
    || a.source_file_size!==media.source.length || !digestMatches(a.source_sha256,media.source)
    || a.staging_path!==attachmentPath(a,"staging")) throw new Error("OUTBOUND_SCOPE_MISMATCH");
  const existing=await db.from("staff_line_attachment_pushes").select("id,attachment_id,status,retry_key,lease_id,payload_ciphertext,payload_sha256,payload_expires_at,recipient_line_user_id")
    .eq("organization_id",staff.organizationId).eq("tenant_account_id",a.tenant_account_id).eq("attachment_id",a.id).maybeSingle();
  if(existing.error) throw new Error("OUTBOUND_PUSH_LOOKUP_FAILED");
  if(existing.data) return {status:await deliver(db,a,existing.data as Push),attachmentId:a.id};
  if(a.upload_state==="ready" && (a.storage_path!==attachmentPath(a,"final") || a.file_size!==media.final.length
    || !a.content_sha256 || !digestMatches(a.content_sha256,media.final))) throw new Error("OUTBOUND_FINAL_MISMATCH");
  if(a.upload_state!=="ready") {
    if(a.upload_state!=="uploading") throw new Error("OUTBOUND_UPLOAD_CLOSED");
    await ensureObject(db,a.staging_path,media.source,media.mime);
    await ensureObject(db,attachmentPath(a,"final"),media.final,media.mime);
    if(media.preview) await ensureObject(db,attachmentPath(a,"preview"),media.preview,"image/jpeg");
    const ready=await rpc<Attachment>(db,"finalize_staff_line_attachment_upload",{
      p_organization_id:staff.organizationId,p_attachment_id:a.id,p_staff_auth_user_id:staff.userId,
      p_verified_source_sha256:shaBytea(media.source),p_file_size:media.final.length,p_content_sha256:shaBytea(media.final),
      p_preview_file_size:media.preview?.length ?? null,p_preview_sha256:media.preview ? shaBytea(media.preview) : null });
    if(ready.upload_state!=="ready" || ready.storage_path!==attachmentPath(a,"final")) throw new Error("OUTBOUND_FINALIZE_MISMATCH");
  }
  let payload:unknown;
  let pdfTokenId:string|null=null;
  let expires=new Date(Date.now()+27*HOUR).toISOString();
  if(media.mediaType==="image") {
    const originalContentUrl=await signedForLine(db,attachmentPath(a,"final"),media.mime);
    const previewImageUrl=await signedForLine(db,attachmentPath(a,"preview"),"image/jpeg");
    payload=imageLinePayload(a.recipient_line_user_id,originalContentUrl,previewImageUrl);
  } else {
    const raw=derivePdfToken(a.id,requestId);
    const prior=await db.from("staff_line_attachment_tokens").select("id,expires_at,token_hash")
      .eq("organization_id",staff.organizationId).eq("attachment_id",a.id).eq("issued_by",staff.userId)
      .eq("issue_request_id",requestId).maybeSingle();
    if(prior.error) throw new Error("OUTBOUND_TOKEN_LOOKUP_FAILED");
    if(prior.data) {
      if(!digestMatches(prior.data.token_hash,raw)) throw new Error("OUTBOUND_TOKEN_MISMATCH");
      expires=prior.data.expires_at;
    }
    const token=await rpc<{id:string;expires_at:string}>(db,"issue_staff_line_attachment_pdf_token",{
      p_organization_id:staff.organizationId,p_attachment_id:a.id,p_staff_auth_user_id:staff.userId,
      p_request_id:requestId,p_token_hash:shaBytea(raw),p_expires_at:expires });
    pdfTokenId=token.id; expires=token.expires_at;
    const url=`${publicBase()}/api/line-outbound/pdf/${encodeURIComponent(raw)}`;
    payload=pdfLinePayload(a.recipient_line_user_id,url);
  }
  const encrypted=encryptPayload(payload);
  const push=await rpc<Push>(db,"prepare_staff_line_attachment_push",{
    p_organization_id:staff.organizationId,p_attachment_id:a.id,p_staff_auth_user_id:staff.userId,
    p_payload_ciphertext:encrypted.ciphertext,p_payload_key_version:1,p_payload_sha256:encrypted.sha,
    p_payload_expires_at:expires,p_pdf_token_id:pdfTokenId });
  return {status:await deliver(db,a,push),attachmentId:a.id};
}
