"use client";

import { useState, useEffect, useCallback } from "react";
import { Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { getDataApi } from "@/client/http-electron-api";

export function LockScreen({ onUnlocked }: { onUnlocked: (role: "admin" | "guest") => void }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const api = getDataApi();
    if (!api?.hasAppPassword) {
      setChecking(false);
      return;
    }
    api.hasAppPassword().then((result) => {
      if (result.success && !result.data.hasPassword) {
        // 没设置密码，直接进入（默认 admin）
        onUnlocked("admin");
      } else {
        setChecking(false);
      }
    }).catch(() => setChecking(false));
  }, [onUnlocked]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const api = getDataApi();
      const result = await api?.verifyAppPassword(password);
      if (result?.success && result.data.ok) {
        onUnlocked(result.data.role);
      } else {
        setError(result?.success ? "密码错误" : result?.error || "验证失败");
      }
    } catch {
      setError("验证失败，请重试");
    } finally {
      setLoading(false);
    }
  }, [password, loading, onUnlocked]);

  if (checking) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-background">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-10 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -right-24 bottom-0 size-80 rounded-full bg-chart-2/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm px-6">
        <div className="flex flex-col items-center gap-6">
          {/* 图标 */}
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
            <Lock className="size-8 text-primary" />
          </div>

          {/* 标题 */}
          <div className="text-center">
            <h1 className="text-2xl font-bold">鹏仔传媒</h1>
            <p className="mt-1 text-sm text-muted-foreground">主播数据管理系统</p>
          </div>

          {/* 密码输入表单 */}
          <form onSubmit={handleSubmit} className="w-full space-y-3">
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                autoFocus
                disabled={loading}
                className="h-12 w-full rounded-xl border border-input bg-background px-4 pr-11 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="h-12 w-full rounded-xl bg-primary text-primary-foreground text-base font-semibold transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="mx-auto size-5 animate-spin" />
              ) : (
                "进入系统"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
