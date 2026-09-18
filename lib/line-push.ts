import "server-only";
export type PushResult = "accepted" | "failed" | "unknown";
export async function pushLineText(recipient: string, text: string, retryKey: string): Promise<PushResult> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return "failed";
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Line-Retry-Key": retryKey },
      body: JSON.stringify({ to: recipient, messages: [{ type: "text", text }] }),
      signal: AbortSignal.timeout(8_000), cache: "no-store", redirect: "error",
    });
    if (response.ok || (response.status === 409 && response.headers.get("x-line-accepted-request-id"))) return "accepted";
    if (response.status === 429 || response.status >= 500) return "unknown";
    return response.status >= 400 && response.status < 500 ? "failed" : "unknown";
  } catch { return "unknown"; }
}
