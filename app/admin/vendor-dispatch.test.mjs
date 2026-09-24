import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const repairId = 23;
const vendorId = "11111111-1111-4111-8111-111111111111";
const secondVendorId = "33333333-3333-4333-8333-333333333333";
const inactiveVendorId = "99999999-9999-4999-8999-999999999999";
const requestId = "22222222-2222-4222-8222-222222222222";
const base = { repairId, vendorId, requestId, instructions: "現地確認と修理見積をお願いします。" };

function load(path, imports = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === "server-only") return {};
    if (name in imports) return imports[name];
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports;
}

const validation = load("../../lib/vendor-dispatch.ts");

function setup({ role = "admin", authenticated = true, repairOrg = "org-a", vendorOrg = "org-a",
  active = true, existingDispatches = [] } = {}) {
  const rpcCalls = [];
  const refreshed = [];
  const saved = new Map();
  const context = authenticated ? { ok: true, organizationId: "org-a", userId: "user-a",
    canUpdate: role !== "viewer" } : { ok: false, reason: "unauthenticated" };
  const db = {
    from(table) {
      const filters = [];
      const query = { select() { return query; }, eq(field, value) { filters.push([field, value]); return query; },
        order() { return query; }, limit() { return query; },
        async maybeSingle() {
          if (table === "repair_requests") return { data: repairOrg === null ? null :
            { id: repairId, organization_id: repairOrg }, error: null };
          if (table === "repair_vendors") {
            const requested = filters.find(([field]) => field === "id")?.[1];
            return { data: vendorOrg === null || !active ? null :
              { id: requested, organization_id: vendorOrg, is_active: active }, error: null };
          }
          if (table === "repair_vendor_dispatches") {
            const match = existingDispatches.find((row) => filters.every(([field, value]) => row[field] === value));
            return { data: match ?? null, error: null };
          }
          throw new Error(table);
        } };
      return query;
    },
    async rpc(name, args) {
      rpcCalls.push([name, args]);
      const prior = saved.get(`${args.p_org}:${args.p_request_id}`);
      if (prior) {
        if (prior.repair_request_id !== args.p_repair || prior.vendor_id !== args.p_vendor ||
            prior.instructions !== args.p_instructions) return { data: null, error: { message: "VENDOR_REQUEST_CONFLICT" } };
        return { data: prior, error: null };
      }
      const row = { id: "dispatch-a", organization_id: args.p_org, repair_request_id: args.p_repair,
        vendor_id: args.p_vendor, assigned_by: "user-a", request_id: args.p_request_id,
        instructions: args.p_instructions, status: "candidate" };
      saved.set(`${args.p_org}:${args.p_request_id}`, row);
      return { data: row, error: null };
    },
  };
  if (context.ok) context.supabase = db;
  const actions = load("./vendor-dispatch-actions.ts", {
    "@/lib/supabase-auth/staff": { getStaffContext: async () => context },
    "@/lib/supabase-server": { createServerSupabaseClient: () => db },
    "@/lib/vendor-dispatch": validation,
    "next/cache": { revalidatePath: (path) => refreshed.push(path) },
  });
  return { ...actions, rpcCalls, refreshed };
}

test("instructions validation accepts multiline 5000 characters and rejects blank or oversized input", () => {
  assert.equal(validation.parseSelectVendorInput({ ...base, instructions: "部屋確認\n見積依頼" }).instructions,
    "部屋確認\n見積依頼");
  assert.equal(validation.parseSelectVendorInput({ ...base, instructions: "あ".repeat(5000) }).instructions.length, 5000);
  assert.equal(validation.parseSelectVendorInput({ ...base, instructions: "   " }), null);
  assert.equal(validation.parseSelectVendorInput({ ...base, instructions: "あ".repeat(5001) }), null);
});

for (const role of ["admin", "manager", "staff"]) test(`${role} can select a scoped active vendor`, async () => {
  const subject = setup({ role });
  const result = await subject.selectRepairVendor(base);
  assert.equal(result.ok, true);
  assert.equal(subject.rpcCalls.length, 1);
  assert.equal(subject.rpcCalls[0][0], "select_repair_vendor");
  assert.equal(subject.rpcCalls[0][1].p_org, "org-a");
  assert.equal(subject.rpcCalls[0][1].p_request_id, requestId);
  assert.deepEqual(subject.refreshed, ["/admin"]);
});

