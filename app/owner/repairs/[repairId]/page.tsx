import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { connection } from "next/server";

import { createAuthServerClient } from "@/lib/supabase-auth/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { ApprovalForm } from "./approval-form";
import { PhotoUnavailableError, resolveRepairPhotoUrl } from "@/lib/repair-photo-urls";
import RepairImage from "@/app/components/repair-image";
import { parseRepairId } from "@/lib/repair-id";

type RepairPhoto = {
  photo_url: string;
  sort_order: number | null;
};

type EstimateFile = {
  id: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
};

function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

function estimateTypeLabel(mime: string) {
  if (mime === "application/pdf") return "PDF";
  if (mime === "image/jpeg") return "JPEG";
  if (mime === "image/png") return "PNG";
  return "ファイル";
}

const decisionBadgeLabels: Record<string, string> = {
  pending: "承認待ち",
  approved: "承認済み",
  consultation: "相談中",
};

const decisionLabels: Record<string, string> = {
  pending: "回答待ち",
  approved: "承認済み",
  consultation: "相談中",
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 border-b border-slate-100 py-3 last:border-b-0">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

export default async function OwnerRepairReportPage({ params }: { params: Promise<{ repairId: string }> }) {
  await connection();
  const rawRepairId = (await params).repairId;
  const repairId = parseRepairId(rawRepairId);
  if (repairId === null) notFound();

  const authSupabase = await createAuthServerClient();
  const {
    data: { user }, error: authError,
  } = await authSupabase.auth.getUser();

  if (authError || !user) {
    redirect(`/owner/login?next=${encodeURIComponent(`/owner/repairs/${repairId}`)}`);
  }

  const supabase = createServerSupabaseClient();

  const { data: owner, error: ownerAuthError } = await supabase
    .from("owners")
    .select("id, name")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (ownerAuthError) {
    throw new Error("オーナー認証情報の取得に失敗しました。");
  }

  if (!owner) {
    notFound();
  }

  const { data: recipientCandidates, error: recipientCandidatesError } =
    await supabase
      .from("owner_report_recipients")
      .select("owner_report_id, organization_id, is_approval_required")
      .eq("owner_id", owner.id);

  if (recipientCandidatesError) {
    throw new Error("報告先オーナーの確認に失敗しました。");
  }

  const { data: repair, error: repairError } = await supabase
    .from("repair_requests")
    .select("id, organization_id, property_name, room_number, tenant_name, category, description, storage_path, photo_url")
    .eq("id", repairId)
    .maybeSingle();

  if (repairError) throw new Error("修理依頼の取得に失敗しました。");
  if (!repair?.organization_id || repair.id !== repairId) notFound();

  const candidateReportIds = (recipientCandidates ?? [])
    .filter((recipient) => recipient.organization_id === repair.organization_id)
    .map((recipient) => recipient.owner_report_id);

  if (candidateReportIds.length === 0) {
    notFound();
  }

  const { data: authorizedReport, error: authorizationError } = await supabase
    .from("owner_reports")
    .select("id, organization_id, repair_request_id")
    .eq("organization_id", repair.organization_id)
    .eq("repair_request_id", repairId)
    .in("id", candidateReportIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (authorizationError) {
    throw new Error("修理報告の閲覧権限確認に失敗しました。");
  }

  if (!authorizedReport || authorizedReport.organization_id !== repair.organization_id || authorizedReport.repair_request_id !== repairId) {
    notFound();
  }

  const [reportResult, photosResult] = await Promise.all([
    supabase
      .from("owner_reports")
      .select(
        "id, organization_id, repair_request_id, repair_summary, credo_comment, estimated_amount, approval_required, status"
      )
      .eq("id", authorizedReport.id)
      .maybeSingle(),
    supabase
      .from("repair_photos")
      .select("repair_id, organization_id, photo_url, storage_path, sort_order")
      .eq("repair_id", repairId)
      .eq("organization_id", repair.organization_id)
      .order("sort_order", { ascending: true }),
  ]);

  if (reportResult.error) {
    throw new Error("オーナー報告の取得に失敗しました。");
  }

  if (photosResult.error) {
    throw new Error("修理写真の取得に失敗しました。");
  }

  const report = reportResult.data;

  if (!report || report.organization_id !== repair.organization_id || report.repair_request_id !== repairId) {
    notFound();
  }

  const approvalResult = await supabase
      .from("owner_approvals")
      .select("decision, comment")
      .eq("owner_report_id", report.id)
      .eq("owner_id", owner.id)
      .eq("organization_id", repair.organization_id)
      .maybeSingle();

  if (approvalResult.error) {
    throw new Error("回答状況の取得に失敗しました。");
  }

  let estimateFiles: EstimateFile[] = [];
  let estimatesUnavailable = false;
  const estimateResult = await supabase
    .from("owner_report_estimate_files")
    .select("id, organization_id, repair_request_id, owner_report_id, original_filename, mime_type, file_size, sort_order, created_at")
    .eq("owner_report_id", report.id)
    .eq("repair_request_id", repairId)
    .eq("organization_id", repair.organization_id)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (estimateResult.error || !estimateResult.data) {
    estimatesUnavailable = true;
  } else if (estimateResult.data.some((file) =>
    file.organization_id !== repair.organization_id || file.repair_request_id !== repairId || file.owner_report_id !== report.id)) {
    estimatesUnavailable = true;
  } else {
    estimateFiles = estimateResult.data.map((file) => ({
      id: file.id,
      original_filename: file.original_filename,
      mime_type: file.mime_type,
      file_size: Number(file.file_size),
    }));
  }

  const photos: RepairPhoto[] = [];
  let photosUnavailable = false;
  const photoRows = photosResult.data ?? [];
  if (photoRows.some((photo) => photo.repair_id !== repairId || photo.organization_id !== repair.organization_id)) {
    throw new Error("写真の閲覧権限を確認できませんでした。");
  }
  for (const photo of photoRows) {
    try {
      const url = await resolveRepairPhotoUrl(photo, repair.organization_id, repairId);
      if (url) photos.push({ photo_url: url, sort_order: photo.sort_order });
    } catch (error) {
      if (!(error instanceof PhotoUnavailableError)) throw error;
      photosUnavailable = true;
    }
  }
  if (!photoRows.some((photo) => photo.storage_path || photo.photo_url)) {
    try {
      const url = await resolveRepairPhotoUrl(repair, repair.organization_id, repairId);
      if (url) photos.push({ photo_url: url, sort_order: 1 });
    } catch (error) {
      if (!(error instanceof PhotoUnavailableError)) throw error;
      photosUnavailable = true;
    }
  }
  const approval = approvalResult.data;
  const estimatedAmount =
    report.estimated_amount == null
      ? "確認中"
      : `¥${new Intl.NumberFormat("ja-JP").format(
          Number(report.estimated_amount)
        )}`;
  const decision = approval?.decision ?? "pending";
  const visiblePhotos = photos.slice(0, 4);
  const remainingPhotoCount = Math.max(photos.length - visiblePhotos.length, 0);

  return (
    <main className="min-h-screen bg-[#f3f5f7] px-4 py-5 text-slate-900 sm:py-8">
      <div className="mx-auto max-w-xl overflow-hidden rounded-3xl bg-white shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
        <div className="bg-[#f8f3e8] px-6 py-3">
          <Link href="/owner" className="text-sm font-bold text-[#0b2e59] hover:underline">← 案件一覧へ戻る</Link>
        </div>
        <header className="relative overflow-hidden bg-[#0b2e59] px-6 pb-8 pt-7 text-white">
          <div className="absolute inset-y-0 left-0 w-1.5 bg-[#b99452]" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-lg font-bold tracking-[0.22em]">CREDO</p>
              <p className="mt-1 text-sm text-slate-300">修繕報告</p>
            </div>
            <span className="shrink-0 rounded-full border border-[#d8c49c]/60 bg-white/10 px-3 py-1.5 text-sm font-bold text-[#f3dfb2]">
              {decisionBadgeLabels[decision] ?? decision}
            </span>
          </div>
          <div className="mt-8">
            <p className="text-xs font-medium tracking-[0.16em] text-slate-300">
              今回の修繕案件
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">
              {repair.category}不具合
            </h1>
          </div>
        </header>

        <div className="space-y-6 p-5 sm:p-7">
          <section className="rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
            <dl>
              <DetailRow label="物件名" value={repair.property_name} />
              <DetailRow label="号室" value={`${repair.room_number}号室`} />
              <DetailRow label="入居者名" value={repair.tenant_name} />
              <DetailRow label="不具合箇所" value={repair.category} />
            </dl>
          </section>

          <section className="rounded-2xl border border-[#dfcca4] bg-[#fffdf8] p-5 shadow-sm">
            <p className="text-xs font-bold tracking-[0.14em] text-[#9a7533]">
              CREDOからのご報告
            </p>
            <p className="mt-3 whitespace-pre-wrap text-base font-semibold leading-8 text-[#0b2e59]">
              {report.repair_summary}
            </p>

            <div className="my-5 h-px bg-[#e8dcc5]" />
            <h2 className="text-sm font-bold text-[#0b2e59]">
              担当者コメント
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-600">
              {report.credo_comment || "コメントはありません。"}
            </p>
          </section>

          <section className="rounded-2xl bg-[#0b2e59] p-5 text-white shadow-md">
            <p className="text-sm font-medium text-slate-300">見積金額</p>
            <p className="mt-2 text-4xl font-bold tracking-tight">
              {estimatedAmount}
            </p>
            {report.approval_required && (
              <p className="mt-4 rounded-xl border border-[#d8c49c]/50 bg-white/10 px-4 py-3 text-sm font-bold text-[#f3dfb2]">
                オーナー様のご承認が必要です
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-[#dfcca4] bg-[#fffdf8] p-5 shadow-sm">
            <h2 className="font-bold text-[#0b2e59]">見積書</h2>
            {estimatesUnavailable ? (
              <p role="alert" className="mt-3 text-sm text-red-700">見積書を取得できませんでした。再読み込みしてください。</p>
            ) : estimateFiles.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">見積書はまだ登録されていません</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {estimateFiles.map((file) => (
                  <li key={file.id} className="rounded-xl border border-[#e8dcc5] bg-white p-4">
                    <p className="break-all text-sm font-bold text-slate-900">{file.original_filename}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {estimateTypeLabel(file.mime_type)} ・ {formatFileSize(file.file_size)}
                    </p>
                    <a
                      href={`/api/owner/repairs/${repairId}/estimate-files/${file.id}/open`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-block rounded-lg bg-[#0b2e59] px-4 py-2 text-sm font-bold text-white"
                    >
                      見積書を確認
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-slate-50 p-5">
            <h2 className="font-bold text-[#0b2e59]">入居者からの報告</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {repair.description}
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold text-[#0b2e59]">修理写真</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                全{photos.length}枚
              </span>
            </div>
            {visiblePhotos.length > 0 ? (
              <>
                {photosUnavailable && <p role="alert" className="mt-3 text-sm text-red-600">一部の写真を取得できませんでした。再読み込みしてください。</p>}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {visiblePhotos.map((photo, index) => (
                    <figure
                      key={`${photo.sort_order}-${photo.photo_url}`}
                      className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                    >
                      {/* 認可後の署名URL。pathなしの旧画像だけ公開URLを利用する。 */}
                      <RepairImage
                        src={photo.photo_url}
                        alt={`修理写真 ${index + 1}`}
                        className="aspect-square w-full object-cover"
                      />
                      <figcaption className="px-3 py-2 text-xs text-slate-500">
                        写真 {index + 1}
                      </figcaption>
                    </figure>
                  ))}
                </div>
                {remainingPhotoCount > 0 && (
                  <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-center text-sm font-medium text-slate-600">
                    残り{remainingPhotoCount}枚の写真があります
                  </p>
                )}
              </>
            ) : (
              <p role={photosUnavailable ? "alert" : undefined} className="mt-3 text-sm text-slate-500">
                {photosUnavailable ? "写真を取得できませんでした。再読み込みしてください。" : "写真はありません。"}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">回答状況</p>
                <p className="mt-1 text-xl font-bold text-[#0b2e59]">
                  {decisionLabels[decision] ?? decision}
                </p>
              </div>
              <span className="rounded-full bg-[#f5ecd9] px-3 py-1.5 text-sm font-bold text-[#806126]">
                {decisionBadgeLabels[decision] ?? decision}
              </span>
            </div>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-500">オーナー名</p>
              <p className="mt-1 font-semibold text-slate-900">
                {owner.name}
              </p>
              {approval?.comment && (
                <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                  {approval.comment}
                </p>
              )}
            </div>
          </section>

          {approval?.decision === "pending" ? (
            <ApprovalForm key={String(report.id)} repairId={rawRepairId} reportId={String(report.id)} />
          ) : (
            <p className="border-t border-slate-100 pt-6 text-center text-sm text-slate-500">
              {approval
                ? "回答済みです。ご回答ありがとうございました。"
                : "回答の受付準備ができていません。管理会社へお問い合わせください。"}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
