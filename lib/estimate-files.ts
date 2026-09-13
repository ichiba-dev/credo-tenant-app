import "server-only";

export const ESTIMATE_BUCKET = "owner-estimates";
export const MAX_ESTIMATE_FILES = 10;
export const MAX_ESTIMATE_FILE_SIZE = 15 * 1024 * 1024;

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export type AllowedEstimateMime = "application/pdf" | "image/jpeg" | "image/png";

const extensions: Record<AllowedEstimateMime, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export function isAllowedEstimateMime(value: string): value is AllowedEstimateMime {
  return value === "application/pdf" || value === "image/jpeg" || value === "image/png";
}

export function hasMatchingEstimateMagic(bytes: Uint8Array, mime: AllowedEstimateMime) {
  if (mime === "application/pdf") {
    return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  }
  if (mime === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

export function validateOriginalFilename(value: string) {
  return value.length > 0 && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function createEstimateStoragePath(organizationId: string, repairId: number, reportId: string, fileId: string, mime: AllowedEstimateMime) {
  return `${organizationId}/${repairId}/${reportId}/${fileId}.${extensions[mime]}`;
}

export function isExpectedEstimateStoragePath(path: string, organizationId: string, repairId: number, reportId: string) {
  if (!organizationId || !Number.isSafeInteger(repairId) || repairId <= 0 || !reportId || path.length > 1024) return false;
  const escapedOrganization = organizationId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedReport = reportId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedOrganization}/${repairId}/${escapedReport}/${UUID_PATTERN}\\.(pdf|jpg|png)$`, "i").test(path);
}
