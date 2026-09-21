export type VendorAreaInput = { areaCode: string; areaLabel: string };
export type VendorMasterInput = {
  vendorId: string;
  requestId: string;
  expectedUpdatedAt: string | null;
  companyName: string;
  contactName: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  categories: string[];
  areas: VendorAreaInput[];
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const control = /[\u0000-\u001f\u007f]/;
const clean = (value: unknown, max: number) => {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized && normalized.length <= max && !control.test(normalized) ? normalized : null;
};

export function areaCodeFromLabel(label: string) {
  return label.normalize("NFKC").trim().toLocaleLowerCase("ja-JP")
    .replace(/[\s/\\]+/g, "-").replace(/[^\p{L}\p{N}._-]/gu, "").slice(0, 40);
}

export function parseVendorMasterInput(input: unknown): VendorMasterInput | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.vendorId !== "string" || !uuid.test(raw.vendorId) ||
      typeof raw.requestId !== "string" || !uuid.test(raw.requestId) ||
      (raw.expectedUpdatedAt !== null && raw.expectedUpdatedAt !== undefined &&
        (typeof raw.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(raw.expectedUpdatedAt)))) ||
      typeof raw.isActive !== "boolean" || !Array.isArray(raw.categories) || !Array.isArray(raw.areas)) return null;
  const companyName = clean(raw.companyName, 200);
  const contactName = clean(raw.contactName, 200);
  if (!companyName || !contactName || raw.categories.length > 20 || raw.areas.length > 30) return null;
  const phone = raw.phone === "" || raw.phone == null ? null : clean(raw.phone, 40);
  const email = raw.email === "" || raw.email == null ? null : clean(raw.email, 254)?.toLocaleLowerCase("en-US") ?? null;
  if ((raw.phone != null && raw.phone !== "" && !phone) || (raw.email != null && raw.email !== "" &&
      (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) return null;
  const categories = [...new Set(raw.categories.map((value) => clean(value, 100)).filter((value): value is string => !!value))];
  if (categories.length !== raw.categories.length) return null;
  const areas: VendorAreaInput[] = [];
  for (const value of raw.areas) {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    const areaLabel = clean(item.areaLabel, 100);
    const suppliedCode = item.areaCode == null || item.areaCode === "" ? null : clean(item.areaCode, 40);
    const areaCode = suppliedCode ?? (areaLabel ? areaCodeFromLabel(areaLabel) : null);
    if (!areaLabel || !areaCode) return null;
    areas.push({ areaCode, areaLabel });
  }
  if (new Set(areas.map((area) => area.areaCode)).size !== areas.length) return null;
  return { vendorId: raw.vendorId, requestId: raw.requestId,
    expectedUpdatedAt: typeof raw.expectedUpdatedAt === "string" ? raw.expectedUpdatedAt : null,
    companyName, contactName, phone, email, isActive: raw.isActive, categories, areas };
}
