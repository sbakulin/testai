import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload(): void;
}

/** Загружает данные при смене `key` и по `reload()`. Результат устаревшего запроса игнорируется. */
export function useResource<T>(key: string, fetcher: () => Promise<T>): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let current = true;
    setLoading(true);
    fetcherRef
      .current()
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
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload };
}
