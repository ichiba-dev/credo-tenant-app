"use client";
import { useState } from "react";
import type { UnassignedLineAttachment } from "./types";
import LineAttachmentAssignment from "./line-attachment-assignment";

function AttachmentImage({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p role="alert" className="mt-3 text-sm text-red-700">画像を表示できません</p>;
  const url = `/api/admin/line-attachments/${encodeURIComponent(id)}/open`;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block" aria-label="画像を拡大して開く">
    {/* A private image is authorized on each request; Next image optimization must not cache it. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url} alt="入居者からのLINE添付画像" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="max-h-40 max-w-60 rounded-lg object-contain" />
  </a>;
}
export default function LineAttachmentSection({ attachments, unavailable, canUpdate }: { attachments: UnassignedLineAttachment[]; unavailable: boolean; canUpdate: boolean }) {
  return <section aria-labelledby="line-attachments-heading" className="mb-8 rounded-xl bg-white p-6 shadow">
    <h2 id="line-attachments-heading" className="text-xl font-bold text-[#0b2e59]">未割当LINE添付</h2>
    <p className="mt-2 text-sm text-gray-500">修理依頼に未割当の写真・PDFを、新しい順に最新50件表示します。</p>
    {unavailable ? <p role="alert" className="mt-4 text-sm text-red-700">LINE添付を取得できませんでした。時間をおいて再読み込みしてください。</p> :
      !attachments.length ? <p className="mt-4 text-sm text-gray-500">未割当LINE添付はありません。</p> :
      <ol className="mt-4 max-h-[36rem] space-y-3 overflow-y-auto">{attachments.map(f => <li key={f.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex flex-wrap justify-between gap-2"><span className="font-bold text-gray-800">{f.tenant_name}</span><time dateTime={f.created_at} className="text-xs text-gray-500">{new Date(f.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</time></div>
        <div className="mt-2 flex gap-2 text-xs"><span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-800">LINE</span><span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">未割当</span><span>{f.media_type === "image" ? "写真" : "PDF"}</span></div>
        {f.media_type === "image" ? <AttachmentImage id={f.id} /> : <div className="mt-3"><p className="break-words text-sm">{f.original_filename || "PDFファイル"}</p><p className="mt-1 text-xs text-gray-500">{(f.file_size / (1024 * 1024)).toFixed(2)} MiB</p><a href={`/api/admin/line-attachments/${encodeURIComponent(f.id)}/open`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-bold text-[#0b2e59] underline">PDFを開く</a></div>}
        {canUpdate && <LineAttachmentAssignment attachmentId={f.id} />}
      </li>)}</ol>}
  </section>;
}
