"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { updateRepair } from "./actions";
import type { AdminRepair, RepairPhoto } from "./types";
import RepairPdfButton from "./repair-pdf-button";
import { refreshRepairPhotos } from "./photo-actions";
import RepairImage from "@/app/components/repair-image";
import EstimateSection from "./estimate-section";
import { MessageSection } from "./message-section";

function getDisplayPhotos(repair: {
  photo_url?: string | null;
  repair_photos?: RepairPhoto[];
}) {
  const repairPhotos = Array.isArray(repair.repair_photos)
    ? [...repair.repair_photos]
        .filter((photo) => photo.photo_url)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    : [];

  return repairPhotos.length > 0
    ? repairPhotos
    : repair.photo_url
      ? [{ repair_id: 0, photo_url: repair.photo_url, sort_order: 1 }]
      : [];
}

export default function AdminRepairs({ repairs, canUpdate, children, replyScope }: { repairs: AdminRepair[]; canUpdate: boolean; children?: ReactNode; replyScope?: string }) {
  const router = useRouter();
  const [comments, setComments] = useState<{ [key: number]: string }>({});
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const busy = useRef(false);
  const selectedPhoto = useRef<{ repairId: number; index: number } | null>(null);

  async function openPhoto(repairId: number, index: number) {
    try {
      const result = await refreshRepairPhotos(repairId);
      if (!result.ok) throw new Error("Unavailable");
      const photo = getDisplayPhotos(result.repair)[index];
      if (!photo) throw new Error("Unavailable");
      selectedPhoto.current = { repairId, index };
      setSelectedPhotoUrl(photo.photo_url);
    } catch {
      setMessage("写真を取得できませんでした。再ログイン・再読み込み後にお試しください。");
    }
  }

  async function save(id: number, kind: "status" | "comment", value: string) {
    if (busy.current) return;
    busy.current = true;
    setIsSaving(true);
    setMessage("");
    try {
      const result = await updateRepair({ id, kind, value });
      if (!result.ok) {
        setMessage(result.message);
        if (result.loginRequired) window.location.assign("/admin/login");
        return;
      }
      setMessage(kind === "comment" ? "コメントを保存しました" : "ステータスを更新しました");
      router.refresh();
    } catch {
      setMessage("通信に失敗しました。再読み込みして保存状況をご確認ください。");
    } finally {
      busy.current = false;
      setIsSaving(false);
    }
  }
  async function updateStatus(id: number, status: string) {
    await save(id, "status", status);
  }
  async function saveComment(id: number) {
    await save(id, "comment", comments[id] ?? repairs.find((repair) => repair.id === id)?.staff_comment ?? "");
  }
  return (
    <main className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-5xl">
        {children}

        <h1 className="text-3xl font-bold">
          修理依頼一覧
        </h1>

        <p className="mt-2 text-gray-500">
          入居者から送信された修理依頼です。
        </p>

        <p role="status" className="mt-3 text-sm">{isSaving ? "保存中…" : message}</p>
        {!canUpdate && <p className="mt-3 text-sm">閲覧専用です。ステータス・コメントは更新できません。</p>}
        <div className="mt-8 rounded-xl bg-white p-6 shadow">

         {repairs
           .filter((repair) => repair.property_name)
           .map((repair) => (
           <div
             key={repair.id}
             className="border-b py-4"
           >
             <p className="font-bold">
               {repair.property_name} {repair.room_number}号室
             </p>

              <p>入居者：{repair.tenant_name}</p>

              <p> 不具合：{repair.category}</p>
              {repair.photos_unavailable && <p role="alert" className="mt-2 text-sm text-red-600">一部の写真を取得できませんでした。再読み込みしても表示されない場合は管理者へお問い合わせください。</p>}

              <p className="text-gray-500">
                {repair.description}
              </p>
              {(() => {
                const photos = getDisplayPhotos(repair);

                return photos.length > 0 ? (
                  <section className="mt-4">
                    <p className="mb-2 text-sm font-bold text-gray-700">写真</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {photos.map((photo, index) => (
                        <button
                          key={`${photo.sort_order}-${photo.photo_url}`}
                          type="button"
                          onClick={() => openPhoto(repair.id, index)}
                          className="overflow-hidden rounded-lg border bg-white text-left shadow-sm"
                        >
                          <RepairImage
                            src={photo.photo_url}
                            alt={`修理写真 ${index + 1}`}
                            className="aspect-square w-full object-cover"
                          />
                          <span className="block px-2 py-1.5 text-xs text-gray-600">
                            写真 {index + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null;
              })()}

              <p className="mt-2 text-sm text-gray-400">
                受付日：
                {new Date(repair.created_at).toLocaleDateString("ja-JP")}
              </p>

              <p className="mt-2 font-bold">
               ステータス：{repair.status}
               </p>
              <MessageSection repairId={repair.id} messages={repair.tenant_messages ?? []} canUpdate={canUpdate} lineUnavailable={repair.line_messages_unavailable} replyScope={replyScope} />
               {repair.history && (
                <div className="mt-2 rounded bg-gray-100 p-3 text-sm">
                <p className="font-bold">📅 対応履歴</p>
                <pre className="whitespace-pre-wrap">
                  {repair.history}
                </pre>
                </div>
               )}

              <textarea
                readOnly={!canUpdate}
                className="mt-4 w-full rounded border p-2"
                placeholder="担当者コメントを入力"
                value={comments[repair.id] ?? repair.staff_comment ?? ""}
                onChange={(e) =>
                  setComments({
                   ...comments,
                  [repair.id]: e.target.value,
                })
               }
              />

                <button
                 disabled={isSaving || !canUpdate}
                 onClick={() => saveComment(repair.id)}
                 className="mt-2 rounded bg-gray-800 px-4 py-2 text-white"
>
                 コメント保存
                 </button>

                 <RepairPdfButton repairId={repair.id} />

                 <EstimateSection repairId={repair.id} estimates={repair.owner_report_estimates} canUpdate={canUpdate} initialSummary={repair.description} />
               


               <div className="mt-4 flex gap-2">
               <button
                disabled={isSaving || !canUpdate}
                onClick={() => updateStatus(repair.id, "受付")}
                className="rounded bg-yellow-500 px-3 py-1 text-white"
  >        
               受付
              </button>
                  
              <button
                disabled={isSaving || !canUpdate}
                onClick={() => updateStatus(repair.id, "手配中")}
              className="rounded bg-blue-500 px-3 py-1 text-white"
               >
               手配中
             </button>

             <button
               disabled={isSaving || !canUpdate}
                onClick={() => updateStatus(repair.id, "完了")}
              className="rounded bg-green-600 px-3 py-1 text-white"
              >
              完了
            </button>
            </div>
            </div>
          ))}
          
        </div>

        
      </div>

      {selectedPhotoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="修理写真の拡大表示"
          onClick={() => setSelectedPhotoUrl(null)}
        >
          <div
            className="relative max-h-full max-w-4xl rounded-lg bg-white p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelectedPhotoUrl(null)}
              className="absolute right-5 top-5 rounded bg-gray-900 px-3 py-1 text-sm font-bold text-white"
            >
              閉じる
            </button>
            <RepairImage
              src={selectedPhotoUrl}
              onRetry={() => { if (selectedPhoto.current) void openPhoto(selectedPhoto.current.repairId, selectedPhoto.current.index); }}
              alt="修理写真の拡大表示"
              className="max-h-[80vh] max-w-full rounded object-contain"
            />
          </div>
        </div>
      )}
    </main>
     );
     }
