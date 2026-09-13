export function parseRepairId(value: string): number | null {
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(parsed);
  } catch {
    return null;
  }
}

export function ownerRepairPath(value: unknown) {
  if (value === "/owner") return "/owner";
  if (typeof value !== "string") return "/owner";
  const match = /^\/owner\/repairs\/([1-9][0-9]*)$/.exec(value);
  if (!match || parseRepairId(match[1]) === null) return "/owner";
  return value;
}

export function tenantRepairPath(value: unknown) {
  if (value === "/tenant") return "/tenant";
  if (typeof value !== "string") return "/tenant";
  const match = /^\/tenant\/repairs\/([1-9][0-9]*)$/.exec(value);
  if (!match || parseRepairId(match[1]) === null) return "/tenant";
  return value;
}
