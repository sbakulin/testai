const SUMS_RE = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/** '150000.00' -> 15000000 (тийины). Разбор строковый, без float. */
export function toMinor(sums: string): number {
  const m = SUMS_RE.exec(sums);
  if (!m) throw new Error(`invalid sums amount: "${sums}"`);
  const [, sign, whole, fraction = ''] = m;
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor)) throw new Error(`amount out of range: "${sums}"`);
  return sign ? -minor : minor;
}

/** 15000000 -> '150000.00' */
export function toSums(minor: number): string {
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${minor < 0 ? '-' : ''}${whole}.${fraction}`;
}
