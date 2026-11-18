import { useCallback, useRef } from 'react';

/** Обработчик с постоянной ссылкой: мемоизированные дочерние компоненты не перерисовываются из-за него. */
export function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}
