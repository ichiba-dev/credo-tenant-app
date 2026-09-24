import type { ReactNode } from "react";

export default function UnassignedLineNotice({ messageCount, attachmentCount, messagesUnavailable, attachmentsUnavailable, children }: {
  messageCount: number; attachmentCount: number;
  messagesUnavailable: boolean; attachmentsUnavailable: boolean; children: ReactNode;
}) {
  if (!messageCount && !attachmentCount && !messagesUnavailable && !attachmentsUnavailable) return null;
  return <details className="mb-4 rounded-lg border border-amber-200 bg-amber-50 text-sm text-[#0b2e59]">
    <summary className="cursor-pointer px-4 py-3 font-medium">
      未割当LINE　メッセージ{messagesUnavailable ? "取得不可" : `${messageCount}件`} / 添付{attachmentsUnavailable ? "取得不可" : `${attachmentCount}件`}
      <span className="ml-3 text-xs">確認・割当</span>
    </summary>
    <div className="px-3 pb-3">
      <p className="mb-3 text-xs text-slate-600">件数は取得済み分（各最新50件まで）です。</p>
      {children}
    </div>
  </details>;
}
