import { renderHook } from '@testing-library/react';
import { useStableCallback } from './useStableCallback';

describe('useStableCallback', () => {
  test('returns the same function across renders', () => {
    const { result, rerender } = renderHook(({ n }) => useStableCallback(() => n), { initialProps: { n: 1 } });
    const first = result.current;
    rerender({ n: 2 });
    rerender({ n: 3 });
    expect(result.current).toBe(first);
  });

  test('calls the handler with its arguments', () => {
    const fn = vi.fn((a: number, b: string) => `${a}${b}`);
    const { result } = renderHook(() => useStableCallback(fn));
    expect(result.current(1, 'x')).toBe('1x');
    expect(fn).toHaveBeenCalledWith(1, 'x');
  });
});
