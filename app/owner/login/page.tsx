import { redirect } from "next/navigation";

import { LoginForm } from "./login-form";
import { createAuthServerClient } from "@/lib/supabase-auth/server";
import { ownerRepairPath } from "@/lib/repair-id";

export default async function OwnerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ passwordReset?: string; next?: string }>;
}) {
  const { passwordReset, next } = await searchParams;
  const nextPath = ownerRepairPath(next);
  const supabase = await createAuthServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect(nextPath);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f5f7] px-4 py-10 text-slate-900">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
        <header className="relative bg-[#0b2e59] px-7 py-8 text-white">
          <div className="absolute inset-y-0 left-0 w-1.5 bg-[#b99452]" />
          <p
            className="notranslate text-xl font-bold tracking-[0.24em]"
            translate="no"
          >
            CREDO
          </p>
          <h1 className="mt-6 text-2xl font-bold">オーナー様ログイン</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            修繕報告をご確認いただけます。
          </p>
        </header>
        <div className="px-6 pb-8 pt-1 sm:px-8">
          {passwordReset === "success" && (
            <p role="status" className="mt-6 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800">
              パスワードを更新しました。新しいパスワードでログインしてください。
            </p>
          )}
          <LoginForm nextPath={nextPath} />
          <p className="mt-7 text-center text-xs leading-5 text-slate-400">
            ログイン情報は第三者へ共有しないでください。
          </p>
        </div>
      </div>
    </main>
  );
}
