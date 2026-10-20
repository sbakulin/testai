import { useEffect, useRef, useState } from 'react';
import { createRefund, getPayment, isNotConnected, type Payment } from '../lib/api';
import { formatDate, paymentStatusLabel, refundStatusLabel } from '../lib/format';
import { formatSums } from '../lib/money';
import { useResource } from '../lib/useResource';
import { NotConnected } from './NotConnected';
import { RefundForm } from './RefundForm';

interface Props {
  payment: Payment;
  onChanged(): void;
}

const POLL_INTERVAL_MS = 2000;

export function PaymentPanel({ payment, onChanged }: Props) {
  const { data, error, reload } = useResource(`payment:${payment.id}`, () => getPayment(payment.id));
  const [formFor, setFormFor] = useState<string>();

  // Пока идёт загрузка выбранного платежа, в data ещё лежит предыдущий — его возвраты не показываем
  const details = data?.id === payment.id ? data : undefined;
  const refunds = details?.refunds;
  const processing = refunds?.some((r) => r.status === 'processing') ?? false;
  const refunded = (refunds ?? [])
    .filter((r) => r.status === 'processing' || r.status === 'succeeded')
    .reduce((sum, r) => sum + r.amount_minor, 0);
  const remaining = payment.amount_minor - refunded;
  const canRefund = payment.status === 'succeeded' && remaining > 0 && refunds !== undefined;

  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const seen = useRef<{ id: string; processing: boolean } | undefined>(undefined);

  useEffect(() => {
    if (!details) return;
    if (seen.current?.id === details.id && seen.current.processing && !processing) {
      onChangedRef.current();
    }
    seen.current = { id: details.id, processing };
  }, [details, processing]);

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(reload, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [processing, reload]);

  async function submit(amountMinor: number) {
    await createRefund(payment.id, amountMinor);
    setFormFor(undefined);
    reload();
    onChanged();
  }

  if (isNotConnected(error)) return <NotConnected />;

  return (
    <aside className="panel" data-testid="payment-panel">
      <h2 data-testid="payment-panel-id">{payment.id}</h2>
      <dl>
        <dt>Статус</dt>
        <dd>
          <span className={`status status-${payment.status}`}>{paymentStatusLabel(payment.status)}</span>
        </dd>
        <dt>Сумма</dt>
        <dd>{formatSums(payment.amount_minor)}</dd>
        <dt>Создан</dt>
        <dd>{formatDate(payment.created_at)}</dd>
      </dl>

      <h3>Возвраты</h3>
      {error && !details && <p className="form-error">Не удалось загрузить возвраты</p>}
      {!details && !error && <p className="muted">Загрузка…</p>}
      {refunds && refunds.length === 0 && <p className="muted">Возвратов нет</p>}
      {refunds && refunds.length > 0 && (
        <ul className="refunds">
          {refunds.map((r) => (
            <li key={r.id}>
              <span>{formatSums(r.amount_minor)}</span>
              <span className={`status status-refund-${r.status}`}>{refundStatusLabel(r.status)}</span>
              <span className="muted">{formatDate(r.created_at)}</span>
            </li>
          ))}
        </ul>
      )}

      {refunds && payment.status === 'succeeded' && (
        <p>
          Можно вернуть: <strong data-testid="refundable">{formatSums(Math.max(remaining, 0))}</strong>
        </p>
      )}

      {canRefund && formFor !== payment.id && (
        <button type="button" className="primary" data-testid="refund-open" onClick={() => setFormFor(payment.id)}>
          Оформить возврат
        </button>
      )}
      {canRefund && formFor === payment.id && (
        <RefundForm maxMinor={remaining} onSubmit={submit} onCancel={() => setFormFor(undefined)} />
      )}
    </aside>
  );
}
