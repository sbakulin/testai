import { act, renderHook, waitFor } from '@testing-library/react';
import { useResource } from './useResource';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(impl: (url: string) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const SEARCH = { params: { q: 'pay_1' } };

afterEach(() => vi.unstubAllGlobals());

describe('useResource', () => {
  test('useResource fetches once per url and again on reload', async () => {
    const fn = stubFetch(async (url) => json(url));
    const { result, rerender } = renderHook(({ url }) => useResource<string>(url), {
      initialProps: { url: '/a' },
    });
    await waitFor(() => expect(result.current.data).toBe('/api/a'));
    expect(fn).toHaveBeenCalledTimes(1);

    rerender({ url: '/a' });
    expect(fn).toHaveBeenCalledTimes(1);

    act(() => result.current.reload());
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ url: '/b' });
    await waitFor(() => expect(result.current.data).toBe('/api/b'));
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('passes params as the query string', async () => {
    const fn = stubFetch(async (url) => json(url));
    const { result, rerender } = renderHook(() => useResource<string>('/accounts/acc_1/payments', SEARCH));
    await waitFor(() => expect(result.current.data).toBe('/api/accounts/acc_1/payments?q=pay_1'));
    rerender();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('ignores the result of an older request and keeps data while reloading', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const queue = [first, second];
    stubFetch(() => queue.shift()!.promise);
    const { result, rerender } = renderHook(({ url }) => useResource<string>(url), {
      initialProps: { url: '/a' },
    });
    rerender({ url: '/b' });
    await act(async () => second.resolve(json('new')));
    await waitFor(() => expect(result.current.data).toBe('new'));
    await act(async () => first.resolve(json('old')));
    expect(result.current.data).toBe('new');
  });

  test('keeps previous data visible while loading and exposes errors', async () => {
    const d = deferred<Response>();
    let slow = false;
    stubFetch(async (url) => {
      if (url === '/api/bad') return json({ error: 'boom' }, 500);
      return slow ? d.promise : json('x');
    });
    const { result } = renderHook(() => useResource<string>('/k'));
    await waitFor(() => expect(result.current.data).toBe('x'));
    slow = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.data).toBe('x');
    await act(async () => d.resolve(json('y')));
    await waitFor(() => expect(result.current.data).toBe('y'));

    const bad = renderHook(() => useResource<string>('/bad'));
    await waitFor(() => expect(bad.result.current.error?.message).toBe('boom'));
  });
});
