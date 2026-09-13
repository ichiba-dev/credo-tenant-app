"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitStaffMessage } from "./message-actions";
import type { TenantRepairMessage } from "./types";

export function MessageSection({ repairId, messages, canUpdate }: { repairId: number; messages: TenantRepairMessage[]; canUpdate: boolean }) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  function submit() {
    if (busy.current || pending || !canUpdate) return;
    const value = reply.trim();
    if (!value || value.length > 2000) { setError(true); setNotice("返信を1〜2000文字で入力してください。"); return; }
    busy.current = true; setNotice("");
    startTransition(async () => {
      try {
        const result = await submitStaffMessage(String(repairId), reply);
        if (!result.ok) { setError(true); setNotice(result.message); if (result.loginRequired) window.location.assign("/admin/login"); return; }
        setReply(""); setError(false); setNotice("返信を送信しました。"); router.refresh();
      } catch { setError(true); setNotice("通信に失敗しました。再度お試しください。"); }
      finally { busy.current = false; }
    });
  }
  return <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
    <h3 className="font-bold text-[#0b2e59]">入居者とのメッセージ</h3>
    {!messages.length ? <p className="mt-2 text-sm text-gray-500">メッセージはありません。</p> : <ol className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">{messages.map((item) => <li key={item.id} className={`rounded-lg p-3 text-sm ${item.sender_type === "staff" ? "ml-4 bg-[#0b2e59] text-white" : "mr-4 bg-white text-gray-800"}`}><div className={`flex flex-wrap justify-between gap-2 text-xs ${item.sender_type === "staff" ? "text-slate-300" : "text-gray-500"}`}><span>{item.sender_name}</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</time></div><p className="mt-2 whitespace-pre-wrap break-words">{item.message}</p></li>)}</ol>}
    {canUpdate ? <div className="mt-4 border-t border-amber-200 pt-4"><label htmlFor={`staff-reply-${repairId}`} className="text-sm font-bold text-gray-700">入居者へ返信</label><textarea id={`staff-reply-${repairId}`} value={reply} maxLength={2000} rows={4} disabled={pending} onChange={(event) => setReply(event.target.value)} className="mt-2 w-full resize-none rounded-lg border border-gray-300 bg-white p-3 text-sm" /><p className="mt-1 text-right text-xs text-gray-500">残り {2000 - reply.length} 文字</p>{notice && <p role={error ? "alert" : "status"} className={`mt-2 text-sm ${error ? "text-red-700" : "text-emerald-700"}`}>{notice}</p>}<button type="button" onClick={submit} disabled={pending || !reply.trim()} className="mt-3 rounded-lg bg-[#0b2e59] px-5 py-2.5 font-bold text-white disabled:opacity-50">{pending ? "送信中…" : "返信する"}</button></div> : <p className="mt-4 border-t border-amber-200 pt-3 text-xs text-gray-500">閲覧専用のため返信できません。</p>}
  </section>;
}
