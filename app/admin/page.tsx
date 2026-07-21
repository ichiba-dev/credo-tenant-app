"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function AdminPage() {
  const [repairs, setRepairs] = useState<any[]>([]);
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
  
  const { data, error } = await supabase
  .from("repair_requests")
  .update({ status })
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