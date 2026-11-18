import { memo, useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { formatSums, parseSumsInput } from '../lib/money';

interface Props {
  paymentId: string;
  maxMinor: number;
  onSubmit(amountMinor: number): Promise<void>;
  onCancel(): void;
}

const UNKNOWN_OUTCOME = 'Исход неизвестен: проверьте список возвратов, прежде чем повторять';

const SUBMIT_ERRORS: Record<string, string> = {
  refund_exceeds_payment: 'Сумма возврата больше остатка по платежу',
  payment_not_succeeded: 'Платёж не оплачен, вернуть деньги нельзя',
  provider_rejected: 'Провайдер отклонил возврат',
  provider_error: UNKNOWN_OUTCOME,
  stand_unavailable: UNKNOWN_OUTCOME,
};

const GENERIC_ERROR = 'Не удалось оформить возврат, попробуйте ещё раз';

// Введённая, но не отправленная сумма по каждому платежу: форма закрывается при выборе другого платежа
const drafts = new Map<string, string>();

export const RefundForm = memo(function RefundForm({ paymentId, maxMinor, onSubmit, onCancel }: Props) {
  const [text, setText] = useState(() => drafts.get(paymentId) ?? '');
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const amount = parseSumsInput(text);
    if (amount === null) {
      setMessage('Введите положительную сумму, не более двух знаков после запятой');
      return;
    }
    if (amount > maxMinor) {
      setMessage(`Сумма не должна превышать ${formatSums(maxMinor)}`);
      return;
    }
    setMessage(undefined);
    setPending(true);
    try {
      await onSubmit(amount);
      drafts.delete(paymentId);
    } catch (err) {
      setMessage((err instanceof ApiError && SUBMIT_ERRORS[err.code]) || GENERIC_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="refund-form" onSubmit={handleSubmit} noValidate>
      <label>
        Сумма возврата
        <input
          data-testid="refund-amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder={`до ${formatSums(maxMinor)}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            drafts.set(paymentId, e.target.value);
            setMessage(undefined);
          }}
        />
      </label>
      {message && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="primary" data-testid="refund-submit" disabled={pending}>
          Вернуть
        </button>
        <button type="button" data-testid="refund-cancel" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
});
