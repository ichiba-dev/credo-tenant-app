import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { createAuthServerClient } from "@/lib/supabase-auth/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getOwnerRepairList } from "./data";

const decisionLabels: Record<string, string> = {
  pending: "回答待ち",
  approved: "承認済み",
  consultation: "相談中",
};

const decisionStyles: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800",
  approved: "bg-emerald-50 text-emerald-800",
  consultation: "bg-blue-50 text-blue-800",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export default async function OwnerRepairsPage() {
  await connection();
  const auth = await createAuthServerClient();
  const { data: { user }, error: authError } = await auth.auth.getUser();
  if (authError || !user) redirect("/owner/login?next=%2Fowner");

  const service = createServerSupabaseClient();
  const { data: owner, error: ownerError } = await service
    .from("owners")
    .select("id, name")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (ownerError) {
    return <main className="p-6"><p role="alert">修理案件を取得できませんでした。時間をおいて再読み込みしてください。</p></main>;
  }
  if (!owner) redirect("/owner/login?next=%2Fowner");

  let repairs;
  try {
    repairs = await getOwnerRepairList(owner.id);
  } catch {
    return <main className="p-6"><p role="alert">修理案件を取得できませんでした。時間をおいて再読み込みしてください。</p></main>;
  }

  return (
    <main className="min-h-screen bg-[#f3f5f7] px-4 py-6 text-slate-900 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <header className="overflow-hidden rounded-3xl bg-[#0b2e59] px-6 py-7 text-white shadow-lg sm:px-8">
          <p className="notranslate text-lg font-bold tracking-[0.22em]" translate="no">CREDO</p>
          <h1 className="mt-5 text-2xl font-bold sm:text-3xl">修理案件一覧</h1>
          <p className="mt-2 text-sm text-slate-300">{owner.name} 様に届いている修繕報告です。</p>
        </header>

        {repairs.length === 0 ? (
          <section className="mt-6 rounded-2xl bg-white p-8 text-center shadow-sm">
            <p className="font-medium text-slate-600">現在確認が必要な修理案件はありません。</p>
          </section>
        ) : (
          <div className="mt-6 space-y-4">
            {repairs.map((repair) => {
              const decision = repair.decision ?? "unknown";
              return (
                <article key={repair.repairId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-bold text-[#0b2e59]">{repair.propertyName} {repair.roomNumber}号室</p>
                      <h2 className="mt-2 text-xl font-bold text-slate-900">{repair.category}</h2>
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${decisionStyles[decision] ?? "bg-slate-100 text-slate-700"}`}>
                      {decisionLabels[decision] ?? "確認中"}
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{repair.description}</p>
                  <dl className="mt-4 grid grid-cols-1 gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500 sm:grid-cols-2">
                    <div><dt className="inline font-medium">受付日：</dt><dd className="inline">{formatDate(repair.repairCreatedAt)}</dd></div>
                    <div><dt className="inline font-medium">報告作成日：</dt><dd className="inline">{formatDate(repair.reportCreatedAt)}</dd></div>
                  </dl>
                  <Link href={`/owner/repairs/${repair.repairId}`} className="mt-5 block rounded-xl bg-[#0b2e59] px-5 py-3 text-center font-bold text-white transition hover:bg-[#123d70]">
                    詳細を見る
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
