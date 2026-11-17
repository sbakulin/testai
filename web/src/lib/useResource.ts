import { useCallback, useEffect, useState } from 'react';
import { apiGet } from './api';

export interface Resource<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload(): void;
}

export interface ResourceOptions {
  params?: Record<string, string>;
}

/** GET-запрос к API при смене адреса или параметров и по `reload()`. Результат устаревшего запроса игнорируется. */
export function useResource<T>(url: string, options?: ResourceOptions): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    apiGet<T>(url, options?.params)
      .then((value) => {
        if (!current) return;
        setData(value);
        setError(undefined);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [url, options, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload };
}
