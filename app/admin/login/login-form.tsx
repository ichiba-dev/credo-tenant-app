"use client";

import { useRef, useState, type FormEvent } from "react";
import { createAuthBrowserClient } from "@/lib/supabase-auth/client";

export default function StaffLoginForm() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = new FormData(event.currentTarget);
    busy.current = true;
    setPending(true);
    setMessage("");
    try {
      const { error } = await createAuthBrowserClient().auth.signInWithPassword({
        email: String(form.get("email") ?? "").trim(), password: String(form.get("password") ?? ""),
      });
      if (error) setMessage("ログインできませんでした。メールアドレスとパスワードをご確認ください。");
      else window.location.assign("/admin");
    } catch {
      setMessage("通信に失敗しました。時間をおいて再試行してください。");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return <form onSubmit={submit} className="mt-6 space-y-4">
    <label className="block">メールアドレス<input name="email" type="email" autoComplete="username" required className="mt-1 block w-full rounded border p-3" /></label>
    <label className="block">パスワード<input name="password" type="password" autoComplete="current-password" required className="mt-1 block w-full rounded border p-3" /></label>
    {message && <p role="alert" className="text-red-700">{message}</p>}
    <button disabled={pending} className="rounded bg-blue-900 px-4 py-3 text-white disabled:opacity-50">{pending ? "ログイン中…" : "スタッフログイン"}</button>
  </form>;
}
