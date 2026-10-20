import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentPanel } from './PaymentPanel';
import type { Payment, PaymentDetails } from '../lib/api';

const base = { account_id: 'acc_1', provider_payment_id: 'p', created_at: '2025-01-02T10:00:00.000Z', updated_at: '2025-01-02T10:00:00.000Z' };
const pay1: Payment = { ...base, id: 'pay_1', amount_minor: 100000, status: 'succeeded' };
const pay2: Payment = { ...base, id: 'pay_2', amount_minor: 50000, status: 'pending' };

function details(p: Payment, refunds: PaymentDetails['refunds'] = []): PaymentDetails {
  return { ...p, refunds };
}
function refund(id: string, amount: number, status: string) {
  return { id, payment_id: 'pay_1', amount_minor: amount, status, created_at: '', updated_at: '' };
}

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const { status = 200, body } = handler(url, init) as { status?: number; body: unknown };
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('PaymentPanel', () => {
  test('shows refunds and the remaining refundable amount', async () => {
    stubFetch(() => ({
      body: details(pay1, [refund('ref_1', 30000, 'succeeded'), refund('ref_2', 10000, 'failed')]),
    }));
    render(<PaymentPanel payment={pay1} onChanged={() => {}} />);
    expect(await screen.findByText('выполнен')).not.toBeNull();
    expect(screen.getByTestId('payment-panel-id').textContent).toBe('pay_1');
    expect(screen.getByTestId('refundable').textContent).toContain('700,00');
    expect(screen.queryByTestId('refund-open')).not.toBeNull();
  });

  test('no refund button for a payment that is not succeeded', async () => {
    stubFetch(() => ({ body: details(pay2) }));
    render(<PaymentPanel payment={pay2} onChanged={() => {}} />);
    await screen.findByTestId('payment-panel');
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
    expect(screen.queryByTestId('refund-open')).toBeNull();
  });

  test('submitting a refund closes the form, reloads and calls onChanged', async () => {
    const user = userEvent.setup();
    let refunds: PaymentDetails['refunds'] = [];
    const fn = stubFetch((url, init) => {
      if (init?.method === 'POST') {
        refunds = [refund('ref_1', 20000, 'processing')];
        return { status: 201, body: refunds[0] };
      }
      return { body: details(pay1, refunds) };
    });
    const onChanged = vi.fn();
    render(<PaymentPanel payment={pay1} onChanged={onChanged} />);
    await user.click(await screen.findByTestId('refund-open'));
    await user.type(screen.getByTestId('refund-amount'), '200');
    await user.click(screen.getByTestId('refund-submit'));

    expect(await screen.findByText('в обработке')).not.toBeNull();
    expect(screen.queryByTestId('refund-amount')).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true);
  });

  test('polls while a refund is processing and notifies when it finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let status = 'processing';
    stubFetch(() => ({ body: details(pay1, [refund('ref_1', 20000, status)]) }));
    const onChanged = vi.fn();
    render(<PaymentPanel payment={pay1} onChanged={onChanged} />);
    await screen.findByText('в обработке');
    expect(onChanged).not.toHaveBeenCalled();

    status = 'succeeded';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await screen.findByText('выполнен');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test('stays mounted when the payment changes and closes an open form', async () => {
    const user = userEvent.setup();
    const other: Payment = { ...pay1, id: 'pay_3' };
    stubFetch((url) => ({ body: details(url.endsWith('pay_3') ? other : pay1) }));
    const { rerender } = render(<PaymentPanel payment={pay1} onChanged={() => {}} />);
    const panel = await screen.findByTestId('payment-panel');
    await user.click(await screen.findByTestId('refund-open'));
    expect(screen.queryByTestId('refund-amount')).not.toBeNull();

    rerender(<PaymentPanel payment={other} onChanged={() => {}} />);
    expect(screen.getByTestId('payment-panel')).toBe(panel);
    await waitFor(() => expect(screen.getByTestId('payment-panel-id').textContent).toBe('pay_3'));
    expect(screen.queryByTestId('refund-amount')).toBeNull();
  });
});
