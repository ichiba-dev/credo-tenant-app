import "server-only";
import sharp from "sharp";

export const OUTBOUND_BUCKET = "staff-line-files";
export const SOURCE_IMAGE_LIMIT = 10_485_760;
export const FINAL_IMAGE_LIMIT = 10_000_000;
export const PDF_LIMIT = 15_728_640;
export const PREVIEW_LIMIT = 1_000_000;

export type PreparedMedia = {
  mediaType: "image" | "pdf";
  mime: "image/jpeg" | "image/png" | "application/pdf";
  source: Buffer;
  final: Buffer;
  preview: Buffer | null;
};

export function hasMediaMagic(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "application/pdf") return bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
  return false;
}

async function encodeImage(source: Buffer, mime: "image/jpeg" | "image/png", width: number, quality: number) {
  const image = sharp(source, { failOn: "error", limitInputPixels: 40_000_000 }).resize({ width, withoutEnlargement: true });
  return mime === "image/jpeg" ? image.jpeg({ quality, mozjpeg: true }).toBuffer() : image.png({ compressionLevel: 9, palette: true, quality }).toBuffer();
}

export async function prepareOutboundMedia(bytes: Uint8Array, mime: string): Promise<PreparedMedia> {
  const source = Buffer.from(bytes);
  if (!hasMediaMagic(source, mime)) throw new Error("INVALID_FILE_MAGIC");
  if (mime === "application/pdf") {
    if (source.length < 1 || source.length > PDF_LIMIT) throw new Error("INVALID_FILE_SIZE");
    return { mediaType: "pdf", mime, source, final: source, preview: null };
  }
  if (mime !== "image/jpeg" && mime !== "image/png") throw new Error("INVALID_FILE_MIME");
  if (source.length < 1 || source.length > SOURCE_IMAGE_LIMIT) throw new Error("INVALID_FILE_SIZE");
  const metadata = await sharp(source, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
  if (metadata.format !== (mime === "image/jpeg" ? "jpeg" : "png") || !metadata.width || !metadata.height)
    throw new Error("INVALID_IMAGE_CONTENT");
  let final: Buffer | null = null;
  for (let step = 0; step < 12; step++) {
    const width = Math.max(1, Math.floor(metadata.width * Math.pow(0.82, step)));
    const candidate = await encodeImage(source, mime, width, Math.max(40, 88 - step * 5));
    if (candidate.length <= FINAL_IMAGE_LIMIT) { final = candidate; break; }
  }
  if (!final) throw new Error("IMAGE_TOO_LARGE_AFTER_PROCESSING");
  let preview: Buffer | null = null;
  for (let step = 0; step < 10; step++) {
    const width = Math.max(1, Math.floor(Math.min(metadata.width, 960) * Math.pow(0.8, step)));
    const candidate = await sharp(final, { failOn: "error", limitInputPixels: 40_000_000 })
      .resize({ width, withoutEnlargement: true }).jpeg({ quality: Math.max(35, 75 - step * 5) }).toBuffer();
    if (candidate.length <= PREVIEW_LIMIT) { preview = candidate; break; }
  }
  if (!preview) throw new Error("PREVIEW_TOO_LARGE");
  return { mediaType: "image", mime, source, final, preview };
}
