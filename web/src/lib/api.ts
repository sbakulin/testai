export interface Account {
  id: string;
  owner_name: string;
  balance_minor: number;
  payments_count: number;
}

export interface Balance {
  account_id: string;
  balance_minor: number;
  balance: string;
}

export interface Payment {
  id: string;
  account_id: string;
  amount_minor: number;
  status: string;
  provider_payment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Refund {
  id: string;
  payment_id: string;
  amount_minor: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentDetails extends Payment {
  refunds: Refund[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const isNotConnected = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 503 && err.code === 'not_connected';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const code = (body as { error?: unknown } | undefined)?.error;
    throw new ApiError(res.status, typeof code === 'string' ? code : 'unknown_error');
  }
  return body as T;
}

function withParams(path: string, params?: Record<string, string>): string {
  if (!params) return path;
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return query ? `${path}?${query}` : path;
}

export const apiGet = <T>(path: string, params?: Record<string, string>): Promise<T> =>
  request(withParams(path, params));

export const createRefund = (paymentId: string, amountMinor: number): Promise<Refund> =>
  request(`/payments/${encodeURIComponent(paymentId)}/refunds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount_minor: amountMinor }),
  });
