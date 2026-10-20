import { ApiError, createRefund, listPayments } from './api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  test('listPayments prefixes /api and encodes q', async () => {
    const fn = mockFetch(200, []);
    await listPayments('acc_1', 'a b');
    expect(fn).toHaveBeenCalledWith('/api/accounts/acc_1/payments?q=a%20b', undefined);
  });

  test('createRefund posts amount_minor', async () => {
    const fn = mockFetch(201, { id: 'ref_1' });
    await createRefund('pay_1', 500);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/payments/pay_1/refunds');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ amount_minor: 500 }));
  });

  test('errors carry status and code', async () => {
    mockFetch(422, { error: 'refund_exceeds_payment' });
    await expect(createRefund('pay_1', 5)).rejects.toMatchObject({
      status: 422,
      code: 'refund_exceeds_payment',
    });
    mockFetch(503, { error: 'not_connected' });
    await expect(listPayments('a', '')).rejects.toBeInstanceOf(ApiError);
  });
});
