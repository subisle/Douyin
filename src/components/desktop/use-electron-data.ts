"use client";

import { useCallback, useEffect, useState } from "react";
import type { IpcResult } from "@/types/electron";

export type DataState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** electronAPI 不存在（浏览器开发模式） */
  unavailable: boolean;
  reload: () => void;
};

/**
 * 通过 Electron IPC 拉取数据。浏览器模式下 electronAPI 不存在，
 * 返回 unavailable=true，由页面决定展示占位。
 */
export function useElectronData<T>(
  fetcher: (api: ElectronAPI) => Promise<IpcResult<T>>,
  deps: unknown[] = []
): DataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (!api) {
      setUnavailable(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcher(api)
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          setData(res.data);
        } else {
          setError(res.error);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  // 监听全局刷新事件
  useEffect(() => {
    const handler = () => reload();
    window.addEventListener("app:refresh", handler);
    return () => window.removeEventListener("app:refresh", handler);
  }, [reload]);

  return { data, loading, error, unavailable, reload };
}
