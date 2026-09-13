"use client";

import { type FormEvent, useRef, useState } from "react";

import { createAuthBrowserClient } from "@/lib/supabase-auth/client";

export function ForgotPasswordForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const busy = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || isSent) return;
    const email = String(new FormData(event.currentTarget).get("resetEmail") ?? "").trim();
    busy.current = true;
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const supabase = createAuthBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/owner/reset-password`,
      });

      // アカウントの有無に関係する応答は成功時と同じ表示にする。
      // 再試行が必要な通信障害・送信制限のみ、共通のエラーで案内する。
      if (error && (
        error.status === 429 ||
        (error.status !== undefined && error.status >= 500) ||
        error.name === "AuthRetryableFetchError"
      )) {
        setErrorMessage("現在メール送信を受け付けられません。通信状況を確認し、しばらく待ってから再試行してください。");
        return;
      }

      setIsSent(true);
    } catch {
      setErrorMessage("現在メール送信を受け付けられません。通信状況を確認し、しばらく待ってから再試行してください。");
    } finally {
      busy.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="forgot-password-panel"
        onClick={() => setIsOpen(!isOpen)}
        className="block w-full text-center text-sm text-[#0b2e59] underline underline-offset-4"
      >
        パスワードをお忘れですか？
      </button>
      <div id="forgot-password-panel" hidden={!isOpen}>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="パスワード再設定メールの送信">
          <p className="text-sm leading-6 text-slate-600">
            ご登録のメールアドレスを入力してください。登録がある場合に、パスワード再設定用のメールが届きます。
          </p>
          <div>
            <label htmlFor="reset-email" className="block text-sm font-bold text-[#0b2e59]">メールアドレス</label>
            <input
              id="reset-email"
              name="resetEmail"
              type="email"
              autoComplete="email"
              required
              disabled={isSubmitting}
              onChange={() => { setIsSent(false); setErrorMessage(""); }}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-[#b99452] focus:ring-2 focus:ring-[#b99452]/20"
            />
          </div>
          {isSent && (
            <div role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm leading-6 text-green-800">
              <p>パスワード再設定メールを送信しました</p>
              <p className="mt-1">登録がある場合にメールが届きます。届かない場合は、入力したアドレスや迷惑メールフォルダをご確認ください。</p>
            </div>
          )}
          {errorMessage && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</p>}
          <button
            type="submit"
            disabled={isSubmitting || isSent}
            className="w-full rounded-xl bg-[#0b2e59] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#123d70] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "送信中…" : isSent ? "送信リクエスト受付済み" : "パスワード再設定メールを送信"}
          </button>
        </form>
      </div>
    </div>
  );
}
