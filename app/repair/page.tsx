
"use client";
import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";


export default function RepairPage() {
const [propertyName, setPropertyName] = useState("");
const [roomNumber, setRoomNumber] = useState("");
const [tenantName, setTenantName] = useState("");
const [category, setCategory] = useState("");
const [description, setDescription] = useState("");
const [photos, setPhotos] = useState<File[]>([]);
const saveRepair = async () => {
  const photoUrls: string[] = [];

  if (photos.length > 0) {
  for (const photo of photos) {
    const fileName = `${Date.now()}-${photo.name}`;

    const { error: uploadError } = await supabase.storage
      .from("repair-images")
      .upload(fileName, photo);

    if (uploadError) {
      alert(uploadError.message);
      return;
    }
        const { data } = supabase.storage
      .from("repair-images")
      .getPublicUrl(fileName);

    photoUrls.push(data.publicUrl);
   

    }
  }

  const { error } = await supabase
    .from("repair_requests")
    .insert([
      {
        property_name: propertyName,
        room_number: roomNumber,
        tenant_name: tenantName,
        category: category,
        description: description,
        photo_url: photoUrls[0] ?? "",
        status: "受付",
      },
    ]);

  if (error) {
    alert(error.message);
    console.error(error);
  } else {
    alert("送信しました！");
  }
};
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
          <div>
            <label className="mb-2 block font-bold text-gray-900">
              お住まいの物件
            </label>

            <select
              className="w-full rounded-xl border border-gray-300 bg-white p-4 text-gray-700"
              value={propertyName}
              onChange={(e) => setPropertyName(e.target.value)}
>
              <option>物件名を選択してください</option>
              <option>イリスアール</option>
              <option>アルコイリス</option>
              <option>カサ・ペルダーニョ</option>
            </select>
          </div>

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

          <div>
            <label className="mb-2 block font-bold text-gray-900">
              不具合箇所
            </label>

            <select
              className="w-full rounded-xl border border-gray-300 bg-white p-4 text-gray-700"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
>
              <option>選択してください</option>
              <option>エアコン</option>
              <option>給湯器</option>
              <option>キッチン</option>
              <option>浴室</option>
              <option>トイレ</option>
              <option>洗面所</option>
              <option>玄関・鍵</option>
              <option>共用部</option>
              <option>その他</option>
            </select>
          </div>

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

          <div>
            <label className="mb-2 block font-bold text-gray-900">
              写真
            </label>

            <p className="mb-3 text-sm text-gray-500">
              不具合箇所の写真を添付してください。
            </p>


           <input
              type="file"
              accept="image/*"
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
          </div>

          <button
            type="button"
            onClick={saveRepair}
            className="w-full rounded-xl bg-blue-700 px-5 py-4 font-bold text-white"
          >
            報告内容を送信する
          </button>

          <p className="pb-6 text-center text-xs text-gray-400">
            株式会社クレド 管理部
          </p>
        </section>
      </div>
    </main>
  );
}