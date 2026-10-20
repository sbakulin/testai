import type { Payment } from '../lib/api';
import { formatDate, paymentStatusLabel } from '../lib/format';
import { formatSums } from '../lib/money';

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
            <td>{formatDate(p.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
