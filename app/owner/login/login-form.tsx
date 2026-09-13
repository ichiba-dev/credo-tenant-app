"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createAuthBrowserClient } from "@/lib/supabase-auth/client";
import { ForgotPasswordForm } from "./forgot-password-form";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const supabase = createAuthBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setErrorMessage("メールアドレスまたはパスワードが正しくありません。");
      setIsSubmitting(false);
      return;
    }

    router.replace(nextPath);
    router.refresh();
  }

  return (
    <>
    <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
      <div>
        <label htmlFor="email" className="block text-sm font-bold text-[#0b2e59]">
          メールアドレス
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-base text-slate-900 outline-none transition focus:border-[#b99452] focus:ring-2 focus:ring-[#b99452]/20"
          placeholder="owner@example.com"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-bold text-[#0b2e59]">
          パスワード
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-base text-slate-900 outline-none transition focus:border-[#b99452] focus:ring-2 focus:ring-[#b99452]/20"
        />
      </div>
      {errorMessage && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {errorMessage}
        </p>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-xl bg-[#0b2e59] px-5 py-4 text-base font-bold text-white shadow-lg shadow-[#0b2e59]/15 transition hover:bg-[#123d70] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "ログイン中…" : "ログイン"}
      </button>
    </form>
    <ForgotPasswordForm />
    </>
  );
}
