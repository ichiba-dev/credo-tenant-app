import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { getCalendarEvents } from "../calendar-data";
import { japanDay, nextDay } from "../calendar-state";
import { monthDays } from "./month-grid";
import CalendarView from "./calendar-view";
export default async function CalendarPage({searchParams}: {searchParams:Promise<{month?:string}>}) {
  const context=await getStaffContext();if(!context.ok)redirect('/admin/login');
  const now=Date.now(),today=japanDay(now),params=await searchParams;
  const month=typeof params.month==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(params.month)?params.month:today.slice(0,7);
  const days=monthDays(month);
  let events;try {events=await getCalendarEvents(context,`${days[0]}T00:00:00+09:00`,`${nextDay(days[days.length-1])}T00:00:00+09:00`);}catch{events=null;}
  return <main className="min-h-screen bg-slate-100 p-3 sm:p-6"><div className="mx-auto max-w-screen-2xl">
    <Link href="/admin" className="text-sm text-[#0b2e59] underline">修理依頼一覧へ</Link>
    <h1 className="my-4 text-2xl font-bold text-[#0b2e59]">カレンダー</h1>
    {events?<CalendarView key={month} events={events} month={month} initialDay={today.startsWith(month)?today:month+'-01'} initialNow={now} canUpdate={context.canUpdate}/>:
      <p role="alert">予定を取得できませんでした。時間をおいて再読み込みしてください。</p>}
  </div></main>;
}
