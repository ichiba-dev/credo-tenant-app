'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { issueVendorQuoteRequest, revokeVendorQuoteRequest } from './vendor-quote-request-actions';
import type { VendorQuoteRequestView } from './types';
export function quoteRequestLabel(request?: VendorQuoteRequestView, now = Date.now()) {
  if (!request) return '見積依頼未発行';
  if (request.status==='submitted') return '見積受領';
  if (request.status==='revoked') return '失効';
  return Date.parse(request.expires_at)<=now ? '期限切れ' : '見積依頼中';
}
export default function VendorQuoteRequestControls({repairId,dispatchId,request,canUpdate,unavailable}:{repairId:number;dispatchId:string;request?:VendorQuoteRequestView;canUpdate:boolean;unavailable?:boolean}) {
  const router=useRouter(); const lock=useRef(false); const operation=useRef<string|null>(null);
  const [busy,setBusy]=useState(false),[url,setUrl]=useState(''),[message,setMessage]=useState('');
  async function issue() {
    if(lock.current || !canUpdate || unavailable)return;
    lock.current=true;setBusy(true);setMessage('');setUrl('');
    try {
      operation.current??=crypto.randomUUID();
      const result=await issueVendorQuoteRequest({repairId,dispatchId,requestId:operation.current});
      if(!result.ok){setMessage('発行に失敗しました。同じ操作で再試行してください。');return;}
      operation.current=null;
      if(result.url){setUrl(new URL(result.url,window.location.origin).href);setMessage('URLは今回のみ表示します。コピーして業者へ手動で共有してください。');}
      else setMessage('発行済みですがURLは再表示できません。必要なら再発行してください。');
      router.refresh();
    } catch {setMessage('通信に失敗しました。再試行してください。');}
    finally {lock.current=false;setBusy(false);}
  }
  async function revoke(){
    if(!request || lock.current || !canUpdate)return;
    lock.current=true;setBusy(true);
    try {const r=await revokeVendorQuoteRequest({dispatchId,requestId:request.id});if(r.ok){setUrl('');setMessage('リンクを失効しました。');router.refresh();}else setMessage('失効できませんでした。');}
    catch {setMessage('失効できませんでした。');}finally{lock.current=false;setBusy(false);}
  }
  return <section className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
    <p className="font-bold">{unavailable?'見積依頼情報を取得できませんでした':quoteRequestLabel(request)}</p>
    {request&&<p className="mt-1 text-xs">期限：{new Date(request.expires_at).toLocaleString('ja-JP')}</p>}
    {canUpdate&&!unavailable&&<div className="mt-2 flex gap-2"><button disabled={busy} onClick={()=>void issue()} className="rounded bg-[#0b2e59] px-3 py-2 text-white disabled:opacity-50">{request?'見積依頼リンクを再発行':'見積依頼リンクを発行'}</button>
      {request?.status==='pending'&&<button disabled={busy} onClick={()=>void revoke()} className="rounded border px-3 py-2">失効</button>}</div>}
    {url&&<div className="mt-3"><input readOnly value={url} aria-label="今回発行した見積提出URL" className="w-full rounded border p-2"/><button onClick={async()=>{try{await navigator.clipboard.writeText(url);setMessage('コピーしました。業者へ手動で共有してください。');}catch{setMessage('URLを選択してコピーしてください。');}}} className="mt-2 underline">URLをコピー</button></div>}
    {message&&<p role="status" className="mt-2">{message}</p>}
  </section>;
}
