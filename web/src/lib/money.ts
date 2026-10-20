/** Сумма в минимальных единицах (копейки) → «150 000,00». */
export function formatSums(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const whole = String(Math.floor(abs / 100));
  const cents = String(abs % 100).padStart(2, '0');
  let grouped = '';
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) grouped += ' ';
    grouped += whole[i];
  }
  return `${negative ? '-' : ''}${grouped},${cents}`;
}

/** «1000», «1000.50», «1000,5» → минимальные единицы; null, если ввод некорректен или не положителен. */
export function parseSumsInput(text: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0) return null;
  return minor;
}
