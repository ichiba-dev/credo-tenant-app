import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getOwnerRequestContext, getOwnerRequestProperties } from './data';
import OwnerRepairForm from './request-form';

export default async function NewOwnerRepairPage() {
  await connection();
  let properties;
  try {
    properties = await getOwnerRequestProperties(await getOwnerRequestContext());
  } catch (error) {
    if (error instanceof Error && error.message === 'OWNER_UNAUTHENTICATED') redirect('/owner/login?next=%2Fowner%2Frepairs%2Fnew');
    return <main className="p-6"><p role="alert">依頼できる物件を確認できませんでした。管理会社へお問い合わせください。</p><Link href="/owner">オーナー画面へ戻る</Link></main>;
  }
  return <main className="min-h-screen bg-slate-50 px-4 py-8"><div className="mx-auto max-w-2xl rounded-2xl bg-white p-6 shadow-sm">
    <Link href="/owner" className="text-sm text-[#0b2e59] underline">オーナー画面へ戻る</Link>
    <h1 className="mt-5 text-2xl font-bold text-[#0b2e59]">修理を依頼する</h1>
    <p className="mt-2 text-sm text-slate-600">お部屋や共用部の不具合を管理会社へお知らせください。</p>
    {properties.length ? <OwnerRepairForm properties={properties}/> : <p className="mt-6">依頼できる物件がありません。管理会社へお問い合わせください。</p>}
  </div></main>;
}
