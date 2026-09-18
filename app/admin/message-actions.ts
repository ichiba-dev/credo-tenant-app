"use server";
import { saveStaffReply } from "@/lib/staff-line-reply";
export type { StaffMessageResult } from "@/lib/staff-line-reply";
export async function submitStaffMessage(repairId: string, message: string, requestId: string) {
  return saveStaffReply(repairId, message, requestId);
}
