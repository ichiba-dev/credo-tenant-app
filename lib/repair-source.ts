export type RepairSource = {
  source_type?: string | null;
  source_channel?: string | null;
  source_label?: string | null;
  location_type?: string | null;
  room_number?: string | null;
};
export function repairSourceLabel(source: RepairSource): string {
  const labels: Record<string, string> = { tenant: '入居者', owner: 'オーナー', staff: '管理会社', vendor: '業者', other: 'その他' };
  return labels[source.source_type || 'tenant'] ?? 'その他';
}
export function repairReportLabel(source: RepairSource): string {
  return `【${repairSourceLabel(source)}申告】`;
}
export function repairLocation(source: RepairSource): string {
  return source.location_type === 'common_area' ? '共用部' : source.room_number ? `${source.room_number}号室` : '場所未登録';
}
export function repairPhotoSource(source: RepairSource): string {
  if (!source.source_type || source.source_type === 'tenant') return source.source_channel === 'line' ? '入居者LINE' : '入居者フォーム';
  return repairSourceLabel(source);
}
