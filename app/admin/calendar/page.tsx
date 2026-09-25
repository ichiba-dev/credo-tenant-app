import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/supabase-auth/staff";
import { getCalendarEvents } from "../calendar-data";
import { japanDay, localInstant } from "../calendar-state";
import { calendarRange, type CalendarMode } from "./scheduler";
import CalendarView from "./calendar-view";
export default async function CalendarPage({searchParams}: {searchParams:Promise<{month?:string;day?:string;view?:string}>}) {
  const context=await getStaffContext();if(!context.ok)redirect('/admin/login');
  const now=Date.now(),today=japanDay(now),params=await searchParams;
  const requestedMonth=typeof params.month==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(params.month)?params.month:today.slice(0,7);
  const day=typeof params.day==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(params.day)&&localInstant(params.day,'00:00')?params.day:today.startsWith(requestedMonth)?today:requestedMonth+'-01';
  const month=day.slice(0,7);
  const mode:CalendarMode=params.view==='month'||params.view==='week'||params.view==='day'?params.view:'auto';
  const range=calendarRange(month,day);
  let events;try {events=await getCalendarEvents(context,`${range.from}T00:00:00+09:00`,`${range.until}T00:00:00+09:00`);}catch{events=null;}
  return <main className="min-h-screen bg-slate-100 p-3 sm:p-6"><div className="w-full">
    <Link href="/admin" className="text-sm text-[#0b2e59] underline">修理依頼一覧へ</Link>
    <h1 className="my-4 text-2xl font-bold text-[#0b2e59]">カレンダー</h1>
    {events?<CalendarView events={events} month={month} initialDay={day} mode={mode} initialNow={now} canUpdate={context.canUpdate}/>:
      <p role="alert">予定を取得できませんでした。時間をおいて再読み込みしてください。</p>}
  </div></main>;
}