test("viewer and unauthenticated requests are rejected before database mutation", async () => {
  for (const options of [{ role: "viewer" }, { authenticated: false }]) {
    const subject = setup(options);
    assert.equal((await subject.selectRepairVendor(base)).ok, false);
    assert.equal(subject.rpcCalls.length, 0);
  }
});

test("foreign repair, foreign vendor and inactive vendor are rejected before RPC", async () => {
  for (const options of [{ repairOrg: "org-b" }, { vendorOrg: "org-b" }, { active: false },
    { repairOrg: null }, { vendorOrg: null }]) {
    const subject = setup(options);
    assert.equal((await subject.selectRepairVendor(base)).ok, false);
    assert.equal(subject.rpcCalls.length, 0);
  }
});

test("same request ID and payload is idempotent; changed payload conflicts", async () => {
  const subject = setup();
  const first = await subject.selectRepairVendor(base);
  const second = await subject.selectRepairVendor(base);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.dispatchId, second.dispatchId);
  assert.equal(subject.rpcCalls[0][1].p_request_id, subject.rpcCalls[1][1].p_request_id);
  const conflict = await subject.selectRepairVendor({ ...base, instructions: "別の依頼内容" });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflict, true);
});

test("two different vendors can be selected for the same repair", async () => {
  const subject = setup();
  assert.equal((await subject.selectRepairVendor(base)).ok, true);
  assert.equal((await subject.selectRepairVendor({ ...base, vendorId: secondVendorId,
    requestId: "44444444-4444-4444-8444-444444444444" })).ok, true);
  assert.equal(subject.rpcCalls.length, 2);
  assert.deepEqual(subject.rpcCalls.map((call) => call[1].p_repair), [repairId, repairId]);
  assert.deepEqual(subject.rpcCalls.map((call) => call[1].p_vendor), [vendorId, secondVendorId]);
});

test("same vendor requires explicit confirmation and can be selected again after cancellation", async () => {
  for (const status of ["candidate", "cancelled", "completed"]) {
    const subject = setup({ existingDispatches: [{ id: `prior-${status}`, organization_id: "org-a",
      repair_request_id: repairId, vendor_id: vendorId, status, selected_at: "2026-09-20T00:00:00Z" }] });
    const warning = await subject.selectRepairVendor(base);
    assert.equal(warning.ok, false);
    assert.equal(warning.duplicate, true);
    assert.equal(subject.rpcCalls.length, 0);
    const confirmed = await subject.selectRepairVendor({ ...base, confirmDuplicate: true });
    assert.equal(confirmed.ok, true);
    assert.equal(subject.rpcCalls.length, 1);
  }
});

