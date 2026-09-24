export type DispatchPhoto = {
  id: string;
  url: string;
  source: "入居者フォーム" | "入居者LINE" | "不明";
  sourceType: "repair_photo" | "tenant_line_attachment" | "legacy_photo";
  sourceId?: string;
  createdAt?: string;
  selectedByDefault: boolean;
};

export function tenantLineTextMessages<T extends { channel?: string; sender_type: string;
  attachment?: unknown; message: string }>(messages: T[]): T[] {
  return messages.filter((item) => item.channel === "line" && item.sender_type === "tenant" &&
    !item.attachment && item.message.trim().length > 0);
}

export function managementRequest(instructions: string, propertyName: string,
  roomNumber: string, report: string): string {
  const legacy = `${propertyName} ${roomNumber}号室\n${report}\n現地確認と修理見積をお願いします。`;
  return instructions === legacy ? "現地確認と修理見積をお願いします。" : instructions;
}

export function uniqueDispatchPhotos(photos: DispatchPhoto[]): DispatchPhoto[] {
  const seen = new Set<string>();
  return photos.filter((photo) => {
    // The source row ID is stable even when a signed URL is refreshed.
    const key = photo.sourceType === "repair_photo" ? photo.url.split("?")[0] : photo.id;
    if (!photo.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function manualMessageDraft(input: {
  vendorName: string; contactName: string; propertyName: string; roomNumber: string;
  category: string; report: string; instructions: string; managementCompanyName: string;
  additionalMessages: string[]; photoCount: number;
}): string {
  const sections = [
    `${input.vendorName}\n${input.contactName}様`,
    `いつもお世話になっております。\n${input.managementCompanyName}です。`,
    "下記修繕についてご対応をお願いいたします。",
    `物件：${input.propertyName}\n号室：${input.roomNumber}号室\n修繕カテゴリ：${input.category}`,
  ];
  if (input.report.trim()) sections.push(`【入居者申告】\n${input.report.trim()}`);
  for (const message of input.additionalMessages.filter((value) => value.trim()))
    sections.push(`【入居者からの追加連絡】\n${message.trim()}`);
  sections.push(`【管理会社からの依頼】\n${input.instructions.trim()}`);
  sections.push(`【添付写真】\n手動送信時に使用する写真：${input.photoCount}枚`);
  sections.push("よろしくお願いいたします。");
  return sections.join("\n\n");
}

export function updateDraftPhotoCount(body: string, count: number): string {
  return body.replace(/手動送信時に使用する写真：\d+枚/, `手動送信時に使用する写真：${count}枚`);
}
