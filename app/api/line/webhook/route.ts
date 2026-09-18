import { createHmac, timingSafeEqual } from "node:crypto";
import { saveLineTextMessages } from "@/lib/line-webhook";

export const runtime = "nodejs";

const responseHeaders = { "Cache-Control": "no-store" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidSignature(rawBody: Buffer, signature: string, secret: string) {
  // A LINE SHA-256 signature is a canonical Base64 encoding of 32 bytes.
  if (!/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;

  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64");
  } catch {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

export async function POST(request: Request) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, message: "Webhook is not configured" },
      { status: 500, headers: responseHeaders },
    );
  }

  const signature = request.headers.get("x-line-signature");
  if (!signature) {
    return Response.json(
      { ok: false, message: "Invalid signature" },
      { status: 401, headers: responseHeaders },
    );
  }

  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await request.arrayBuffer());
  } catch {
    return Response.json(
      { ok: false, message: "Invalid request body" },
      { status: 400, headers: responseHeaders },
    );
  }

  if (!isValidSignature(rawBody, signature, secret)) {
    return Response.json(
      { ok: false, message: "Invalid signature" },
      { status: 401, headers: responseHeaders },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return Response.json(
      { ok: false, message: "Invalid JSON" },
      { status: 400, headers: responseHeaders },
    );
  }

  if (!isRecord(body) || !Array.isArray(body.events)) {
    return Response.json(
      { ok: false, message: "Invalid events" },
      { status: 400, headers: responseHeaders },
    );
  }

  try {
    await saveLineTextMessages(body.events);
  } catch {
    return Response.json(
      { ok: false, message: "Webhook processing failed" },
      { status: 500, headers: responseHeaders },
    );
  }

  const eventLabel = body.events.length === 1 ? "event" : "events";
  console.info(`LINE webhook received: ${body.events.length} ${eventLabel}`);

  return Response.json({ ok: true }, { status: 200, headers: responseHeaders });
}

export function GET() {
  return Response.json(
    { ok: false, message: "Method not allowed" },
    { status: 405, headers: { ...responseHeaders, Allow: "POST" } },
  );
}
