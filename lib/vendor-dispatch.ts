export type SelectVendorInput = {
  repairId: number;
  vendorId: string;
  requestId: string;
  instructions: string;
  confirmDuplicate: boolean;
};

export type ConfirmManualDispatchInput = {
  repairId: number;
  dispatchId: string;
  requestId: string;
  messageBody: string;
  externalDeliveryConfirmed: true;
  photos: { sourceType: "repair_photo" | "tenant_line_attachment" | "legacy_photo"; sourceId: string | null }[];
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unsafeControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

// Carry bigint photo IDs as decimal strings to avoid JavaScript precision loss.
export function normalizeRepairPhotoId(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return null;
    value = String(value);
  }
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value) || value.length > 20) return null;
  const id = BigInt(value);
  return id >= BigInt("-9223372036854775808") && id <= BigInt("9223372036854775807") ? String(id) : null;
}

export function parseSelectVendorInput(input: unknown): SelectVendorInput | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (typeof value.repairId !== "number" || !Number.isSafeInteger(value.repairId) || value.repairId <= 0 ||
      typeof value.vendorId !== "string" || !uuid.test(value.vendorId) ||
      typeof value.requestId !== "string" || !uuid.test(value.requestId) ||
      typeof value.instructions !== "string") return null;
  const instructions = value.instructions.normalize("NFKC").trim();
  if (!instructions || instructions.length > 5000 || unsafeControl.test(instructions)) return null;
  if (value.confirmDuplicate !== undefined && typeof value.confirmDuplicate !== "boolean") return null;
  return { repairId: value.repairId, vendorId: value.vendorId,
    requestId: value.requestId, instructions, confirmDuplicate: value.confirmDuplicate === true };
}

export function parseConfirmManualDispatchInput(input: unknown): ConfirmManualDispatchInput | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (!Number.isSafeInteger(value.repairId) || (value.repairId as number) <= 0 ||
      typeof value.dispatchId !== "string" || !uuid.test(value.dispatchId) ||
      typeof value.requestId !== "string" || !uuid.test(value.requestId) ||
      value.externalDeliveryConfirmed !== true || typeof value.messageBody !== "string") return null;
  const messageBody = value.messageBody.normalize("NFKC").trim();
  if (!messageBody || messageBody.length > 10000 || unsafeControl.test(messageBody)) return null;
  const photos = value.photos === undefined ? [] : value.photos;
  if (!Array.isArray(photos) || photos.length > 30) return null;
  const normalized: ConfirmManualDispatchInput["photos"] = [];
  const seen = new Set<string>();
  for (const photo of photos) {
    if (!photo || typeof photo !== "object") return null;
    const item = photo as Record<string, unknown>;
    if (item.sourceType !== "repair_photo" && item.sourceType !== "tenant_line_attachment" &&
        item.sourceType !== "legacy_photo") return null;
    const sourceId = item.sourceType === "legacy_photo" ? null :
      item.sourceType === "repair_photo" ? normalizeRepairPhotoId(item.sourceId) : item.sourceId;
    if (item.sourceType === "legacy_photo" ? item.sourceId != null :
        item.sourceType === "repair_photo" ? sourceId === null :
        typeof sourceId !== "string" || !uuid.test(sourceId)) return null;
    const key = `${item.sourceType}:${sourceId ?? "legacy"}`;
    if (seen.has(key)) return null;
    seen.add(key);
    normalized.push({ sourceType: item.sourceType, sourceId: sourceId as string | null });
  }
  return { repairId: value.repairId as number, dispatchId: value.dispatchId,
    requestId: value.requestId, messageBody, externalDeliveryConfirmed: true, photos: normalized };
}
