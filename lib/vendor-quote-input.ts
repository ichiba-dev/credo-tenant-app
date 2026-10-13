export type QuoteLine = { description: string; quantity: number; unit: string; unit_price_ex_tax: number; line_amount_ex_tax: number; tax_rate: number };
export function parseQuoteLines(value: unknown): QuoteLine[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  const lines: QuoteLine[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const { description, quantity, unit, unit_price_ex_tax: price, line_amount_ex_tax: amount, tax_rate: rate } = row;
    if (typeof description !== 'string' || !description.trim() || description.length > 1000 ||
      typeof unit !== 'string' || !unit.trim() || unit.length > 30 ||
      typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9 ||
      Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.0001 ||
      typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1e12 ||
      Math.abs(price * 10000 - Math.round(price * 10000)) > 0.001 ||
      !Number.isSafeInteger(amount) || amount < 0 || amount !== Math.round(quantity * price) || ![0, 0.08, 0.1].includes(rate)) return null;
    lines.push({ description: description.trim(), quantity, unit: unit.trim(), unit_price_ex_tax: price, line_amount_ex_tax: amount, tax_rate: rate });
  }
  return quoteTotal(lines) === null ? null : lines;
}
export function quoteTotal(lines: QuoteLine[]): number | null {
  const groups = new Map<number, number>();
  for (const line of lines) groups.set(line.tax_rate, (groups.get(line.tax_rate) ?? 0) + line.line_amount_ex_tax);
  let total = 0;
  for (const [rate, subtotal] of groups) total += subtotal + Math.floor(subtotal * rate + 1e-8);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}
export function optionalQuoteText(value: unknown, max: number): string | null | undefined {
  if (value == null || value === '') return null;
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? value : undefined;
}
export function optionalQuoteDate(value: unknown): string | null | undefined {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}
