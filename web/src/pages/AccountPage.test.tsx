import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AccountPage } from './AccountPage';
import App from '../App';

function payments(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `pay_${i}`,
    account_id: 'acc_1',
    amount_minor: 10000 + i,
    status: 'succeeded',
    provider_payment_id: `p_${i}`,
    created_at: '2025-01-02T10:00:00.000Z',
    updated_at: '2025-01-02T10:00:00.000Z',
  }));
}

function stubApi(count: number) {
  const fn = vi.fn(async (url: string) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.endsWith('/balance')) return json({ account_id: 'acc_1', balance_minor: 15000000, balance: '150000.00' });
    if (url.includes('/payments?q=')) {
      const q = decodeURIComponent(url.split('q=')[1]);
      return json(payments(count).filter((p) => p.id.includes(q)));
    }
    if (url.includes('/accounts') && url.endsWith('/accounts'))
      return json([{ id: 'acc_1', owner_name: 'ООО Ромашка', balance_minor: 15000000, payments_count: count }]);
    if (url.startsWith('/api/payments/')) {
      const id = url.split('/').pop()!;
      return json({ ...payments(count).find((p) => p.id === id), refunds: [] });
    }
    return json({ error: 'not_found' }, 404);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounts/acc_1']}>
      <Routes>
        <Route path="/accounts/:id" element={<AccountPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('AccountPage', () => {
  test('AccountPage renders every payment row and the count', async () => {
    stubApi(300);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('payments-count').textContent).toContain('300'));
    expect(document.querySelectorAll('[data-testid^="payment-row-"]').length).toBe(300);
    expect(screen.getByText(/150 000,00/)).not.toBeNull();
  });

  test('selecting a payment shows it in the panel', async () => {
    const user = userEvent.setup();
    stubApi(5);
    renderPage();
    await user.click(await screen.findByTestId('payment-row-pay_3'));
    await waitFor(() => expect(screen.getByTestId('payment-panel-id').textContent).toBe('pay_3'));
    expect(screen.getByTestId('payment-row-pay_3').className).toContain('selected');
  });

  test('search passes q to the server', async () => {
    const user = userEvent.setup();
    const fn = stubApi(12);
    renderPage();
    await screen.findByTestId('payment-row-pay_11');
    await user.type(screen.getByTestId('payments-search'), 'pay_11');
    await waitFor(() => expect(screen.getByTestId('payments-count').textContent).toContain('1'));
    expect(fn.mock.calls.some(([u]) => String(u).includes('q=pay_11'))).toBe(true);
    expect(document.querySelectorAll('[data-testid^="payment-row-"]').length).toBe(1);
  });

  test('503 not_connected shows the connect hint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_connected' }), { status: 503 })));
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    const el = await screen.findByTestId('not-connected');
    expect(el.textContent).toContain('Введите код: npm run connect -- КОД');
  });
});
