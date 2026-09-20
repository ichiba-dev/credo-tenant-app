import { sendOutboundAttachment } from "@/lib/outbound-workflow";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ repairId: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) return Response.json({ error: "Forbidden" }, { status: 403, headers });
    const size = Number(request.headers.get("content-length"));
    if (Number.isFinite(size) && size > 17_000_000) return Response.json({ error: "File too large" }, { status: 413, headers });
    const form = await request.formData();
    const file = form.get("file");
    const requestId = form.get("requestId");
    const { repairId } = await context.params;
    if (!(file instanceof File) || typeof requestId !== "string")
      return Response.json({ error: "Invalid upload" }, { status: 400, headers });
    const result = await sendOutboundAttachment(repairId, requestId, file);
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: "Upload or send could not be completed. Retry the same file." }, { status: 400, headers });
  }
}
