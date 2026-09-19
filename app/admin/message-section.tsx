"use client";

import MessageAttachment from "./message-attachment";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitStaffMessage } from "./message-actions";
import type { TenantRepairMessage } from "./types";
import { loadReplyOperation, prepareReplyOperation } from "@/lib/staff-reply-operation";
import type { ReplyOperation } from "@/lib/staff-reply-operation";

export function MessageSection({ repairId, messages, canUpdate, lineUnavailable, attachmentsUnavailable, replyScope = "" }: { repairId: number; messages: TenantRepairMessage[]; canUpdate: boolean; lineUnavailable?: boolean; attachmentsUnavailable?: boolean; replyScope?: string }) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const [operation, setOperation] = useState<ReplyOperation | null>(null);
  const storageKey = `credo:staff-reply:${replyScope}:${repairId}`;
  useEffect(() => {
    if (!canUpdate) return;
    // Restore browser storage after hydration; cancel when the staff scope changes.
    const timer = window.setTimeout(() => {
      try {
        const restored = loadReplyOperation(sessionStorage, storageKey);
        setOperation(restored);
        setReply(restored?.message ?? "");
        if (restored) setNotice("未確定の返信があります。同じ返信操作で結果を確認してください。");
      } catch { setError(true); setNotice("返信操作の保存領域を確認できません。送信前にブラウザ設定を確認してください。"); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canUpdate, storageKey]);
  function submit() {
    if (busy.current || pending || !canUpdate) return;
    const value = reply.trim();
    if (!value || value.length > 2000) { setError(true); setNotice("返信を1〜2000文字で入力してください。"); return; }
    busy.current = true; setNotice("");
    startTransition(async () => {
      try {
        let current;
        try {
          current = prepareReplyOperation(sessionStorage, storageKey, value, () => crypto.randomUUID());
          setOperation(current);
        } catch { setError(true); setNotice("返信操作を保持できません。同じ返信内容とブラウザ設定を確認してください。"); return; }
        const result = await submitStaffMessage(String(repairId), current.message, current.requestId);
        if (!result.ok) { setError(true); setNotice(result.message); if (result.loginRequired) window.location.assign("/admin/login"); return; }
        const notices = {
          accepted: "返信を保存し、LINEへ送信しました",
          not_linked: "返信を保存しました（LINE未連携）",
          sending: "返信は保存済みです。LINE送信処理中です",
          failed: "返信は保存しましたが、LINE送信に失敗しました",
          expired: "返信は保存しました。LINE送信の再試行期限が切れています",
          unknown: "返信は保存しました。LINE送信結果を確認できませんでした",
        };
        setError(result.lineStatus === "failed" || result.lineStatus === "expired" || result.lineStatus === "unknown");
        setNotice(notices[result.lineStatus]);
        if (["accepted", "not_linked", "failed", "expired"].includes(result.lineStatus)) {
          try { sessionStorage.removeItem(storageKey); setOperation(null); setReply(""); }
          catch { setNotice(`${notices[result.lineStatus]}。操作記録を消去できないため、新しい返信はまだ送信できません。`); }
        }
        router.refresh();
      } catch { setError(true); setNotice("返信結果を確認できませんでした。同じ返信操作で再確認してください。"); }
      finally { busy.current = false; }
    });
  }
  return <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
    <h3 className="font-bold text-[#0b2e59]">入居者とのメッセージ</h3>
    {lineUnavailable && <p role="alert" className="mt-2 text-sm text-red-700">LINEメッセージを取得できませんでした。時間をおいて再読み込みしてください。</p>}
    {attachmentsUnavailable && <p role="alert" className="mt-2 text-sm text-red-700">LINE添付を取得できませんでした。時間をおいて再読み込みしてください。</p>}
    {!messages.length ? <p className="mt-2 text-sm text-gray-500">メッセージはありません。</p> : <ol className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">{messages.map((item) => <li key={item.id} className={`rounded-lg p-3 text-sm ${item.sender_type === "staff" ? "ml-4 bg-[#0b2e59] text-white" : "mr-4 bg-white text-gray-800"}`}><div className={`flex flex-wrap justify-between gap-2 text-xs ${item.sender_type === "staff" ? "text-slate-300" : "text-gray-500"}`}><span>{item.sender_name}{item.channel === "line" && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">LINE</span>}</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</time></div>{item.attachment ? <MessageAttachment attachment={item.attachment} repairId={repairId} /> : <p className="mt-2 whitespace-pre-wrap break-words">{item.message}</p>}</li>)}</ol>}
    {canUpdate ? <div className="mt-4 border-t border-amber-200 pt-4"><label htmlFor={`staff-reply-${repairId}`} className="text-sm font-bold text-gray-700">入居者へ返信</label><textarea id={`staff-reply-${repairId}`} value={reply} maxLength={2000} rows={4} disabled={pending || operation !== null} onChange={(event) => setReply(event.target.value)} className="mt-2 w-full resize-none rounded-lg border border-gray-300 bg-white p-3 text-sm" /><p className="mt-1 text-right text-xs text-gray-500">残り {2000 - reply.length} 文字</p>{notice && <p role={error ? "alert" : "status"} className={`mt-2 text-sm ${error ? "text-red-700" : "text-emerald-700"}`}>{notice}</p>}<button type="button" onClick={submit} disabled={pending || !reply.trim()} className="mt-3 rounded-lg bg-[#0b2e59] px-5 py-2.5 font-bold text-white disabled:opacity-50">{pending ? "確認中…" : operation ? "同じ返信の結果を確認" : "返信する"}</button></div> : <p className="mt-4 border-t border-amber-200 pt-3 text-xs text-gray-500">閲覧専用のため返信できません。</p>}
  </section>;
}
