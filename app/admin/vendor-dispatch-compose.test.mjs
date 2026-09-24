import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const source = ts.transpileModule(readFileSync(new URL("./vendor-dispatch-compose.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(source, { exports });
const { managementRequest, manualMessageDraft, tenantLineTextMessages, uniqueDispatchPhotos, updateDraftPhotoCount } = exports;

const input = { vendorName: "設備会社", contactName: "山田", propertyName: "イリスアール",
  roomNumber: "202", category: "エアコン", report: "冷えません", instructions: "見積をお願いします",
  managementCompanyName: "株式会社CREDO", additionalMessages: [], photoCount: 2 };

test("tenant report and company instructions stay in separate labeled blocks", () => {
  const body = manualMessageDraft(input);
  assert.match(body, /【入居者申告】\n冷えません/);
  assert.match(body, /【管理会社からの依頼】\n見積をお願いします/);
  assert.ok(body.indexOf("【入居者申告】") < body.indexOf("【管理会社からの依頼】"));
  assert.match(body, /手動送信時に使用する写真：2枚/);
});

test("empty report is omitted and selected additional tenant text can be inserted", () => {
  const body = manualMessageDraft({ ...input, report: "  ", additionalMessages: ["室外機から変な音"] });
  assert.doesNotMatch(body, /【入居者申告】/);
  assert.match(body, /【入居者からの追加連絡】\n室外機から変な音/);
});

test("only inbound tenant LINE text is offered", () => {
  const candidates = tenantLineTextMessages([
    { channel: "line", sender_type: "tenant", message: "入居者追記" },
    { channel: "line", sender_type: "staff", message: "スタッフ返信" },
    { channel: "web", sender_type: "tenant", message: "Web投稿" },
    { channel: "line", sender_type: "tenant", message: "", attachment: { id: "image" } },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].message, "入居者追記");
});

test("only the exact legacy default is separated from the tenant report", () => {
  const legacy = "イリスアール 202号室\n冷えません\n現地確認と修理見積をお願いします。";
  assert.equal(managementRequest(legacy, "イリスアール", "202", "冷えません"), "現地確認と修理見積をお願いします。");
  assert.equal(managementRequest(`${legacy}\n追加の指示`, "イリスアール", "202", "冷えません"), `${legacy}\n追加の指示`);
});

test("photo count edits preserve staff changes and photo duplicates are removed", () => {
  const body = manualMessageDraft(input).replace("見積をお願いします", "至急確認してください");
  const updated = updateDraftPhotoCount(body, 1);
  assert.match(updated, /至急確認してください/);
  assert.match(updated, /手動送信時に使用する写真：1枚/);
  const photos = uniqueDispatchPhotos([
    { id: "repair:0", url: "https://example.test/photo.jpg?token=1", source: "入居者フォーム", sourceType: "repair_photo", selectedByDefault: true },
    { id: "repair:1", url: "https://example.test/photo.jpg?token=2", source: "入居者フォーム", sourceType: "repair_photo", selectedByDefault: true },
    { id: "line:a", url: "/api/admin/line-attachments/a/open", source: "入居者LINE", sourceType: "tenant_line_attachment", selectedByDefault: true },
  ]);
  assert.equal(photos.length, 2);
  assert.equal(photos[1].source, "入居者LINE");
});
