"use client";

import { useRef, useState } from "react";
import { refreshRepairPhotos } from "./photo-actions";
import RepairReport from "@/app/pdf/RepairReport";

async function imageData(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Image unavailable");
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Image unavailable"));
    reader.readAsDataURL(blob);
  });
}

export default function RepairPdfButton({ repairId }: { repairId: number }) {
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  async function download() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(false);
    try {
      const { pdf } = await import("@react-pdf/renderer");
      // 一覧表示時のURLを再利用せず、生成開始時に再認可・再署名する。
      const result = await refreshRepairPhotos(repairId);
      if (!result.ok) throw new Error("Unavailable");
      const repair = result.repair;
      const prepared = {
        ...repair,
        photo_url: repair.photo_url ? await imageData(repair.photo_url) : null,
        repair_photos: await Promise.all(repair.repair_photos.map(async (photo) => ({
          ...photo, photo_url: await imageData(photo.photo_url),
        }))),
      };
      // 画像を先に取得して固定し、PDFレイアウト処理中のURL期限切れを避ける。
      const blob = await pdf(<RepairReport repair={prepared} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Repair_Report_${repair.property_name}_${repair.room_number}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  return <>
    <button type="button" onClick={download} disabled={loading} className="ml-2 mt-2 rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50">
      {loading ? "PDF作成中..." : "📄 PDF作成"}
    </button>
    {error && <p role="alert" className="mt-2 text-sm text-red-600">写真またはPDFを取得できませんでした。再ログイン・再読み込み後にお試しください。</p>}
  </>;
}
