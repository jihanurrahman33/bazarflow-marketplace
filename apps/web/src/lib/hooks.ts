"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type ApiMeta } from "./api";

export interface Resource<T> {
  data: T | undefined;
  meta: ApiMeta | undefined;
  error: ApiError | undefined;
  loading: boolean;
  /** True while re-fetching with data already on screen (no flicker back to a skeleton). */
  refreshing: boolean;
  reload: () => void;
}

/** GET a resource. Pass null to skip. Stale responses from an earlier path never overwrite a newer one. */
export function useApi<T>(path: string | null): Resource<T> {
  const [state, setState] = useState<{ data?: T; meta?: ApiMeta; error?: ApiError; loading: boolean }>({ loading: path !== null });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (path === null) return;
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    api<T>(path)
      .then((r) => mine === seq.current && setState({ data: r.data, meta: r.meta, loading: false }))
      .catch((e) => mine === seq.current && setState((s) => ({ data: s.data, loading: false, error: e instanceof ApiError ? e : new ApiError(0, "NETWORK", "Network error") })));
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, meta: state.meta, error: state.error, loading: state.loading && state.data === undefined, refreshing: state.loading && state.data !== undefined, reload };
}

export interface Paged<T> {
  items: T[];
  error: ApiError | undefined;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  meta: ApiMeta | undefined;
}

/** Cursor-paginated list. Changing `path` (filters) restarts from the first page. */
export function usePaged<T>(path: string | null): Paged<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(path !== null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [meta, setMeta] = useState<ApiMeta>();
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  const fetchPage = useCallback(
    (after: string | null, append: boolean) => {
      if (path === null) return;
      const mine = ++seq.current;
      const sep = path.includes("?") ? "&" : "?";
      api<T[]>(after ? `${path}${sep}cursor=${encodeURIComponent(after)}` : path)
        .then((r) => {
          if (mine !== seq.current) return;
          setItems((prev) => (append ? [...prev, ...r.data] : r.data));
          setCursor(r.meta.nextCursor ?? null);
          setHasMore(!!r.meta.hasMore);
          setMeta(r.meta);
          setError(undefined);
        })
        .catch((e) => mine === seq.current && setError(e instanceof ApiError ? e : new ApiError(0, "NETWORK", "Network error")))
        .finally(() => {
          if (mine !== seq.current) return;
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [path],
  );

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setLoading(path !== null);
    fetchPage(null, false);
  }, [path, tick, fetchPage]);

  return {
    items, error, loading, loadingMore, hasMore, meta,
    loadMore: () => {
      if (!cursor || loadingMore) return;
      setLoadingMore(true);
      fetchPage(cursor, true);
    },
    reload: () => setTick((t) => t + 1),
  };
}

/** Run a mutation with pending/error state and double-submit protection. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError>();
  const inflight = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn; // always call the latest closure, but keep `run` referentially stable
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (inflight.current) return undefined;
      inflight.current = true;
      setPending(true);
      setError(undefined);
      try {
        return await fnRef.current(...args);
      } catch (e) {
        setError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Something went wrong."));
        return undefined;
      } finally {
        inflight.current = false;
        setPending(false);
      }
    },
    [],
  );
  return { run, pending, error, clearError: () => setError(undefined) };
}