function manualSetup({ role = "admin", dispatchOrg = "org-a", vendorOrg = "org-a",
  initialStatuses = { "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1": "candidate" } } = {}) {
  const messages = new Map();
  const statuses = new Map(Object.entries(initialStatuses));
  const eventCounts = new Map();
  const serviceCalls = [];
  const context = { ok: true, organizationId: "org-a", userId: "user-a", canUpdate: role !== "viewer" };
  const authDb = { from(table) {
    const filters = [];
    const query = { select() { return query; }, eq(field, value) { filters.push([field, value]); return query; },
      async maybeSingle() {
        if (table === "repair_vendor_dispatches") {
          const id = filters.find(([field]) => field === "id")?.[1];
          return { data: dispatchOrg === null ? null : { id, organization_id: dispatchOrg,
            repair_request_id: repairId, vendor_id: vendorId, status: statuses.get(id) }, error: null };
        }
        if (table === "repair_vendors") return { data: vendorOrg === null ? null : { id: vendorId,
          organization_id: vendorOrg, company_name: "テスト設備", contact_name: "田中",
          phone: "090-0000-0000", email: "vendor@example.com" }, error: null };
        throw new Error(table);
      } };
    return query;
  } };
  context.supabase = authDb;
  const serviceDb = { async rpc(name, args) {
    serviceCalls.push([name, args]);
    assert.equal(name, "confirm_vendor_dispatch_manual_v2");
    const key = `${args.p_org}:${args.p_request_id}`;
    const prior = messages.get(key);
    if (prior) {
      if (prior.dispatch_id !== args.p_dispatch || prior.message_body !== args.p_message_body ||
          prior.recipient_label !== args.p_recipient_label || prior.recipient_address !== args.p_recipient_address ||
          JSON.stringify(prior.photos) !== JSON.stringify(args.p_photos))
        return { data: null, error: { message: "VENDOR_DISPATCH_MESSAGE_REQUEST_CONFLICT" } };
      return { data: prior, error: null };
    }
    if (statuses.get(args.p_dispatch) !== "candidate")
      return { data: null, error: { message: "VENDOR_DISPATCH_MESSAGE_STATUS_CONFLICT" } };
    const row = { id: `message-${messages.size + 1}`, organization_id: args.p_org,
      dispatch_id: args.p_dispatch, request_id: args.p_request_id, sent_by: args.p_actor,
      channel: "manual", delivery_status: "manual_confirmed", message_body: args.p_message_body,
      recipient_label: args.p_recipient_label, recipient_address: args.p_recipient_address,
      photos: args.p_photos };
    messages.set(key, row);
    statuses.set(args.p_dispatch, "dispatched");
    eventCounts.set(args.p_dispatch, (eventCounts.get(args.p_dispatch) ?? 0) + 1);
    return { data: row, error: null };
  } };
  const actions = load("./vendor-dispatch-actions.ts", {
    "@/lib/supabase-auth/staff": { getStaffContext: async () => context },
    "@/lib/supabase-server": { createServerSupabaseClient: () => serviceDb },
    "@/lib/vendor-dispatch": validation,
    "next/cache": { revalidatePath() {} },
  });
  return { ...actions, messages, statuses, eventCounts, serviceCalls };
}

const manualBase = { repairId, dispatchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", messageBody: "業者向けの手配本文",
  externalDeliveryConfirmed: true };

test("manual dispatch confirmation validates body and explicit external delivery confirmation", () => {
  assert.equal(validation.parseConfirmManualDispatchInput(manualBase).messageBody, manualBase.messageBody);
  assert.equal(validation.parseConfirmManualDispatchInput({ ...manualBase, externalDeliveryConfirmed: false }), null);
  assert.equal(validation.parseConfirmManualDispatchInput({ ...manualBase, messageBody: " " }), null);
  assert.equal(validation.parseConfirmManualDispatchInput({ ...manualBase, messageBody: "あ".repeat(10001) }), null);
  assert.equal(validation.parseConfirmManualDispatchInput({ ...manualBase,
    photos: [{ sourceType: "repair_photo", sourceId: "9223372036854775807" },
      { sourceType: "repair_photo", sourceId: "9223372036854775807" }] }), null);
});

test("photo order is forwarded and different photo payload conflicts on retry", async () => {
  const subject = manualSetup();
  const photos = [{ sourceType: "repair_photo", sourceId: "9223372036854775807" },
    { sourceType: "tenant_line_attachment", sourceId: requestId }];
  assert.equal((await subject.confirmManualVendorDispatch({ ...manualBase, photos })).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(subject.serviceCalls[0][1].p_photos)), [
    { source_type: "repair_photo", source_id: "9223372036854775807" },
    { source_type: "tenant_line_attachment", source_id: requestId },
  ]);
  assert.equal((await subject.confirmManualVendorDispatch({ ...manualBase, photos })).ok, true);
  const reversed = await subject.confirmManualVendorDispatch({ ...manualBase, photos: [...photos].reverse() });
  assert.equal(reversed.ok, false);
  assert.equal(reversed.conflict, true);
  assert.equal(subject.messages.size, 1);
  assert.equal(subject.eventCounts.get(manualBase.dispatchId), 1);
});

for (const role of ["admin", "manager", "staff"]) test(`${role} can manually confirm a candidate dispatch`, async () => {
  const subject = manualSetup({ role });
  const result = await subject.confirmManualVendorDispatch(manualBase);
  assert.equal(result.ok, true);
  assert.equal(subject.messages.size, 1);
  assert.equal(subject.statuses.get(manualBase.dispatchId), "dispatched");
  assert.equal(subject.eventCounts.get(manualBase.dispatchId), 1);
  assert.equal(subject.serviceCalls[0][1].p_org, "org-a");
  assert.equal(subject.serviceCalls[0][1].p_actor, "user-a");
  assert.equal(subject.serviceCalls[0][1].p_recipient_address, "090-0000-0000 / vendor@example.com");
});

