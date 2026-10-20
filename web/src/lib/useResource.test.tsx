import { act, renderHook, waitFor } from '@testing-library/react';
import { useResource } from './useResource';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('useResource', () => {
  test('useResource fetches once per key and again on reload', async () => {
    const fetcher = vi.fn(async () => 'value');
    const { result, rerender } = renderHook(({ k }) => useResource(k, fetcher), {
      initialProps: { k: 'a' },
    });
    await waitFor(() => expect(result.current.data).toBe('value'));
    expect(fetcher).toHaveBeenCalledTimes(1);

    rerender({ k: 'a' });
    expect(fetcher).toHaveBeenCalledTimes(1);

    act(() => result.current.reload());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ k: 'b' });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  test('a new fetcher identity alone does not refetch', async () => {
    const calls = vi.fn();
    const { result, rerender } = renderHook(
      ({ n }) =>
        useResource('k', async () => {
          calls();
          return n;
        }),
      { initialProps: { n: 1 } },
    );
    await waitFor(() => expect(result.current.data).toBe(1));
    rerender({ n: 2 });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe(1);
  });

  test('ignores the result of an older request and keeps data while reloading', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const queue = [first, second];
    const fetcher = vi.fn(() => queue.shift()!.promise);
    const { result, rerender } = renderHook(({ k }) => useResource(k, fetcher), {
      initialProps: { k: 'a' },
    });
    rerender({ k: 'b' });
    await act(async () => second.resolve('new'));
    await waitFor(() => expect(result.current.data).toBe('new'));
    await act(async () => first.resolve('old'));
    expect(result.current.data).toBe('new');
  });

  test('keeps previous data visible while loading and exposes errors', async () => {
    const d = deferred<string>();
    let fail = false;
    const fetcher = vi.fn(() => (fail ? d.promise : Promise.resolve('x')));
    const { result } = renderHook(() => useResource('k', fetcher));
    await waitFor(() => expect(result.current.data).toBe('x'));
    fail = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.data).toBe('x');
    await act(async () => d.resolve('y'));
    await waitFor(() => expect(result.current.data).toBe('y'));

    const bad = renderHook(() => useResource('k', () => Promise.reject(new Error('boom'))));
    await waitFor(() => expect(bad.result.current.error?.message).toBe('boom'));
  });
});
