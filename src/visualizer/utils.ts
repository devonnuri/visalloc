export function hex(n?: number | null) {
  if (n == null) return '-';
  return '0x' + (n >>> 0).toString(16);
}

export function parsePtr(input: string): number | null {
  if (!input) return null;
  const s = input.trim();
  if (/^0x/i.test(s)) {
    const v = Number.parseInt(s, 16);
    return Number.isFinite(v) ? v : null;
  }
  const v = Number.parseInt(s, 10);
  return Number.isFinite(v) ? v : null;
}
