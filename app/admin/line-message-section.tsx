import type { UnassignedLineMessage } from "./types";
import LineMessageAssignment from "./line-message-assignment";

export default function LineMessageSection({ messages, unavailable, canUpdate = false }: {
  messages: UnassignedLineMessage[]; unavailable: boolean; canUpdate?: boolean;
}) {
  return <section aria-labelledby="unassigned-line-heading" className="mb-8 rounded-xl bg-white p-6 shadow">
    <h2 id="unassigned-line-heading" className="text-xl font-bold text-[#0b2e59]">未割当LINEメッセージ</h2>
    <p className="mt-2 text-sm text-gray-500">修理依頼に未割当のメッセージを、新しい順に最新50件表示します。</p>
    {unavailable ? <p role="alert" className="mt-4 text-sm text-red-700">LINEメッセージを取得できませんでした。時間をおいて再読み込みしてください。</p>
      : !messages.length ? <p className="mt-4 text-sm text-gray-500">未割当LINEメッセージはありません。</p>
        : <ol className="mt-4 max-h-[36rem] space-y-3 overflow-y-auto">{messages.map(item => <li key={item.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-gray-800">{item.tenant_name}</span>
            <time dateTime={item.created_at} className="text-xs text-gray-500">{new Date(item.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</time>
          </div>
          <div className="mt-2 flex gap-2 text-xs"><span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-800">LINE</span><span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">未割当</span></div>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-800 [overflow-wrap:anywhere]">{item.message}</p>
          {canUpdate && <LineMessageAssignment messageId={item.id} />}
        </li>)}</ol>}
  </section>;
}
