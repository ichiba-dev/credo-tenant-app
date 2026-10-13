"use client";

import { createClient } from "@supabase/supabase-js";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VendorDispatchHistory } from "./types";
import { parseQuoteLines, quoteTotal } from '@/lib/vendor-quote-input';

const MAX_BYTES = 15 * 1024 * 1024;
type Line = { description:string; quantity:string; unit:string; unitPrice:string; taxRate:string };
type Prepared = { path:string; uploadToken:string|null; ticket:string; expiresAt:string; uploaded:boolean };
const blankLine = (): Line => ({description:"",quantity:"1",unit:"式",unitPrice:"",taxRate:"0.1"});
const localDateTime = () => {
  const now = new Date();
  return new Date(now.getTime()-now.getTimezoneOffset()*60_000).toISOString().slice(0,16);
};

type QuoteDispatch = Pick<VendorDispatchHistory, "id" | "vendorName" | "status" | "selectedAt">;

export function VendorQuoteUploadForm({ repairId, dispatches }: { repairId: number; dispatches: QuoteDispatch[] }) {
  const [selectedId, setSelectedId] = useState("");
  const eligible = [...new Map(dispatches.filter((dispatch) => !["candidate", "cancelled"].includes(dispatch.status))
    .map((dispatch) => [dispatch.id, dispatch])).values()];
  const selected = eligible.find((dispatch) => dispatch.id === selectedId) ?? eligible[0];
  if (!selected) return null;
  return <section className="mt-4">
    <label className="block text-sm font-bold text-slate-700">見積の登録先（手配済み業者）
      <select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}
        className="mt-2 block w-full rounded border bg-white p-2">
        {eligible.map((dispatch) => <option key={dispatch.id} value={dispatch.id}>
          {dispatch.vendorName} ・ 手配候補登録 {new Date(dispatch.selectedAt).toLocaleString("ja-JP")}
        </option>)}
      </select>
    </label>
    <SingleVendorQuoteUploadForm key={selected.id} repairId={repairId} dispatchId={selected.id} vendorName={selected.vendorName} />
  </section>;
}

export function VendorSubmissionUploadForm({ token, onSuccess }: { token: string; onSuccess: () => void }) {
  return <SingleVendorQuoteUploadForm repairId={0} dispatchId="" vendorName="" token={token} onSuccess={onSuccess} />;
}

