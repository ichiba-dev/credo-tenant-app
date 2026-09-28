'use client';
import { useRef, useState } from 'react';
import { MAX_PHOTOS, MAX_PHOTO_BYTES, MAX_TOTAL_PHOTO_BYTES, PHOTO_TYPES } from '@/app/repair/upload-limits';

export default function OwnerRepairForm({ properties }: { properties: { id: string; name: string }[] }) {
  const [location, setLocation] = useState('room');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [finished, setFinished] = useState(false);
  const locked = useRef(false);
  const inputStyle = 'mt-1 w-full rounded-lg border border-slate-300 p-3';
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const form = new FormData(event.currentTarget);
    const files = form.getAll('photos').filter((file): file is File => typeof file !== 'string' && file.size > 0);
    form.delete('photos');
    if (files.length > MAX_PHOTOS || files.some(file => !PHOTO_TYPES.includes(file.type) || file.size > MAX_PHOTO_BYTES) ||
      files.reduce((total,file) => total + file.size,0) > MAX_TOTAL_PHOTO_BYTES) {
      setMessage('写真はJPEG・PNG、最大20枚、1枚5MiB・合計20MiBまでです。'); return;
    }
    files.forEach(file => form.append('photos',file));
    if (location === 'common_area') form.set('roomNumber','');
    locked.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch('/owner/repairs/new/submit', { method: 'POST', body: form });
      const result = await response.json();
      if (result.ok) { setFinished(true); setMessage(`修理依頼を受け付けました（案件${result.repairId}）。`); }
      else { setMessage(result.message || '送信結果を確認できませんでした。再送前に管理会社へお問い合わせください。'); locked.current = result.retrySafe !== true; }
    } catch { setMessage('送信結果を確認できませんでした。再送前に管理会社へお問い合わせください。'); }
    finally { setBusy(false); }
  }
  if (finished) return <div className="mt-6"><p role="status">{message}</p><a className="mt-4 block underline" href="/owner">オーナー管理画面へ戻る</a></div>;
  return <form onSubmit={submit} className="mt-6 space-y-5">
    <fieldset disabled={busy || locked.current} className="space-y-5 disabled:opacity-60">
      <label className="block">物件<select name="propertyId" required className={inputStyle}>{properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
      <label className="block">場所<select name="locationType" value={location} onChange={event => setLocation(event.target.value)} className={inputStyle}><option value="room">部屋</option><option value="common_area">共用部</option></select></label>
      {location === 'room' && <label className="block">部屋番号<input name="roomNumber" required maxLength={100} className={inputStyle}/></label>}
      <label className="block">修理カテゴリ<select name="category" required className={inputStyle}>{['エアコン','給湯器','キッチン','浴室','トイレ','洗面所','玄関・鍵','共用部','その他'].map(category => <option key={category}>{category}</option>)}</select></label>
      <label className="block">内容<textarea name="description" required maxLength={10000} rows={5} className={inputStyle}/></label>
      <label className="block">写真（任意）<input name="photos" type="file" accept="image/jpeg,image/png" multiple className={inputStyle}/><span className="text-xs text-slate-500">JPEG・PNG、最大20枚、1枚5MiB・合計20MiBまで</span></label>
      <label className="block">連絡事項（任意）<textarea name="contactNotes" maxLength={2000} rows={3} className={inputStyle}/></label>
      <button className="w-full rounded-lg bg-[#0b2e59] p-3 font-bold text-white" type="submit">{busy ? '送信中…' : '修理を依頼する'}</button>
    </fieldset>
    <p role="status" className="text-sm">{message}</p>
  </form>;
}
