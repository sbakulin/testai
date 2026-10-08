import type { Receipts } from './app.js';

/** Отправка чеков во внешний сервис; при таймауте или ошибке бросает исключение. */
export function createReceipts(baseUrl: string, { timeoutMs = 1500 }: { timeoutMs?: number } = {}): Receipts {
  return {
    async send({ payment_id, amount }) {
      const res = await fetch(`${baseUrl}/receipts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payment_id, amount }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`receipts request failed: ${res.status}`);
    },
  };
}
