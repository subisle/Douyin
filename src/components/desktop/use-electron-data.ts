"use client";

import { useCallback, useEffect, useState } from "react";
import { getDataApi } from "@/client/http-electron-api";
import type { IpcResult } from "@/types/electron";

export type DataState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** 数据 API 不存在。Web 服务器模式会自动 fallback 到 HTTP API。 */
  unavailable: boolean;
  reload: () => void;
};

/**
 * 拉取数据。Electron 桌面端优先走 IPC；普通浏览器/服务器版本走 HTTP API。
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
    const api = getDataApi();
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
