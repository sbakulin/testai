const PAYMENT_STATUSES: Record<string, string> = {
  new: 'создан',
  pending: 'ожидает оплаты',
  succeeded: 'оплачен',
  failed: 'отклонён',
};

const REFUND_STATUSES: Record<string, string> = {
  processing: 'в обработке',
  succeeded: 'выполнен',
  failed: 'отклонён',
};

export const paymentStatusLabel = (status: string): string => PAYMENT_STATUSES[status] ?? status;
export const refundStatusLabel = (status: string): string => REFUND_STATUSES[status] ?? status;

const pad = (n: number): string => String(n).padStart(2, '0');

/** ISO-строка → «ДД.ММ.ГГГГ ЧЧ:ММ» в локальном времени. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
