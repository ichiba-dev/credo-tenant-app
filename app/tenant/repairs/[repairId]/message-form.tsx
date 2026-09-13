"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitTenantMessage } from "./message-actions";

export function TenantMessageForm({ repairId }: { repairId: number }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [resultMessage, setResultMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  function submit() {
    if (busy.current || pending) return;
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 2000) {
      setIsError(true);
      setResultMessage("メッセージを1〜2000文字で入力してください。");
      return;
    }
    busy.current = true;
    setResultMessage("");
    startTransition(async () => {
      try {
        const result = await submitTenantMessage(String(repairId), message);
        if (!result.ok) {
          setIsError(true);
          setResultMessage(result.message);
          if (result.loginRequired) window.location.assign(`/tenant/login?next=${encodeURIComponent(`/tenant/repairs/${repairId}`)}`);
          return;
        }
        setMessage("");
        setIsError(false);
        setResultMessage("メッセージを送信しました。");
        router.refresh();
      } catch {
        setIsError(true);
        setResultMessage("通信に失敗しました。再度お試しください。");
      } finally {
        busy.current = false;
      }
    });
  }

  return <div>
    <label htmlFor="tenant-additional-message" className="sr-only">追加メッセージ</label>
    <textarea id="tenant-additional-message" value={message} maxLength={2000} rows={5} onChange={(event) => setMessage(event.target.value)} disabled={pending} className="w-full resize-none rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-[#b99452]" placeholder="追加で伝えたい内容を入力してください。" />
    <p className="mt-1 text-right text-xs text-slate-400">残り {2000 - message.length} 文字</p>
    {resultMessage && <p role={isError ? "alert" : "status"} className={`mt-3 text-sm ${isError ? "text-red-700" : "text-emerald-700"}`}>{resultMessage}</p>}
    <button type="button" onClick={submit} disabled={pending || !message.trim()} className="mt-3 w-full rounded-xl bg-[#0b2e59] px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{pending ? "送信中…" : "送信する"}</button>
  </div>;
}
