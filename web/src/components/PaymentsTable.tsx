import type { Payment } from '../lib/api';
import { paymentStatusLabel } from '../lib/format';
import { formatSums } from '../lib/money';

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

interface Props {
  payments: Payment[];
  selectedId: string | undefined;
  onSelect(payment: Payment): void;
}

export function PaymentsTable({ payments, selectedId, onSelect }: Props) {
  return (
    <table className="payments">
      <thead>
        <tr>
          <th>Платёж</th>
          <th>Провайдер</th>
          <th className="num">Сумма</th>
          <th>Статус</th>
          <th>Создан</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr
            key={p.id}
            data-testid={`payment-row-${p.id}`}
            className={p.id === selectedId ? 'selected' : undefined}
            onClick={() => onSelect(p)}
          >
            <td>{p.id}</td>
            <td>{p.provider_payment_id ?? '—'}</td>
            <td className="num">{formatSums(p.amount_minor)}</td>
            <td>
              <span className={`status status-${p.status}`}>{paymentStatusLabel(p.status)}</span>
            </td>
            <td>{new Intl.DateTimeFormat(undefined, DATE_OPTIONS).format(new Date(p.created_at))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
