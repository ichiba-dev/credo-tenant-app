"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OwnerReportEstimates } from "./types";
import { createOwnerReport } from "./owner-report-actions";

const MAX_SIZE = 15 * 1024 * 1024;
const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

type UploadStatus = { name: string; state: "sending" | "success" | "error"; message: string };

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function typeLabel(mime: string) {
  if (mime === "application/pdf") return "PDF";
  if (mime === "image/jpeg") return "JPEG";
  if (mime === "image/png") return "PNG";
  return mime;
}

export default function EstimateSection({ repairId, estimates, canUpdate, initialSummary }: {
  repairId: number;
  estimates: OwnerReportEstimates | null;
  canUpdate: boolean;
  initialSummary: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [statuses, setStatuses] = useState<UploadStatus[]>([]);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState(initialSummary);
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState("");

  async function handleCreateReport() {
    if (creating || !canUpdate) return;
    setCreating(true);
    setCreateMessage("");
    try {
      const result = await createOwnerReport({ repairId, summary });
      if (!result.ok) {
        setCreateMessage(result.message);
        if (result.loginRequired) window.location.assign("/admin/login");
        return;
      }
      setCreateMessage(result.alreadyExists ? "既に作成済みです。最新の表示へ更新します。" : "オーナー報告を作成しました。");
      router.refresh();
    } catch {
      setCreateMessage("通信に失敗しました。再読み込みして作成状況をご確認ください。");
    } finally {
      setCreating(false);
    }
  }

  if (!estimates) {
    return (
      <section className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h2 className="font-bold text-gray-800">オーナー報告・見積書</h2>
        <p className="mt-2 text-sm text-amber-800">先にオーナー報告を作成してください</p>
        {canUpdate ? (
          <div className="mt-4">
            <label htmlFor={`owner-report-summary-${repairId}`} className="text-sm font-bold text-gray-700">オーナーへの報告内容</label>
            <textarea
              id={`owner-report-summary-${repairId}`}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={5000}
              disabled={creating}
              className="mt-2 min-h-28 w-full rounded border border-amber-300 bg-white p-3 text-sm text-gray-800"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-xs text-gray-500">{summary.length}/5,000文字</span>
              <button type="button" onClick={() => void handleCreateReport()} disabled={creating || summary.trim().length === 0}
                className="rounded bg-[#0b2e59] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {creating ? "作成中…" : "オーナー報告を作成"}
              </button>
            </div>
            {createMessage && <p role="status" className="mt-3 text-sm text-red-700">{createMessage}</p>}
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-600">閲覧専用のため、オーナー報告は作成できません。</p>
        )}
      </section>
    );
  }
  const reportEstimates = estimates;

  async function uploadSelected(files: FileList | null) {
    if (!files || files.length === 0 || uploading) return;
    const selected = Array.from(files);
    const remaining = Math.max(10 - reportEstimates.files.length, 0);
    if (selected.length > remaining) {
      setStatuses([{ name: "選択したファイル", state: "error", message: `追加できるのは残り${remaining}件です。` }]);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setUploading(true);
    const next: UploadStatus[] = selected.map((file) => ({ name: file.name, state: "sending", message: "送信中…" }));
    setStatuses(next);
    let succeeded = false;
    for (let index = 0; index < selected.length; index++) {
      const file = selected[index];
      let state: UploadStatus;
      if (!allowedTypes.has(file.type)) {
        state = { name: file.name, state: "error", message: "PDF、JPEG、PNGのみ選択できます。" };
      } else if (file.size <= 0 || file.size > MAX_SIZE) {
        state = { name: file.name, state: "error", message: "ファイルは15MB以下にしてください。" };
      } else {
        try {
          const body = new FormData();
          body.set("file", file);
          const response = await fetch(`/api/admin/repairs/${repairId}/estimates`, { method: "POST", body });
          const payload = await response.json().catch(() => null) as { message?: string } | null;
          if (!response.ok) throw new Error(payload?.message || "アップロードに失敗しました。");
          succeeded = true;
          state = { name: file.name, state: "success", message: "登録しました。" };
        } catch (error) {
          state = { name: file.name, state: "error", message: error instanceof Error ? error.message : "アップロードに失敗しました。" };
        }
      }
      next[index] = state;
      setStatuses([...next]);
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    if (succeeded) router.refresh();
  }

  return (
    <section className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-gray-800">オーナー報告・見積書</h2>
        <span className="text-xs font-medium text-gray-500">{estimates.files.length}/10件</span>
      </div>

      {estimates.files.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {estimates.files.map((file) => (
            <li key={file.id} className="flex flex-col gap-2 rounded border bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-800" title={file.original_filename}>{file.original_filename}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {typeLabel(file.mime_type)} ・ {formatSize(file.file_size)} ・ {new Date(file.created_at).toLocaleString("ja-JP")}
                </p>
              </div>
              <a href={`/api/admin/estimate-files/${file.id}/open`} target="_blank" rel="noopener noreferrer"
                className="shrink-0 rounded bg-[#0b2e59] px-3 py-1.5 text-center text-sm font-bold text-white">
                表示
              </a>
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm text-gray-500">登録済みの見積書はありません。</p>}

      {canUpdate ? (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <label className="inline-block cursor-pointer rounded bg-emerald-700 px-4 py-2 text-sm font-bold text-white has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
            {uploading ? "送信中…" : "見積書を追加"}
            <input ref={inputRef} type="file" multiple accept="application/pdf,image/jpeg,image/png" disabled={uploading || estimates.files.length >= 10}
              className="sr-only" onChange={(event) => void uploadSelected(event.target.files)} />
          </label>
          <p className="mt-2 text-xs text-gray-500">PDF・JPEG・PNG、最大10件、1件15MBまで。ファイルは1件ずつ送信します。</p>
        </div>
      ) : <p className="mt-4 border-t border-slate-200 pt-3 text-sm text-gray-500">閲覧専用のため、見積書は追加できません。</p>}

      {statuses.length > 0 && (
        <ul aria-live="polite" className="mt-3 space-y-1 text-sm">
          {statuses.map((status, index) => (
            <li key={`${status.name}-${index}`} className={status.state === "error" ? "text-red-700" : status.state === "success" ? "text-emerald-700" : "text-gray-600"}>
              {status.name}: {status.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
