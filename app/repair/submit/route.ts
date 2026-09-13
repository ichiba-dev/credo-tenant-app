import { submitRepair } from "../actions";
import { MAX_REQUEST_BYTES } from "../upload-limits";
import { resolveRepairSubmissionActor } from "../tenant-submission";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };
const reject = (status: number, message: string) => Response.json(
  { ok: false, requestCreated: false, retrySafe: true, message }, { status, headers },
);

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return reject(403, "送信元を確認できませんでした。");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data;")) return reject(415, "送信形式が正しくありません。");
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) return reject(413, "写真の合計サイズが大きすぎます。");

  const actorResult = await resolveRepairSubmissionActor();
  if (!actorResult.ok) return reject(403, actorResult.message);

  let form: FormData;
  try {
    // Content-Lengthなし／偽装時も、multipart解析前に実際の受信量を制限する。
    const reader = request.body?.getReader();
    if (!reader) return reject(400, "送信内容が空です。");
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return reject(413, "写真の合計サイズが大きすぎます。");
      }
      chunks.push(new Uint8Array(chunk.value));
    }
    form = await new Response(new Blob(chunks), { headers: { "Content-Type": contentType } }).formData();
  } catch {
    return reject(400, "送信内容を読み取れませんでした。");
  }
  const result = await submitRepair(form, actorResult.actor);
  return Response.json(result, { status: result.ok ? 200 : result.retrySafe ? 400 : 500, headers });
}
