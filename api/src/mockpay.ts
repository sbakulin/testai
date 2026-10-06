export class StandUnavailableError extends Error {
  constructor(message = 'stand is unavailable') {
    super(message);
    this.name = 'StandUnavailableError';
  }
}

export class MockpayError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'MockpayError';
  }
}

export interface MockpayPayment {
  id: string;
  status: string;
}

export interface MockpayClient {
  createPayment(input: { merchant_reference: string; amount: string }): Promise<MockpayPayment>;
  getPayment(id: string): Promise<MockpayPayment>;
  createRefund(input: {
    payment_id: string;
    amount: string;
    idempotency_key: string;
  }): Promise<MockpayPayment>;
}

const TIMEOUT_MS = 5000;

export function createMockpayClient(baseUrl: string): MockpayClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new StandUnavailableError(err instanceof Error ? err.message : undefined);
    }
    if (res.status === 403) throw new StandUnavailableError('stand rejected the request');
    if (!res.ok) throw new MockpayError(res.status, `mockpay ${method} ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    createPayment: (input) => request('POST', '/payments', { ...input, currency: 'UZS' }),
    getPayment: (id) => request('GET', `/payments/${encodeURIComponent(id)}`),
    createRefund: (input) => request('POST', '/refunds', input),
  };
}
