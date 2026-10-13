'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VendorQuoteView } from './types';
import { createOwnerReport } from './owner-report-actions';
import { publishVendorQuoteToOwner } from './vendor-quote-owner-actions';
export default function VendorQuoteOwnerTransfer({repairId,quotes,hasReport,summary}:{repairId:number;quotes:VendorQuoteView[];hasReport:boolean;summary:string}) {
  const router=useRouter(),lock=useRef(false);
  const [quoteId,setQuoteId]=useState(''),[amount,setAmount]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  if(!quotes.length)return null;
  async function submit(){
    if(lock.current||!quoteId||!confirmed||!amount.trim()||!Number.isSafeInteger(Number(amount))||Number(amount)<0)return;
    lock.current=true;setBusy(true);setMessage('');
    try {
      if(!hasReport){const created=await createOwnerReport({repairId,summary});if(!created.ok){setMessage(created.message);return;}}
      const result=await publishVendorQuoteToOwner({repairId,quoteId,ownerAmount:Number(amount),confirmPdf:confirmed});setMessage(result.message);router.refresh();
    }catch{setMessage('登録に失敗しました。報告の作成・PDFの登録状況を確認して再試行してください。');}
    finally{lock.current=false;setBusy(false);}
  }
  return <section className="mt-4 rounded-lg border border-amber-300 bg-white p-4 text-sm"><h3 className="font-bold">保存済み見積をオーナー報告へ利用</h3>
    <p className="mt-2 text-amber-900">業者の下代・原価を含む可能性があります。PDFを開いて確認し、オーナーへ公開する資料として選択してください。明細は自動転用しません。</p>
    <select aria-label="転用する業者見積" value={quoteId} disabled={busy} onChange={e=>{setQuoteId(e.target.value);setConfirmed(false);setAmount('');}} className="mt-3 w-full rounded border p-2"><option value="">見積を選択</option>{quotes.map(q=><option key={q.id} value={q.id}>{q.vendorName} ・ {q.vendor_quote_number??'番号なし'} ・ revision {q.revision_no}</option>)}</select>
    {quotes.find(q=>q.id===quoteId)?.files.map(f=><a key={f.id} href={`/api/admin/repairs/${repairId}/vendor-quotes/${quoteId}/files/${f.id}/open`} target="_blank" rel="noopener noreferrer" className="mt-2 block text-blue-700 underline">公開前にPDFを確認：{f.original_filename}</a>)}
    <label className="mt-3 block">オーナー向け公開金額（税込・円）<input type="number" min="0" step="1" value={amount} disabled={busy} onChange={e=>setAmount(e.target.value)} className="ml-2 rounded border p-2"/></label>
    <label className="mt-3 flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>選択したPDFの内容と公開金額を確認し、このPDFをオーナーへ公開することを承認します。</span></label>
    <button disabled={busy||!quoteId||!confirmed||!amount.trim()||(!hasReport&&!summary.trim())} onClick={()=>void submit()} className="mt-3 rounded bg-[#0b2e59] px-4 py-2 text-white disabled:opacity-50">{busy?'登録中…':hasReport?'選択したPDF・公開金額を報告へ登録':'報告を作成し、選択したPDF・公開金額を登録'}</button>
    {message&&<p role="status" className="mt-2">{message}</p>}
  </section>;
}
