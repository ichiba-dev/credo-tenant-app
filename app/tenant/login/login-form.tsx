"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createAuthBrowserClient } from "@/lib/supabase-auth/client";

const label = { email: "\u30e1\u30fc\u30eb\u30a2\u30c9\u30ec\u30b9", password: "\u30d1\u30b9\u30ef\u30fc\u30c9", login: "\u30ed\u30b0\u30a4\u30f3", loading: "\u30ed\u30b0\u30a4\u30f3\u4e2d\u2026", error: "\u30e1\u30fc\u30eb\u30a2\u30c9\u30ec\u30b9\u307e\u305f\u306f\u30d1\u30b9\u30ef\u30fc\u30c9\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093\u3002" };
export function TenantLoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter(); const [errorMessage, setErrorMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setErrorMessage(""); setBusy(true); const form = new FormData(event.currentTarget);
    const { error } = await createAuthBrowserClient().auth.signInWithPassword({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
    if (error) { setErrorMessage(label.error); setBusy(false); return; }
    router.replace(nextPath); router.refresh();
  }
  return <form className="mt-8 space-y-5" onSubmit={submit}>
    <div><label htmlFor="email" className="block text-sm font-bold text-[#0b2e59]">{label.email}</label><input id="email" name="email" type="email" autoComplete="email" required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3.5 outline-none focus:border-[#b99452]" placeholder="tenant@example.com" /></div>
    <div><label htmlFor="password" className="block text-sm font-bold text-[#0b2e59]">{label.password}</label><input id="password" name="password" type="password" autoComplete="current-password" required className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3.5 outline-none focus:border-[#b99452]" /></div>
    {errorMessage && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</p>}
    <button type="submit" disabled={busy} className="w-full rounded-xl bg-[#0b2e59] px-5 py-4 font-bold text-white disabled:opacity-60">{busy ? label.loading : label.login}</button>
  </form>;
}
