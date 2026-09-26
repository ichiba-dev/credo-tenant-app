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
import { VendorQuoteUploadForm } from "./vendor-quote-upload-form";
import Link from "next/link";
import RepairList from "./repair-list";
import RepairDetailTabs from "./repair-detail-tabs";
import RepairOverview from "./repair-overview";
import MessageAttachment from "./message-attachment";
import { repairListState } from "./repair-list-state";
import RepairCalendarSection from "./repair-calendar-section";
import { VendorDispatchSection } from "./vendor-dispatch-section";
import styles from "./admin-workspace.module.css";

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

export default function AdminRepairs({ repairs, canUpdate, children, calendarOverview, calendarWeek, replyScope }: { repairs: AdminRepair[]; canUpdate: boolean; children?: ReactNode; calendarOverview?: ReactNode; calendarWeek?: ReactNode; replyScope?: string }) {
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
    <main className={`${styles.workspace} min-h-screen bg-gray-100 p-3 sm:p-6 xl:h-dvh xl:overflow-hidden`}>
      <div data-workspace-container className="mx-auto max-w-[1800px] xl:flex xl:h-full xl:min-h-0 xl:flex-col">
        <header data-admin-header className="contents">
          <div className="hidden items-center gap-4 text-[#0b2e59] xl:flex">
            <span className="text-lg font-bold tracking-wide">CREDO <span className="text-sm font-medium">管理画面</span></span>
            <span aria-hidden="true" className="text-slate-300">/</span>
            <span className="text-sm font-semibold">修理管理</span>
          </div>
        <nav className="mb-5 flex flex-wrap justify-end gap-2">
          <Link href="/admin/calendar" className="rounded-lg bg-blue-950 px-4 py-2 font-bold text-white shadow hover:bg-blue-900">カレンダー</Link>
          <Link href="/admin/vendors" className="rounded-lg bg-blue-950 px-4 py-2 font-bold text-white shadow hover:bg-blue-900">業者マスタ</Link>
        </nav>
        </header>
        <RepairList repairs={repairs} calendarOverview={calendarOverview} calendarWeek={calendarWeek} listHeader={<>
        {children}

        <h1 className="text-3xl font-bold xl:sr-only">
          修理依頼一覧
        </h1>

        <p className="mt-2 text-gray-500 xl:hidden">
          入居者から送信された修理依頼です。
        </p>

        <p role="status" className="mt-3 text-sm">{isSaving ? "保存中…" : message}</p>
        {!canUpdate && <p className="mt-3 text-sm">閲覧専用です。ステータス・コメントは更新できません。</p>}
        </>} renderDetail={(repair, desktop = false, active = true) => (
          <RepairDetailTabs repairId={repair.id} desktop={desktop} active={active} sections={{
            overview: <>
             <p className="font-bold">
               {repair.property_name} {repair.room_number}号室
             </p>

              <p>入居者：{repair.tenant_name}</p>

              <p> 不具合：{repair.category}</p>
              {repair.photos_unavailable && <p role="alert" className="mt-2 text-sm text-red-600">一部の写真を取得できませんでした。再読み込みしても表示されない場合は管理者へお問い合わせください。</p>}

              <p className="text-gray-500">
                {repair.description}
              </p>
              <p className="mt-2 text-sm text-gray-400">
                受付日：
                {new Date(repair.created_at).toLocaleDateString("ja-JP")}
              </p>

              <p className="mt-2 font-bold">
               ステータス：{repair.status}
               </p>
              <p className={desktop?"hidden":"mt-2 text-sm text-slate-600"}>次にやること：{repairListState(repair).reasons.join(' / ')||'追加の要対応なし'}</p>
              <p className="text-xs text-slate-500">最終更新（確認可能分）：{repairListState(repair).updatedAt > 0 ? new Date(repairListState(repair).updatedAt).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo'}) : '日時不明'}</p>
              {desktop && <RepairOverview repair={repair} active={active}/>}
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
            </>,
            line: <MessageSection repairId={repair.id} messages={repair.tenant_messages ?? []} canUpdate={canUpdate} lineUnavailable={repair.line_messages_unavailable} attachmentsUnavailable={repair.line_attachments_unavailable} replyScope={replyScope} />,
            files: <>
              {(() => {
                const photos = getDisplayPhotos(repair);

                return photos.length > 0 ? (
                  <section className="mt-4">
                    <p className="mb-2 text-sm font-bold text-gray-700">写真</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
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
              <RepairPdfButton repairId={repair.id}/>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{repair.tenant_messages?.filter(item => item.attachment).map(item =>
                <div key={item.id} className={`min-w-0 rounded border p-2 ${item.attachment?.outbound?'bg-[#0b2e59] text-white':'bg-slate-50'}`}>
                  <MessageAttachment repairId={repair.id} attachment={item.attachment!}/>
                </div>)}</div>
            </>,
            vendors: <VendorDispatchSection repairId={repair.id} candidates={repair.vendor_candidates ?? []}
                dispatches={repair.vendor_dispatches ?? []} canUpdate={canUpdate}
                unavailable={repair.vendor_dispatch_unavailable}
                suggestedInstructions="現地確認と修理見積をお願いします。"
                propertyName={repair.property_name} roomNumber={repair.room_number}
                repairCategory={repair.category} repairDescription={repair.description}
                repairPhotos={repair.repair_photos ?? []} fallbackPhotoUrl={repair.photo_url}
                tenantMessages={repair.tenant_messages ?? []}
                managementCompanyName="株式会社CREDO" />,
            estimates: <>
              {canUpdate && repair.vendor_dispatches?.filter((dispatch) =>
                !["candidate","cancelled"].includes(dispatch.status)).map((dispatch) =>
                <VendorQuoteUploadForm key={dispatch.id} repairId={repair.id} dispatchId={dispatch.id} />)}
              {desktop && !canUpdate && <p className="text-sm text-slate-500">閲覧専用です。業者見積の登録はできません。</p>}
              {desktop && canUpdate && !repair.vendor_dispatches?.some(dispatch=>!["candidate","cancelled"].includes(dispatch.status)) && <p className="text-sm text-slate-500">手配済みの業者がある場合に見積を登録できます。</p>}
              {desktop && repair.owner_report_estimates && <EstimateSection repairId={repair.id} estimates={repair.owner_report_estimates} canUpdate={false} initialSummary={repair.description}/>}
            </>,
            schedule: <RepairCalendarSection repair={repair} view={desktop?"events":"all"} enabled={active}/>,
            history: desktop?<RepairCalendarSection repair={repair} view="history" enabled={active}/>:null,
            owner: <EstimateSection repairId={repair.id} estimates={repair.owner_report_estimates} canUpdate={canUpdate} initialSummary={repair.description} />,
          }}/>
          )} />

        
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
