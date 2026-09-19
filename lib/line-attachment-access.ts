import "server-only";

export const LINE_ATTACHMENT_BUCKET = "tenant-line-files";
export const attachmentUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isLineAttachmentPath(file: { id: string; tenant_account_id: string; organization_id: string; storage_path: string; media_type: string; mime_type: string }, organizationId: string) {
  if (file.organization_id !== organizationId || !attachmentUuid.test(file.id) || !attachmentUuid.test(organizationId) || !attachmentUuid.test(file.tenant_account_id)) return false;
  const ext = file.media_type === "image" && file.mime_type === "image/jpeg" ? "jpg" :
    file.media_type === "image" && file.mime_type === "image/png" ? "png" :
    file.media_type === "pdf" && file.mime_type === "application/pdf" ? "pdf" : null;
  return ext !== null && file.storage_path === `${organizationId}/line/${file.tenant_account_id}/${file.id}.${ext}`;
}
