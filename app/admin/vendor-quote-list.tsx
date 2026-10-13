'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { VendorQuoteView } from './types';
export default function VendorQuoteList({repairId,quotes,unavailable}:{repairId:number;quotes:VendorQuoteView[];unavailable?:boolean}) {
  const router=useRouter();
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')router.refresh();},30000);return()=>clearInterval(timer);},[router]);
  return <section className="mt-4 rounded-lg border bg-white p-4"><h3 className="font-bold text-[#0b2e59]">保存済み業者見積（管理会社向け）</h3>
    <p className="mt-1 text-xs text-slate-500">下代・原価です。オーナーへは自動公開されません。30秒ごとに表示を更新します。</p>
    {unavailable?<p role="alert" className="mt-3">見積を取得できませんでした。再読み込みしてください。</p>:quotes.length===0?<p className="mt-3 text-sm">保存済み見積はありません。</p>:quotes.map(q=><article key={q.id} className="mt-4 rounded border p-3 text-sm">
      <h4 className="font-bold">{q.vendorName} ・ revision {q.revision_no}</h4>
      <p>{q.submissionPath==='vendor'?'業者提出':'管理会社代理登録'} ・ 受領 {new Date(q.received_at).toLocaleString('ja-JP')}</p>
      <p>見積番号：{q.vendor_quote_number??'なし'} ・ 有効期限：{q.valid_until??'未指定'}</p>
      <p className="mt-2 font-bold">税込 ¥{q.amount_inc_tax.toLocaleString('ja-JP')}（税別 ¥{q.amount_ex_tax.toLocaleString('ja-JP')} / 消費税 ¥{q.tax_amount.toLocaleString('ja-JP')}）</p>
      {q.files.map(f=><a key={f.id} className="mt-2 block text-blue-700 underline" href={`/api/admin/repairs/${repairId}/vendor-quotes/${q.id}/files/${f.id}/open`} target="_blank" rel="noopener noreferrer">{f.original_filename}</a>)}
      <ul className="mt-2 space-y-1">{q.lines.map(l=><li key={l.id}>{l.description} ・ {l.quantity}{l.unit} × ¥{l.unit_price_ex_tax.toLocaleString('ja-JP')} ・ 税率{l.tax_rate*100}% ・ 税別 ¥{l.line_amount_ex_tax.toLocaleString('ja-JP')}</li>)}</ul>
      {q.notes&&<p className="mt-2 whitespace-pre-wrap">備考：{q.notes}</p>}
    </article>)}
  </section>;
}
