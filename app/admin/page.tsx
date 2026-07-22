"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export default function AdminPage() {
  const [repairs, setRepairs] = useState<any[]>([]);
  const [comments, setComments] = useState<{ [key: number]: string }>({});
  useEffect(() => {
  loadRepairs();
}, []);

async function loadRepairs() {
  const { data, error } = await supabase
    .from("repair_requests")
    .select("*")
    .order("created_at", { ascending: false });

    console.log("data =", data);
    console.log("error =", error);

    
  if (error) {
    console.error(error);
    return;
  }

  setRepairs(data);
  
}
async function updateStatus(id: number, status: string) {
  console.log("クリック", id, status);

  const repair = repairs.find((r) => r.id === id);

  const newHistory =
    (repair?.history ?? "") +
     `${new Date().toLocaleString("ja-JP")}　${status}\n`;
  
  const { data, error } = await supabase
  .from("repair_requests")
  .update({
  status,
 history: newHistory,
})
  .eq("id", id)
  .select();

  console.log("update data =", data);
  console.log("update error =", error);  

  if (error) {
    alert(error.message);
    return;
  }

  loadRepairs();
}

async function saveComment(id: number) {
  const { error } = await supabase
    .from("repair_requests")
    .update({
      staff_comment: comments[id] ?? "",
    })
    .eq("id", id);

  if (error) {
    alert(error.message);
    return;
  }

  alert("コメントを保存しました");

  loadRepairs();
}
  async function createPdf(repair: any) {
  const doc = new jsPDF();
  


  const logoResponse = await fetch("/credo-logo.png");
  const logoBlob = await logoResponse.blob();

  const logoReader = new FileReader();

  await new Promise<void>((resolve) => {
    logoReader.onloadend = () => resolve();
    logoReader.readAsDataURL(logoBlob);
  });

  const logoData = logoReader.result as string;

  if (repair.photo_url) {
  const response = await fetch(repair.photo_url);
  const blob = await response.blob();

  const reader = new FileReader();

  await new Promise<void>((resolve) => {
    reader.onloadend = () => resolve();
    reader.readAsDataURL(blob);
  });

  const imageData = reader.result as string;

  doc.addImage(imageData, "JPEG", 115, 35, 80, 80);
}

  doc.setDrawColor(30, 64, 175);
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, 210, 18, "F");

  doc.addImage(logoData, "PNG", 8, 2, 12, 12);

  doc.setTextColor(255, 255, 255);
  doc.setTextColor(255, 255, 255);

  doc.setFontSize(16);
  doc.text("CREDO", 24, 8);

  doc.setFontSize(11);
  doc.text("Repair Report", 24, 13);

  doc.setTextColor(0, 0, 0);

  
  doc.setFontSize(12);
  doc.text(`Property : ${repair.property_name}`, 20, 40);
  doc.text(`Room : ${repair.room_number}`, 20, 50);
  doc.text(`Tenant : ${repair.tenant_name}`, 20, 60);
  doc.text(`Category : ${repair.category}`, 20, 70);
  doc.text(`Status : ${repair.status}`, 20, 80);

  autoTable(doc, {
    startY: 95,
   head: [["Item", "Details"]],
   body: [
    ["Description", repair.description],
    ["Comment", repair.staff_comment ?? ""],
    ["History", repair.history ?? ""],
     ],
   });

   doc.setFontSize(10);

   doc.text("CREDO Co.,Ltd.", 20, 270);
   doc.text("TEL : 06-6422-7776", 20, 276);
   doc.text("Staff : Masaya Ichiba", 20, 282);

  
  doc.save(`Repair_Report_${repair.property_name}_${repair.room_number}.pdf`);
  }
  return (
    <main className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-5xl">

        <h1 className="text-3xl font-bold">
          修理依頼一覧
        </h1>

        <p className="mt-2 text-gray-500">
          入居者から送信された修理依頼です。
        </p>

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

              <p className="text-gray-500">
                {repair.description}
              </p>
              {repair.photo_url && (
             <img
               src={repair.photo_url}
               alt="修理写真"
               className="mt-4 w-64 rounded-lg border"
               onError={() => console.log(repair.photo_url)}
              />
          )}

              <p className="mt-2 text-sm text-gray-400">
                受付日：
                {new Date(repair.created_at).toLocaleDateString("ja-JP")}
              </p>

              <p className="mt-2 font-bold">
               ステータス：{repair.status}
               </p>
               {repair.history && (
                <div className="mt-2 rounded bg-gray-100 p-3 text-sm">
                <p className="font-bold">📅 対応履歴</p>
                <pre className="whitespace-pre-wrap">
                  {repair.history}
                </pre>
                </div>
               )}

              <textarea
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
                  onClick={() => saveComment(repair.id)}
                  className="mt-2 rounded bg-gray-800 px-4 py-2 text-white"
                >
                  コメント保存
                </button>
                <button
                 onClick={() => createPdf(repair)}
                 className="ml-2 mt-2 rounded bg-red-600 px-4 py-2 text-white"
>
                  📄 PDF作成
               </button>

               <div className="mt-4 flex gap-2">
               <button
                onClick={() => updateStatus(repair.id, "受付")}
                className="rounded bg-yellow-500 px-3 py-1 text-white"
  >        
               受付
              </button>
                  
              <button
                onClick={() => updateStatus(repair.id, "手配中")}
              className="rounded bg-blue-500 px-3 py-1 text-white"
               >
               手配中
             </button>

             <button
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

    </main>
     );
     }