
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MAX_PHOTO_BYTES, MAX_TOTAL_PHOTO_BYTES, PHOTO_TYPES } from "./upload-limits";

type Property = {
  id: string;
  name: string;
};

export default function RepairPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertiesError, setPropertiesError] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);
  const [submissionBlocked, setSubmissionBlocked] = useState(false);
  const [tenantSubmissionComplete, setTenantSubmissionComplete] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const loadProperties = async () => {
      try {
        const response = await fetch("/repair/properties", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Property lookup failed");
        const data: Property[] = await response.json();
        if (!controller.signal.aborted) setProperties(data);
      } catch {
        if (!controller.signal.aborted) setPropertiesError(true);
      }
    };

    loadProperties();
    return () => controller.abort();
  }, []);

  const saveRepair = async () => {
    if (submitting.current || submissionBlocked) return;

    if (!propertyId) {
      alert("物件名を選択してください。");
      return;
    }

    if (!roomNumber) {
      alert("号室を入力してください。");
      return;
    }

    if (!tenantName) {
      alert("お名前を入力してください。");
      return;
    }

    if (!category || category === "選択してください") {
      alert("不具合箇所を選択してください。");
      return;
    }

    if (!description) {
      alert("症状・状況を入力してください。");
      return;
    }

    if (photos.length > 20) {
      alert("写真は20枚まで選択できます。");
      return;
    }
    if (photos.some((photo) => !PHOTO_TYPES.includes(photo.type) || photo.size === 0 || photo.size > MAX_PHOTO_BYTES) ||
        photos.reduce((total, photo) => total + photo.size, 0) > MAX_TOTAL_PHOTO_BYTES) {
      alert("写真はJPEG・PNG、1枚5MiB以下、合計20MiB以下で選択してください。");
      return;
    }
    submitting.current = true;
    setIsSubmitting(true);

    try {
      const form = new FormData();
      for (const [key, value] of Object.entries({ propertyId, roomNumber, tenantName, category, description })) {
        form.append(key, value);
      }
      for (const photo of photos) form.append("photos", photo);
      const response = await fetch("/repair/submit", { method: "POST", body: form });
      const result = await response.json();
      if (!result || typeof result.ok !== "boolean" || (!response.ok && result.ok) ||
          (!result.ok && (typeof result.message !== "string" || typeof result.retrySafe !== "boolean"))) {
        throw new Error("Unexpected response");
      }
      if (!result.ok) {
        if (!result.retrySafe) setSubmissionBlocked(true);
        alert(result.message);
        return;
      }

      if (result.tenantLinked === true) {
        setTenantSubmissionComplete(true);
      } else {
        alert("修理・不具合の報告を送信しました！");
      }

      // 入力をリセット
      setPropertyId("");
      setRoomNumber("");
      setTenantName("");
      setCategory("");
      setDescription("");
      setPhotos([]);

    } catch {
      setSubmissionBlocked(true);
      alert("送信完了を確認できませんでした。登録済みの可能性があるため、再送前に管理会社へお問い合わせください。");
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  if (tenantSubmissionComplete) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-100 px-5 py-10">
        <section role="status" className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-7 text-center shadow-sm">
          <p className="notranslate text-lg font-bold tracking-[0.24em] text-[#0b2e59]" translate="no">CREDO</p>
          <h1 className="mt-6 text-2xl font-bold text-gray-900">修理依頼を受け付けました</h1>
          <p className="mt-3 text-sm leading-6 text-gray-600">マイページで進捗を確認できます。</p>
          <Link href="/tenant" className="mt-7 block w-full rounded-xl bg-[#0b2e59] px-5 py-4 font-bold text-white shadow-sm">
            マイページを開く
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto min-h-screen max-w-md bg-white">

        <header className="border-b border-gray-200 px-5 py-5">
          <Link
            href="/"
            className="text-sm font-medium text-blue-700"
          >
            ← 戻る
          </Link>

          <h1 className="mt-4 text-2xl font-bold text-gray-900">
            修理・不具合のご報告
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            お部屋や設備の不具合についてご入力ください。
          </p>
        </header>

        <section className="space-y-6 px-5 py-6">

          {/* 物件 */}
          <div>
            <label className="mb-2 block font-bold text-gray-900">
              お住まいの物件
            </label>

            <select
              className="w-full rounded-xl border border-gray-300 bg-white p-4 text-gray-700"
              value={propertyId}
              onChange={(e) => {
                setPropertyId(e.target.value);
              }}
            >
              <option value="">
                物件名を選択してください
              </option>

              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
            {propertiesError && (
              <p role="alert" className="mt-2 text-sm text-red-600">
                物件一覧を取得できませんでした。時間をおいて画面を再読み込みしてください。
              </p>
            )}
          </div>

          {/* 号室 */}
          <div>
            <label className="mb-2 block font-bold text-gray-900">
              号室
            </label>

            <input
              type="text"
              placeholder="例：201"
              className="w-full rounded-xl border border-gray-300 p-4 text-gray-900"
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
            />
          </div>

          {/* 名前 */}
          <div>
            <label className="mb-2 block font-bold text-gray-900">
              お名前
            </label>

            <input
              type="text"
              placeholder="例：山田 太郎"
              className="w-full rounded-xl border border-gray-300 p-4 text-gray-900"
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
            />
          </div>

          {/* 不具合箇所 */}
          <div>
            <label className="mb-2 block font-bold text-gray-900">
              不具合箇所
            </label>

            <select
              className="w-full rounded-xl border border-gray-300 bg-white p-4 text-gray-700"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">
                選択してください
              </option>

              <option value="エアコン">エアコン</option>
              <option value="給湯器">給湯器</option>
              <option value="キッチン">キッチン</option>
              <option value="浴室">浴室</option>
              <option value="トイレ">トイレ</option>
              <option value="洗面所">洗面所</option>
              <option value="玄関・鍵">玄関・鍵</option>
              <option value="共用部">共用部</option>
              <option value="その他">その他</option>
            </select>
          </div>

          {/* 症状 */}
          <div>
            <label className="mb-2 block font-bold text-gray-900">
              症状・状況
            </label>

            <textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例：エアコンから異臭がします。昨日から症状が出ています。"
              className="w-full resize-none rounded-xl border border-gray-300 p-4 text-gray-900"
            />
          </div>

          {/* 写真 */}
          <div>
            <label className="mb-2 block font-bold text-gray-900">
              写真
            </label>

            <p className="mb-3 text-sm text-gray-500">
              不具合箇所の写真を添付してください。
              最大20枚、JPEG・PNG、1枚5MiB・合計20MiBまで選択できます。
            </p>

            <input
              type="file"
              accept="image/jpeg,image/png"
              multiple
              onChange={(e) => {
                if (e.target.files) {
                  const files = Array.from(e.target.files);

                  if (files.length > 20) {
                    alert("写真は20枚まで選択できます。");
                    return;
                  }

                  setPhotos(files);
                }
              }}
              className="w-full rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-600"
            />

            {photos.length > 0 && (
              <p className="mt-2 text-sm text-blue-700">
                {photos.length}枚の写真を選択中
              </p>
            )}
          </div>

          {/* 送信ボタン */}
          {submissionBlocked && (
            <p role="alert" className="text-sm text-red-600">
              登録状況の確認が必要です。再送せず管理会社へお問い合わせください。
            </p>
          )}
          <button
            type="button"
            onClick={saveRepair}
            disabled={isSubmitting || submissionBlocked}
            className="w-full rounded-xl bg-blue-700 px-5 py-4 font-bold text-white disabled:opacity-50"
          >
            {isSubmitting
              ? "送信中..."
              : "報告内容を送信する"}
          </button>

          <p className="pb-6 text-center text-xs text-gray-400">
            株式会社クレド 管理部
          </p>

        </section>
      </div>
    </main>
  );
}