function SingleVendorQuoteUploadForm({ repairId, dispatchId, vendorName, token, onSuccess }: {repairId:number;dispatchId:string;vendorName:string;token?:string;onSuccess?:()=>void}) {
  const router = useRouter();
  const [file,setFile] = useState<File|null>(null);
  const [lines,setLines] = useState<Line[]>([blankLine()]);
  const [validUntil,setValidUntil] = useState("");
  const [receivedAt,setReceivedAt] = useState(localDateTime);
  const [quoteNumber,setQuoteNumber] = useState("");
  const [notes,setNotes] = useState("");
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState("");
  const [operation,setOperation] = useState<{
    prepared:Prepared; requestId:string; sha256:string; size:number; uploaded:boolean;
  }|null>(null);
  const pendingRequestId = useRef<string|null>(null);
  const base = token ? '/api/vendor/quotes' : `/api/admin/repairs/${repairId}/vendor-dispatches/${encodeURIComponent(dispatchId)}/quote-upload`;
  function changeFile(next:File|null) { setFile(next);setOperation(null);pendingRequestId.current=null;setNotice(""); }
  async function submit() {
    if (!file || busy) return;
    if (file.size < 1 || file.size > MAX_BYTES || file.type !== "application/pdf" || !/\.pdf$/i.test(file.name)) {
      setNotice("PDFは15 MiB以下で選択してください。");return;
    }
    const quoteLines = lines.map((line) => {
      const quantity = Number(line.quantity);
      const price = Number(line.unitPrice);
      return {description:line.description.trim(),quantity,unit:line.unit.trim(),
        unit_price_ex_tax:price,line_amount_ex_tax:Math.round(quantity*price),tax_rate:Number(line.taxRate)};
    });
    if (!parseQuoteLines(quoteLines)) {
      setNotice("見積明細を入力してください。");return;
    }
    setBusy(true);setNotice("");
    try {
      let current = operation;
      if (!current) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0,5)) !== "%PDF-")
          throw new Error("PDFの内容を確認してください。");
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
        const sha256 = Array.from(digest,(byte) => byte.toString(16).padStart(2,"0")).join("");
        const requestId = pendingRequestId.current ?? crypto.randomUUID();
        pendingRequestId.current = requestId;
        const response = await fetch(`${base}/prepare`,{method:"POST",credentials:"same-origin",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({token,filename:file.name,size:file.size,mime:file.type,sha256,requestId,
            receivedAt:new Date(receivedAt).toISOString()})});
        if (!response.ok) throw new Error("upload準備に失敗しました。");
        const prepared = await response.json() as Prepared;
        current = { prepared,requestId,sha256,size:file.size,uploaded:prepared.uploaded };
        setOperation(current);
      }
      if (!current.uploaded) {
        if (!current.prepared.uploadToken) throw new Error("Upload token unavailable");
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !anon) throw new Error("Storage設定を確認してください。");
        const storage = createClient(url,anon,{auth:{persistSession:false}}).storage.from("vendor-quotes");
        const { error } = await storage.uploadToSignedUrl(current.prepared.path,
          current.prepared.uploadToken,file,{contentType:"application/pdf",upsert:false,
            metadata:{sha256:current.sha256}});
        if (error) throw new Error("PDFのuploadに失敗しました。同じファイルで再試行してください。");
        current = {...current,uploaded:true};setOperation(current);
      }
      const response = await fetch(`${base}/finalize`,{method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({
          token,notes,ticket:current.prepared.ticket,path:current.prepared.path,sha256:current.sha256,
          size:current.size,mime:"application/pdf",lines:quoteLines,
          taxRounding:"floor",validUntil:validUntil || null,vendorQuoteNumber:quoteNumber || null,
        })});
      if (!response.ok) throw new Error("見積の確定に失敗しました。同じ内容で再試行してください。");
      setNotice("業者見積を保存しました。");setOperation(null);pendingRequestId.current=null;setFile(null);
      if (onSuccess) onSuccess(); else router.refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "処理に失敗しました。"); }
    finally { setBusy(false); }
  }
  return <section className="@container mt-4 rounded-lg border border-gray-200 bg-white p-4">
    <h4 className="font-bold">業者見積PDF・下代明細</h4>
    <p className="mt-2 text-sm text-slate-600">{token ? 'PDFと工事項目を入力してください。提出後の変更は管理会社へ再発行を依頼してください。' : `${vendorName}から受領した見積を管理会社が代理登録します。`}</p>
    <input className="mt-3 block w-full text-sm" type="file" accept="application/pdf,.pdf"
      disabled={busy || Boolean(operation?.uploaded)} onChange={(event) => changeFile(event.target.files?.[0] ?? null)} />
    {lines.map((line,index) => <div key={index} className="mt-3 grid gap-2 @xl:grid-cols-5">
      <input aria-label={`明細${index+1} 内容`} placeholder="工事項目" value={line.description}
        onChange={(e) => setLines((all) => all.map((item,i) => i===index?{...item,description:e.target.value}:item))} />
      <input aria-label={`明細${index+1} 数量`} type="number" min="0.001" step="0.001" value={line.quantity}
        onChange={(e) => setLines((all) => all.map((item,i) => i===index?{...item,quantity:e.target.value}:item))} />
      <input aria-label={`明細${index+1} 単位`} value={line.unit}
        onChange={(e) => setLines((all) => all.map((item,i) => i===index?{...item,unit:e.target.value}:item))} />
      <input aria-label={`明細${index+1} 税別単価`} type="number" min="0" step="0.0001" placeholder="税別単価"
        value={line.unitPrice} onChange={(e) => setLines((all) => all.map((item,i) => i===index?{...item,unitPrice:e.target.value}:item))} />
      <select aria-label={`明細${index+1} 税率`} value={line.taxRate}
        onChange={(e) => setLines((all) => all.map((item,i) => i===index?{...item,taxRate:e.target.value}:item))}>
        <option value="0.1">10%</option><option value="0.08">8%</option><option value="0">非課税</option>
      </select>
    </div>)}
    <button type="button" className="mt-2 text-sm underline" disabled={busy || lines.length>=100}
      onClick={() => setLines((all) => [...all,blankLine()])}>明細を追加</button>
    <div className="mt-3 flex flex-wrap gap-3 text-sm">
      {!token && <label>見積受領日時 <input type="datetime-local" required value={receivedAt}
        disabled={busy || Boolean(operation)} onChange={(e)=>setReceivedAt(e.target.value)} /></label>}
      <label>見積番号 <input value={quoteNumber} maxLength={100} onChange={(e)=>setQuoteNumber(e.target.value)} /></label>
      <label>有効期限 <input type="date" value={validUntil} onChange={(e)=>setValidUntil(e.target.value)} /></label>
    </div>
    <p className="mt-3 text-sm font-bold">見積金額（税込・税率ごとに切捨て）：{(() => {
      const parsed = parseQuoteLines(lines.map(line => ({ description:line.description,quantity:Number(line.quantity),unit:line.unit,
        unit_price_ex_tax:Number(line.unitPrice),line_amount_ex_tax:Math.round(Number(line.quantity)*Number(line.unitPrice)),tax_rate:Number(line.taxRate) })));
      return parsed ? `¥${new Intl.NumberFormat('ja-JP').format(quoteTotal(parsed)! )}` : '明細入力後に計算';
    })()}</p>
    {token && <label className="mt-3 block text-sm">備考（任意）<textarea value={notes} maxLength={2000} disabled={busy} onChange={event=>setNotes(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label>}
    {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
    <button type="button" disabled={busy || !file} onClick={()=>void submit()}
      className="mt-3 rounded bg-[#0b2e59] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
      {busy?"確認中…":operation?.uploaded?"見積確定を再試行":token?"見積を提出":"PDFをuploadして見積登録"}
    </button>
    {operation && <button type="button" disabled={busy}
      onClick={()=>{setOperation(null);pendingRequestId.current=null;setNotice("");}}
      className="ml-3 text-sm underline disabled:opacity-50">最初からやり直す</button>}
  </section>;
}
