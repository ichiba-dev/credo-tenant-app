import "server-only";

import type { getStaffContext } from "@/lib/supabase-auth/staff";
import type { VendorCandidate, VendorDispatchHistory } from "./types";

type StaffContext = Extract<Awaited<ReturnType<typeof getStaffContext>>, { ok: true }>;

export async function getVendorDispatchData(context: StaffContext, repairIds: number[]): Promise<{
  candidates: VendorCandidate[];
  byRepair: Record<number, VendorDispatchHistory[]>;
}> {
  const ids = [...new Set(repairIds)];
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("VENDOR_DISPATCH_REPAIR_INVALID");
  const byRepair: Record<number, VendorDispatchHistory[]> = Object.fromEntries(ids.map((id) => [id, []]));
  const { supabase, organizationId } = context;
  const [vendorResult, categoryResult, areaResult, dispatchResult] = await Promise.all([
    supabase.from("repair_vendors")
      .select("id,organization_id,company_name,contact_name,phone,email,is_active").eq("organization_id", organizationId)
      .order("company_name"),
    supabase.from("repair_vendor_categories")
      .select("organization_id,vendor_id,category").eq("organization_id", organizationId).order("category"),
    supabase.from("repair_vendor_areas")
      .select("organization_id,vendor_id,area_code,area_label").eq("organization_id", organizationId).order("area_label"),
    ids.length ? supabase.from("repair_vendor_dispatches")
      .select("id,organization_id,repair_request_id,vendor_id,assigned_by,status,instructions,selected_at")
      .eq("organization_id", organizationId).in("repair_request_id", ids)
      .order("selected_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (vendorResult.error || categoryResult.error || areaResult.error || dispatchResult.error)
    throw new Error("VENDOR_DISPATCH_UNAVAILABLE");
  const vendors = vendorResult.data ?? [];
  const categories = categoryResult.data ?? [];
  const areas = areaResult.data ?? [];
  const dispatches = dispatchResult.data ?? [];
  const vendorIds = new Set(vendors.map((vendor) => vendor.id));
  const repairIdSet = new Set(ids);
  if (vendors.some((row) => row.organization_id !== organizationId) ||
      categories.some((row) => row.organization_id !== organizationId || !vendorIds.has(row.vendor_id)) ||
      areas.some((row) => row.organization_id !== organizationId || !vendorIds.has(row.vendor_id)) ||
      dispatches.some((row) => row.organization_id !== organizationId || !repairIdSet.has(row.repair_request_id) ||
        !vendorIds.has(row.vendor_id))) throw new Error("VENDOR_DISPATCH_SCOPE_MISMATCH");

  const dispatchIds = dispatches.map((row) => row.id);
  const actorIds = [...new Set(dispatches.map((row) => row.assigned_by))];
  const [eventResult, messageResult] = await Promise.all([
    dispatchIds.length ? supabase.from("repair_vendor_dispatch_events")
      .select("id,organization_id,dispatch_id,event_type,from_status,to_status,note,actor_auth_user_id,occurred_at")
      .eq("organization_id", organizationId).in("dispatch_id", dispatchIds)
      .order("occurred_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
    dispatchIds.length ? supabase.from("repair_vendor_dispatch_messages")
      .select("id,organization_id,dispatch_id,channel,message_body,recipient_label,recipient_address,sent_by,sent_at,delivery_status")
      .eq("organization_id", organizationId).in("dispatch_id", dispatchIds)
      .order("sent_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (eventResult.error || messageResult.error) throw new Error("VENDOR_DISPATCH_HISTORY_UNAVAILABLE");
  const events = eventResult.data ?? [];
  const messages = messageResult.data ?? [];
  const allActorIds = [...new Set([...actorIds, ...events.map((row) => row.actor_auth_user_id),
    ...messages.map((row) => row.sent_by)])];
  let members: { organization_id: string; auth_user_id: string; display_name: string | null }[] = [];
  if (allActorIds.length) {
    const result = await supabase.from("organization_members")
      .select("organization_id,auth_user_id,display_name").eq("organization_id", organizationId)
      .in("auth_user_id", allActorIds);
    if (result.error) throw new Error("VENDOR_DISPATCH_ACTOR_UNAVAILABLE");
    members = result.data ?? [];
  }
  const dispatchIdSet = new Set(dispatchIds);
  if (events.some((row) => row.organization_id !== organizationId || !dispatchIdSet.has(row.dispatch_id)) ||
      messages.some((row) => row.organization_id !== organizationId || !dispatchIdSet.has(row.dispatch_id)) ||
      members.some((row) => row.organization_id !== organizationId)) throw new Error("VENDOR_DISPATCH_HISTORY_SCOPE_MISMATCH");
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const memberMap = new Map(members.map((member) => [member.auth_user_id, member.display_name || "担当スタッフ"]));

  for (const dispatch of dispatches) {
    const vendor = vendorMap.get(dispatch.vendor_id)!;
    byRepair[dispatch.repair_request_id].push({
      id: dispatch.id,
      vendorId: dispatch.vendor_id,
      vendorName: vendor.company_name,
      vendorContactName: vendor.contact_name,
      vendorPhone: vendor.phone,
      vendorEmail: vendor.email,
      status: dispatch.status,
      instructions: dispatch.instructions,
      selectedAt: dispatch.selected_at,
      assignedByName: memberMap.get(dispatch.assigned_by) ?? "担当スタッフ",
      events: events.filter((event) => event.dispatch_id === dispatch.id).map((event) => ({
        id: event.id,
        eventType: event.event_type,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        note: event.note,
        occurredAt: event.occurred_at,
        actorName: memberMap.get(event.actor_auth_user_id) ?? "担当スタッフ",
      })),
      messages: messages.filter((message) => message.dispatch_id === dispatch.id).map((message) => ({
        id: message.id,
        channel: message.channel,
        messageBody: message.message_body,
        recipientLabel: message.recipient_label,
        recipientAddress: message.recipient_address,
        deliveryStatus: message.delivery_status,
        sentAt: message.sent_at,
        sentByName: memberMap.get(message.sent_by) ?? "担当スタッフ",
      })),
    });
  }
  const candidates: VendorCandidate[] = vendors.filter((vendor) => vendor.is_active === true).map((vendor) => ({
    id: vendor.id,
    companyName: vendor.company_name,
    contactName: vendor.contact_name,
    phone: vendor.phone,
    email: vendor.email,
    categories: categories.filter((row) => row.vendor_id === vendor.id).map((row) => row.category),
    areas: areas.filter((row) => row.vendor_id === vendor.id)
      .map((row) => ({ areaCode: row.area_code, areaLabel: row.area_label })),
  }));
  return { candidates, byRepair };
}
