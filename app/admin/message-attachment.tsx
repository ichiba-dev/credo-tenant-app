"use client";

import { useState } from "react";
import type { TenantRepairMessage } from "./types";

export default function MessageAttachment({ attachment, repairId }: { attachment: NonNullable<TenantRepairMessage["attachment"]>; repairId: number }) {
  const [failed, setFailed] = useState(false);
  const url = `/api/admin/line-attachments/${encodeURIComponent(attachment.id)}/open?repairId=${repairId}`;
  if (attachment.media_type === "image") {
    if (failed) return <p role="alert" className="mt-2 text-sm text-red-700">画像を表示できません</p>;
    return <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block" aria-label="画像を拡大して開く">
      {/* Reauthorize each request instead of caching private images with the image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="入居者からのLINE添付画像" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="max-h-48 max-w-full rounded-lg object-contain" />
    </a>;
  }
  return <div className="mt-2">
    <p className="break-words [overflow-wrap:anywhere]">{attachment.original_filename || "PDFファイル"}</p>
    <p className="mt-1 text-xs text-gray-500">{(attachment.file_size / 1_000_000).toFixed(2)} MB</p>
    <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-bold text-[#0b2e59] underline">PDFを開く</a>
  </div>;
}