test("viewer and foreign dispatch or vendor are rejected before the server-only RPC", async () => {
  for (const options of [{ role: "viewer" }, { dispatchOrg: "org-b" }, { vendorOrg: "org-b" },
    { dispatchOrg: null }, { vendorOrg: null }]) {
    const subject = manualSetup(options);
    assert.equal((await subject.confirmManualVendorDispatch(manualBase)).ok, false);
    assert.equal(subject.serviceCalls.length, 0);
  }
});

test("manual confirmation is idempotent and retry after dispatched does not duplicate message or event", async () => {
  const subject = manualSetup();
  const first = await subject.confirmManualVendorDispatch(manualBase);
  const retry = await subject.confirmManualVendorDispatch(manualBase);
  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  assert.equal(first.messageId, retry.messageId);
  assert.equal(subject.messages.size, 1);
  assert.equal(subject.eventCounts.get(manualBase.dispatchId), 1);
  const conflict = await subject.confirmManualVendorDispatch({ ...manualBase, messageBody: "異なる本文" });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflict, true);
  assert.equal(subject.messages.size, 1);
});

test("multiple dispatches on one repair can be confirmed independently", async () => {
  const secondDispatch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
  const subject = manualSetup({ initialStatuses: {
    [manualBase.dispatchId]: "candidate", [secondDispatch]: "candidate",
  } });
  assert.equal((await subject.confirmManualVendorDispatch(manualBase)).ok, true);
  assert.equal((await subject.confirmManualVendorDispatch({ ...manualBase, dispatchId: secondDispatch,
    requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2" })).ok, true);
  assert.equal(subject.messages.size, 2);
  assert.equal(subject.eventCounts.get(manualBase.dispatchId), 1);
  assert.equal(subject.eventCounts.get(secondDispatch), 1);
});

function dataSubject(overrides = {}) {
  const rows = {
    repair_vendors: [
      { id: vendorId, organization_id: "org-a", company_name: "テスト設備", contact_name: "田中",
        phone: "090-0000-0000", email: "vendor@example.com", is_active: true },
      { id: inactiveVendorId, organization_id: "org-a", company_name: "休止業者", contact_name: "佐藤",
        phone: null, email: null, is_active: false },
    ],
    repair_vendor_categories: [{ organization_id: "org-a", vendor_id: vendorId, category: "エアコン" }],
    repair_vendor_areas: [{ organization_id: "org-a", vendor_id: vendorId,
      area_code: "nishinomiya", area_label: "西宮市" }],
    repair_vendor_dispatches: [{ id: "dispatch-a", organization_id: "org-a", repair_request_id: repairId,
      vendor_id: vendorId, assigned_by: "user-a", status: "candidate", instructions: base.instructions,
      selected_at: "2026-09-21T06:10:00Z" }],
    repair_vendor_dispatch_events: [{ id: "event-a", organization_id: "org-a", dispatch_id: "dispatch-a",
      event_type: "selected", from_status: null, to_status: "candidate", note: null,
      actor_auth_user_id: "user-a", occurred_at: "2026-09-21T06:10:00Z" }],
    repair_vendor_dispatch_messages: [],
    organization_members: [{ organization_id: "org-a", auth_user_id: "user-a", display_name: "市場" }],
    ...overrides,
  };
  const queries = [];
  const db = { from(table) {
    const call = { table, filters: [] };
    queries.push(call);
    const query = { select() { return query; }, eq(field, value) { call.filters.push(["eq", field, value]); return query; },
      in(field, value) { call.filters.push(["in", field, value]); return query; }, order() { return query; },
      then(resolve, reject) { return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve, reject); } };
    return query;
  } };
  const dataApi = load("./vendor-dispatch-data.ts");
  return { get: () => dataApi.getVendorDispatchData({ ok: true, supabase: db,
    organizationId: "org-a", userId: "user-a", canUpdate: true }, [repairId]), queries };
}

test("active candidates and newly selected dispatch/event appear in repair history", async () => {
  const subject = dataSubject();
  const result = await subject.get();
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].companyName, "テスト設備");
  assert.deepEqual(JSON.parse(JSON.stringify(result.candidates[0].categories)), ["エアコン"]);
  assert.equal(result.byRepair[repairId][0].assignedByName, "市場");
  assert.equal(result.byRepair[repairId][0].instructions, base.instructions);
  assert.equal(result.byRepair[repairId][0].events[0].eventType, "selected");
  assert.ok(subject.queries.every((query) => query.filters.some((filter) =>
    filter[0] === "eq" && filter[1] === "organization_id" && filter[2] === "org-a")));
});

test("foreign related rows fail closed", async () => {
  const subject = dataSubject({ repair_vendor_categories: [
    { organization_id: "org-b", vendor_id: vendorId, category: "エアコン" },
  ] });
  await assert.rejects(subject.get(), /VENDOR_DISPATCH_SCOPE_MISMATCH/);
});

test("manual delivery history is returned with its staff actor", async () => {
  const subject = dataSubject({
    repair_vendor_dispatches: [{ id: "dispatch-a", organization_id: "org-a", repair_request_id: repairId,
      vendor_id: vendorId, assigned_by: "user-a", status: "dispatched", instructions: base.instructions,
      selected_at: "2026-09-21T06:10:00Z" }],
    repair_vendor_dispatch_messages: [{ id: "message-a", organization_id: "org-a", dispatch_id: "dispatch-a",
      channel: "manual", message_body: "本文", recipient_label: "テスト設備 田中",
      recipient_address: "090-0000-0000", sent_by: "user-a", sent_at: "2026-09-21T07:30:00Z",
      delivery_status: "manual_confirmed", photo_selection_recorded: true }],
    repair_vendor_dispatch_message_attachments: [
      { id: "photo-a", organization_id: "org-a", message_id: "message-a", source_type: "repair_photo", sort_order: 0 },
      { id: "photo-b", organization_id: "org-a", message_id: "message-a", source_type: "tenant_line_attachment", sort_order: 1 },
    ],
  });
  const result = await subject.get();
  assert.equal(result.byRepair[repairId][0].messages.length, 1);
  assert.equal(result.byRepair[repairId][0].messages[0].deliveryStatus, "manual_confirmed");
  assert.equal(result.byRepair[repairId][0].messages[0].sentByName, "市場");
  assert.equal(result.byRepair[repairId][0].messages[0].photoSelectionRecorded, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.byRepair[repairId][0].messages[0].attachments.map((photo) => photo.sourceType))),
    ["repair_photo", "tenant_line_attachment"]);
});

