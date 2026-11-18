import { useEffect, useRef, useState } from 'react';
import { createRefund, isNotConnected, type Payment, type PaymentDetails } from '../lib/api';
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
  const { data, error, reload } = useResource<PaymentDetails>(`/payments/${payment.id}`);
  const [formFor, setFormFor] = useState<string>();

  // Пока идёт загрузка выбранного платежа, в data ещё лежит предыдущий — его возвраты не показываем
  const details = data?.id === payment.id ? data : undefined;
  const refunds = details?.refunds;
  const shown = details ?? payment;
  const processing = refunds?.some((r) => r.status === 'processing') ?? false;
  const refunded = (refunds ?? [])
    .filter((r) => r.status === 'processing' || r.status === 'succeeded')
    .reduce((sum, r) => sum + r.amount_minor, 0);
  const remaining = shown.amount_minor - refunded;
  const canRefund = shown.status === 'succeeded' && remaining > 0 && refunds !== undefined;

  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const seen = useRef<{ id: string; signature: string } | undefined>(undefined);

  useEffect(() => {
    setFormFor(undefined);
  }, [payment.id]);

  // Любое изменение набора статусов возвратов выбранного платежа — повод обновить остаток на счёте
  useEffect(() => {
    if (!details) return;
    const signature = details.refunds.map((r) => `${r.id}:${r.status}`).join(',');
    if (seen.current?.id === details.id && seen.current.signature !== signature) {
      onChangedRef.current();
    }
    seen.current = { id: details.id, signature };
  }, [details]);

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(reload, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [processing, reload]);

  async function submit(amountMinor: number) {
    try {
      await createRefund(payment.id, amountMinor);
      setFormFor(undefined);
    } finally {
      // Возврат мог быть создан, даже если запрос завершился ошибкой
      reload();
    }
  }

  if (isNotConnected(error)) return <NotConnected />;

  return (
    <aside className="panel" data-testid="payment-panel">
      <h2 data-testid="payment-panel-id">{payment.id}</h2>
      <dl>
        <dt>Статус</dt>
        <dd>
          <span className={`status status-${shown.status}`}>{paymentStatusLabel(shown.status)}</span>
        </dd>
        <dt>Сумма</dt>
        <dd>{formatSums(shown.amount_minor)}</dd>
        <dt>Создан</dt>
        <dd>{formatDate(shown.created_at)}</dd>
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

      {refunds && shown.status === 'succeeded' && (
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
        <RefundForm paymentId={payment.id} maxMinor={remaining} onSubmit={submit} onCancel={() => setFormFor(undefined)} />
      )}
    </aside>
  );
}
