import type { Metadata } from 'next';
import VendorQuoteSubmission from './submission';
export const metadata: Metadata = { title: '業者見積提出 | CREDO', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function VendorQuoteSubmitPage() {
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900"><div className="mx-auto max-w-2xl"><h1 className="text-2xl font-bold text-[#0b2e59]">業者見積提出</h1><VendorQuoteSubmission /></div></main>;
}