test("foreign attachment history fails closed", async () => {
  const subject = dataSubject({ repair_vendor_dispatch_messages: [{ id: "message-a", organization_id: "org-a",
    dispatch_id: "dispatch-a", sent_by: "user-a" }], repair_vendor_dispatch_message_attachments: [
      { id: "photo-a", organization_id: "org-b", message_id: "message-a", source_type: "repair_photo", sort_order: 0 },
    ] });
  await assert.rejects(subject.get(), /VENDOR_DISPATCH_ATTACHMENTS_SCOPE_MISMATCH/);
});

test("dispatch UI always offers add, warns for a repeated vendor and keeps viewer gating", () => {
  const source = readFileSync(new URL("./vendor-dispatch-section.tsx", import.meta.url), "utf8");
  for (const label of ["業者を追加手配", "会社名検索", "カテゴリ", "対応エリア", "手配内容",
    "担当スタッフ", "選択日時", "業者へ手配", "送信内容の確認", "本文をコピー",
    "手配済みにする", "この画面から外部送信は行いません", "スタッフ確認済み"]) assert.ok(source.includes(label), label);
  assert.ok(source.includes("canUpdate && !open"));
  assert.ok(source.includes("同じ業者の既存手配を確認しました"));
  assert.equal(source.includes("canUpdate && dispatches.length === 0"), false);
  assert.ok(source.includes("maxLength={5000}"));
  assert.equal(/LINE送信|メール送信|正式発注/.test(source), false);
});
