"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function OutboundAttachmentForm({ repairId, scope }: { repairId:number;scope:string }) {
  const router=useRouter();
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [ready,setReady]=useState(false);
  const [notice,setNotice]=useState("");
  const requestId=useRef<string|null>(null);
  const operationKey=useRef<string|null>(null);
  const selection=useRef(0);
  async function selectFile(selected:File|null) {
    const current=++selection.current;
    setFile(null);setReady(false);requestId.current=null;operationKey.current=null;setNotice("");
    if(!selected)return;
    try{
      const digest=await crypto.subtle.digest("SHA-256",await selected.arrayBuffer());
      if(current!==selection.current)return;
      const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
      const key=`credo:outbound:${scope}:${repairId}:${hash}:${selected.type}:${selected.name}`;
      const previous=sessionStorage.getItem(key);
      const id=previous && /^[0-9a-f-]{36}$/i.test(previous)?previous:crypto.randomUUID();
      sessionStorage.setItem(key,id);operationKey.current=key;requestId.current=id;setFile(selected);setReady(true);
    }catch{setNotice("送信操作を安全に保存できません。ブラウザの保存設定を確認してください。");}
  }
  async function send() {
    if(!file || !requestId.current || busy)return;
    setBusy(true);setNotice("");
    try{
      const form=new FormData();form.set("file",file);form.set("requestId",requestId.current);
      const response=await fetch(`/api/admin/repairs/${repairId}/line-outbound`,{method:"POST",body:form,cache:"no-store"});
      const result=await response.json() as {status?:string;error?:string};
      if(!response.ok)throw new Error(result.error || "送信できませんでした");
      if(result.status==="accepted"){
        setNotice("LINEへ送信しました");setFile(null);setReady(false);
        if(operationKey.current)sessionStorage.removeItem(operationKey.current);
        requestId.current=null;operationKey.current=null;router.refresh();
      }else if(result.status==="failed" || result.status==="expired"){
        setNotice(`送信状態: ${result.status}。内容や接続設定を確認してから、必要ならファイルを選び直してください。`);
        if(operationKey.current)sessionStorage.removeItem(operationKey.current);
        setFile(null);setReady(false);requestId.current=null;operationKey.current=null;
      }else setNotice(`送信状態: ${result.status || "unknown"}。同じファイルで結果を再確認できます。`);
    }catch{setNotice("送信結果を確認できませんでした。同じファイルで再試行してください。");}
    finally{setBusy(false);}
  }
  return <div className="mt-4 border-t border-amber-200 pt-4">
    <label className="block text-sm font-bold text-gray-700" htmlFor={`outbound-file-${repairId}`}>画像またはPDFをLINEへ送信</label>
    <input id={`outbound-file-${repairId}`} type="file" accept="image/jpeg,image/png,application/pdf"
      className="mt-2 block w-full text-sm" disabled={busy}
      onChange={e=>{void selectFile(e.target.files?.[0]??null);}} />
    <p className="mt-1 text-xs text-gray-600">画像は10MiB、PDFは15MiBまで。画像は送信前に安全なサイズへ変換します。</p>
    {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
    <button type="button" onClick={send} disabled={!file || !ready || busy}
      className="mt-2 rounded-lg bg-[#0b2e59] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
      {busy?"送信中…":"LINEへ送信"}
    </button>
  </div>;
}
