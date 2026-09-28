import { submitOwnerRepair } from '../submission';
import { getOwnerRequestContext } from '../data';
import { MAX_REQUEST_BYTES } from '@/app/repair/upload-limits';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
const reject = (status: number, message: string) => Response.json({ ok: false, retrySafe: true, requestCreated: false, message }, { status, headers });
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return reject(403,'送信元を確認できませんでした。');
  try { await getOwnerRequestContext(); } catch { return reject(403,'オーナーとしてログインしてください。'); }
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data;')) return reject(415,'送信形式が正しくありません。');
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) return reject(413,'写真の合計サイズが大きすぎます。');
  let form: FormData;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reject(400,'送信内容が空です。');
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) { await reader.cancel(); return reject(413,'写真の合計サイズが大きすぎます。'); }
      chunks.push(new Uint8Array(chunk.value));
    }
    form = await new Response(new Blob(chunks), { headers: { 'Content-Type': contentType } }).formData();
  } catch { return reject(400,'送信内容を読み取れませんでした。'); }
  const result = await submitOwnerRepair(form);
  return Response.json(result, { status: result.ok ? 200 : result.retrySafe ? 400 : 500, headers });
}
