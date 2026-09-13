"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { INVALID_LINK, verifyRecoveryLink } from "./recovery";

type Recovery = Awaited<ReturnType<typeof verifyRecoveryLink>>;

export default function ResetPasswordPage() {
  const initialization = useRef<Promise<Recovery> | null>(null);
  const recovery = useRef<Recovery | null>(null);
  const busy = useRef(false);
  const [status, setStatus] = useState<"checking" | "ready" | "invalid" | "updated">("checking");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    // Strict Modeで同じワンタイムコードを二度交換しない。
    initialization.current ??= verifyRecoveryLink();
    initialization.current.then((result) => {
      if (!active) return;
      recovery.current = result;
      setStatus("ready");
    }).catch(() => {
      if (!active) return;
      setStatus("invalid");
      setMessage(INVALID_LINK);
    });
    return () => { active = false; };
  }, []);

  async function finishLogout() {
    if (!recovery.current) return;
    const { error } = await recovery.current.supabase.auth.signOut();
    if (error) {
      setMessage("パスワードは更新済みですが、ログアウトに失敗しました。通信状況を確認し、ログアウトを再試行してください。");
      return;
    }
    // 完全遷移で更新前の認証状態やRouterキャッシュを残さない。
    window.location.replace("/owner/login?passwordReset=success");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || status !== "ready" || !recovery.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get("password") ?? "");
    if (password !== String(values.get("confirmation") ?? "")) {
      setMessage("パスワードが一致しません。確認用パスワードを入力し直してください。");
      return;
    }
    busy.current = true;
    setSubmitting(true);
    setMessage("");
    let updated = false;
    try {
      const { supabase, token, userId } = recovery.current;
      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error } = await supabase.auth.getUser(token);
      if (error || data.user?.id !== userId || sessionData.session?.access_token !== token) {
        setStatus("invalid");
        setMessage(INVALID_LINK);
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setMessage(updateError.code === "same_password"
          ? "現在とは異なるパスワードを入力してください。"
          : updateError.code === "weak_password"
            ? "パスワードが安全性の条件を満たしていません。文字数を増やし、英大文字・小文字・数字・記号を組み合わせてください。"
            : "パスワードを更新できませんでした。通信状況と入力内容を確認してください。解消しない場合は新しい再設定メールを依頼してください。");
        return;
      }
      updated = true;
      form.reset();
      setStatus("updated");
      await finishLogout();
    } catch {
      setMessage(updated
        ? "パスワードは更新済みです。通信状況を確認し、ログアウトを再試行してください。"
        : "通信に失敗しました。接続を確認して再試行してください。");
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  async function retryLogout() {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    try {
      await finishLogout();
    } catch {
      setMessage("ログアウトに失敗しました。通信状況を確認して再試行してください。");
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  const inputClass = "mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#b99452]";
  const buttonClass = "w-full rounded-xl bg-[#0b2e59] px-5 py-4 font-bold text-white disabled:opacity-60";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f5f7] px-4 py-10 text-slate-900">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-xl">
        <header className="border-l-4 border-[#b99452] bg-[#0b2e59] px-7 py-8 text-white">
          <p className="notranslate text-xl font-bold tracking-[0.24em]" translate="no">CREDO</p>
          <h1 className="mt-6 text-2xl font-bold">パスワードの再設定</h1>
        </header>
        <div className="space-y-5 p-7">
          {status === "checking" && <p role="status">再設定リンクを確認しています…</p>}
          {status === "ready" && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <p className="text-sm text-slate-600">新しいパスワードを2回入力してください（6文字以上）。</p>
              <div>
                <label htmlFor="password" className="text-sm font-bold">新しいパスワード</label>
                <input id="password" name="password" type="password" autoComplete="new-password" minLength={6} required disabled={submitting} className={inputClass} />
              </div>
              <div>
                <label htmlFor="confirmation" className="text-sm font-bold">新しいパスワード（確認用）</label>
                <input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={6} required disabled={submitting} className={inputClass} />
              </div>
              <button type="submit" disabled={submitting} className={buttonClass}>{submitting ? "更新中…" : "パスワードを更新"}</button>
            </form>
          )}
          {status === "updated" && <p role="status" className="rounded-xl bg-green-50 p-4 text-green-800">パスワードを更新しました。ログアウト後、ログイン画面へ移動します。</p>}
          {message && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{message}</p>}
          {status === "updated" && !submitting && <button type="button" onClick={retryLogout} className={buttonClass}>ログアウトしてログイン画面へ</button>}
          {status === "invalid" && <Link href="/owner/login" className="block text-center text-sm underline">ログイン画面へ戻る</Link>}
        </div>
      </div>
    </main>
  );
}
