export type ReplyOperation = { requestId: string; message: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function loadReplyOperation(storage: Pick<Storage, "getItem">, key: string): ReplyOperation | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("requestId" in value) || !("message" in value) ||
    typeof value.requestId !== "string" || !uuid.test(value.requestId) || typeof value.message !== "string" ||
    !value.message.trim() || value.message.length > 2000) throw new Error("REPLY_OPERATION_INVALID");
  return { requestId: value.requestId, message: value.message };
}
export function prepareReplyOperation(storage: Pick<Storage, "getItem" | "setItem">, key: string, text: string, randomUUID: () => string): ReplyOperation {
  const message = text.trim();
  const existing = loadReplyOperation(storage, key);
  if (existing) {
    if (existing.message !== message) throw new Error("REPLY_OPERATION_MISMATCH");
    return existing;
  }
  const operation = { requestId: randomUUID(), message };
  storage.setItem(key, JSON.stringify(operation));
  return operation;
}
