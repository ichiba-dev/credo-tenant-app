'use client';
import { useEffect, useRef, useState } from 'react';
import { VendorSubmissionUploadForm } from '@/app/admin/vendor-quote-upload-form';
type Context = { companyName: string; propertyName: string; roomNumber: string | null; locationType: string; category: string; instructions: string; expiresAt: string };
export default function VendorQuoteSubmission() {
  const initialization = useRef<Promise<{ token: string; context: Context }> | null>(null);
  const [data, setData] = useState<{ token: string; context: Context } | null>(null);
  const [status, setStatus] = useState('checking');
  useEffect(() => {
    initialization.current ??= (async () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
      window.history.replaceState(window.history.state, '', window.location.pathname);
      if (!token) throw Error('invalid');
      const response = await fetch('/api/vendor/quotes/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), cache: 'no-store' });
      if (!response.ok) throw Error('invalid');
      return { token, context: await response.json() as Context };
    })();
    let active = true;
    initialization.current.then(result => { if (active) { setData(result); setStatus('ready'); } }).catch(() => { if (active) setStatus('invalid'); });
    return () => { active = false; };
  }, []);
  if (status === 'checking') return <p className="mt-4">リンクを確認しています…</p>;
  if (status === 'invalid') return <p role="alert" className="mt-4">リンクが無効・期限切れ・失効・提出済みです。管理会社へ新しいリンクを依頼してください。</p>;
  if (status === 'submitted') return <p role="status" className="mt-4">見積を提出しました。管理会社が確認します。</p>;
  if (!data) return null;
  const c = data.context;
  return <><dl className="mt-5 space-y-2 rounded-lg bg-white p-4">
    <div><dt>管理会社</dt><dd>{c.companyName}</dd></div>
    <div><dt>物件・場所</dt><dd>{c.propertyName} {c.locationType === 'common_area' ? '共用部' : `${c.roomNumber ?? ''}号室`}</dd></div>
    <div><dt>修理カテゴリ</dt><dd>{c.category}</dd></div>
    <div><dt>手配内容</dt><dd className="whitespace-pre-wrap">{c.instructions}</dd></div>
    <div><dt>提出期限</dt><dd>{new Date(c.expiresAt).toLocaleString('ja-JP')}</dd></div>
  </dl><VendorSubmissionUploadForm token={data.token} onSuccess={()=>{ setData(null); setStatus('submitted'); }} /></>;
}
