"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Link2,
  Loader2,
  MessageCircle,
  PlugZap,
  Save,
  Trash2,
  Unplug,
} from "lucide-react";
import { getDataApi } from "@/client/http-electron-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QqBotMessage, QqBotPhase, QqBotSettings, QqBotStatus } from "@/types/electron";

const api = getDataApi();

const EMPTY_STATUS: QqBotStatus = {
  channel: "qqbot",
  phase: "idle",
  connected: false,
  error: null,
  hasCredentials: false,
  messageCount: 0,
};

const DEFAULT_SETTINGS: QqBotSettings = {
  appId: "",
  clientSecret: "",
  apiBase: "https://api.sgroup.qq.com",
  intents: 1 << 25,
  autoConnect: true,
  autoReplyEnabled: false,
  autoReplyText: "消息已收到。",
  accessMode: "open",
  allowUserIds: [],
  allowGroupIds: [],
  boundUserIds: [],
  adminUserIds: [],
  adminRemarks: {},
  reminderEnabled: true,
  lastReminderDate: null,
};

const PHASE_LABEL: Record<QqBotPhase, string> = {
  idle: "未连接",
  connecting: "连接中",
  ready: "已就绪",
  reconnecting: "重连中",
  error: "异常",
};

export function QqBotPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [status, setStatus] = useState<QqBotStatus>(EMPTY_STATUS);
  const [settings, setSettings] = useState<QqBotSettings>(DEFAULT_SETTINGS);
  const [messages, setMessages] = useState<QqBotMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const refreshMessages = useCallback(async () => {
    if (!api) return;
    const result = await api.getQqBotMessages();
    if (result.success) setMessages(result.data || []);
  }, []);

  const refreshAll = useCallback(async () => {
    if (!api) {
      setError("当前环境不支持 QQ 机器人接口");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [st, se] = await Promise.all([api.getQqBotStatus(), api.getQqBotSettings()]);
      if (!st.success) throw new Error(st.error || "读取状态失败");
      if (!se.success) throw new Error(se.error || "读取设置失败");
      setStatus(st.data);
      setSettings({ ...DEFAULT_SETTINGS, ...se.data });
      await refreshMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [refreshMessages]);

  useEffect(() => {
    if (!api) {
      setLoading(false);
      setError("当前环境不支持 QQ 机器人接口");
      return;
    }
    void refreshAll();
    const offStatus = api.onQqBotStatus((next) => setStatus(next));
    const offMessage = api.onQqBotMessage(() => {
      void refreshMessages();
    });
    const offCleared = api.onQqBotMessagesCleared
      ? api.onQqBotMessagesCleared(() => setMessages([]))
      : () => undefined;
    return () => {
      offStatus();
      offMessage();
      offCleared();
    };
  }, [refreshAll, refreshMessages]);

  const phaseTone = useMemo(() => {
    if (status.phase === "ready") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    if (status.phase === "error") return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
    if (status.phase === "connecting" || status.phase === "reconnecting") {
      return "bg-amber-500/15 text-amber-800 dark:text-amber-200";
    }
    return "bg-muted text-muted-foreground";
  }, [status.phase]);

  async function runAction(
    name: string,
    fn: () => Promise<{ success: boolean; error?: string; data?: unknown }>
  ) {
    setBusy(name);
    setError(null);
    try {
      const result = await fn();
      if (!result.success) throw new Error(result.error || `${name} 失败`);
      if (result.data && typeof result.data === "object" && "phase" in (result.data as object)) {
        setStatus(result.data as QqBotStatus);
      }
      showToast("已完成");
      await refreshMessages();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      showToast(msg);
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    if (!api) {
      setError("当前环境不支持 QQ 机器人接口");
      return;
    }
    await runAction("save", async () => {
      const payload = {
        ...settings,
        accessMode: "open" as const,
        allowUserIds: [],
        allowGroupIds: [],
        adminUserIds: [],
        adminRemarks: {},
      };
      const result = await api.saveQqBotSettings(payload);
      if (result.success) {
        setSettings({ ...DEFAULT_SETTINGS, ...result.data });
      }
      return result;
    });
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载 QQ 机器人…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          {embedded ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn("border-0", phaseTone)}>
                {PHASE_LABEL[status.phase] || status.phase}
              </Badge>
              {status.connected ? (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="size-3" />
                  在线
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-muted-foreground">
                  离线
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                凭证与消息日志在下方；AI Key 与微信共用
              </span>
            </div>
          ) : (
            <>
              <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                <MessageCircle className="size-5 text-violet-500" />
                QQ 机器人
              </h1>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                官方 QQ 开放平台通道。业务能力与微信机器人共用（Agent / 技能 / 日报）。任意用户私聊、任意群
                @ 均可使用。需在{" "}
                <a
                  className="text-violet-600 underline underline-offset-2"
                  href="https://q.qq.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  q.qq.com
                </a>{" "}
                创建机器人，订阅「群聊@消息 / 私聊消息」，填入 AppID 与 ClientSecret。AI Key
                与微信机器人为同一套桌面配置。
              </p>
            </>
          )}
        </div>
        {!embedded ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Badge className={cn("border-0", phaseTone)}>
              {PHASE_LABEL[status.phase] || status.phase}
            </Badge>
            {status.connected ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="size-3" />
                在线
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                离线
              </Badge>
            )}
          </div>
        ) : null}
      </div>

      {(error || status.error) && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>{error || status.error}</div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4 text-violet-500" />
            开放平台凭证
          </div>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">AppID</span>
            <input
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={settings.appId}
              onChange={(e) => setSettings((s) => ({ ...s, appId: e.target.value }))}
              placeholder="从 QQ 开放平台复制"
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">ClientSecret</span>
            <input
              className="h-9 w-full rounded-md border bg-background px-3 font-mono text-sm"
              type="password"
              value={settings.clientSecret}
              onChange={(e) => setSettings((s) => ({ ...s, clientSecret: e.target.value }))}
              placeholder="保持本地加密存储前请勿泄露"
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">API Base（一般无需改）</span>
            <input
              className="h-9 w-full rounded-md border bg-background px-3 font-mono text-xs"
              value={settings.apiBase}
              onChange={(e) => setSettings((s) => ({ ...s, apiBase: e.target.value }))}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={settings.autoConnect}
                onChange={(e) => setSettings((s) => ({ ...s, autoConnect: e.target.checked }))}
              />
              启动后自动连接
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={Boolean(settings.reminderEnabled)}
                onChange={(e) => setSettings((s) => ({ ...s, reminderEnabled: e.target.checked }))}
              />
              午夜提醒（每天 0 点后发「请发送音浪文件」）
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={settings.autoReplyEnabled}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, autoReplyEnabled: e.target.checked }))
                }
              />
              未命中命令时自动回复
            </label>
          </div>

          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">自动回复文案</span>
            <input
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={settings.autoReplyText}
              onChange={(e) => setSettings((s) => ({ ...s, autoReplyText: e.target.value }))}
              disabled={!settings.autoReplyEnabled}
            />
          </label>

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            开放访问：任意用户私聊、任意群 @ 均可使用（无白名单 / 无管理员）。午夜提醒发给全部已对接用户。
            {settings.boundUserIds?.length
              ? ` 当前已对接 ${settings.boundUserIds.length} 人。`
              : " 尚未有对接用户。"}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={() => void handleSave()} disabled={busy === "save"}>
              {busy === "save" ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <Save className="mr-1 size-3.5" />
              )}
              保存设置
            </Button>
            <Button
              size="sm"
              variant="default"
              className="bg-violet-600 hover:bg-violet-600/90"
              disabled={busy === "connect" || status.connected}
              onClick={() => {
                if (!api) return;
                void runAction("connect", () => api.connectQqBot());
              }}
            >
              {busy === "connect" ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <PlugZap className="mr-1 size-3.5" />
              )}
              连接
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "disconnect" || (!status.connected && status.phase === "idle")}
              onClick={() => {
                if (!api) return;
                void runAction("disconnect", () => api.disconnectQqBot());
              }}
            >
              {busy === "disconnect" ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <Unplug className="mr-1 size-3.5" />
              )}
              断开
            </Button>
          </div>
        </section>

        <section className="flex max-h-[min(60vh,560px)] min-h-[280px] flex-col rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">消息日志</div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {status.messageCount || messages.length} 条
                {status.appId ? ` · App ${status.appId}` : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!api) return;
                  void runAction("clear", async () => {
                    const result = await api.clearQqBotMessages();
                    if (result.success) setMessages([]);
                    return result;
                  });
                }}
              >
                <Trash2 className="mr-1 size-3.5" />
                清空
              </Button>
            </div>
          </div>
          <div className="flex-1 space-y-2 overflow-auto rounded-lg border bg-muted/20 p-2">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[160px] items-center justify-center text-xs text-muted-foreground">
                连接后，群@或私聊消息会显示在这里
              </div>
            ) : (
              messages
                .slice()
                .reverse()
                .map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs",
                      m.direction === "in"
                        ? "border-violet-200/80 bg-violet-50/70 dark:border-violet-900 dark:bg-violet-950/30"
                        : "bg-background"
                    )}
                  >
                    <div className="mb-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>{m.direction === "in" ? "收" : "发"}</span>
                      <span>{m.chatType || "-"}</span>
                      {m.fromUserId ? <span>uid:{m.fromUserId}</span> : null}
                      {m.groupId ? <span>gid:{m.groupId}</span> : null}
                      {m.at ? <span>{m.at}</span> : null}
                    </div>
                    <div className="whitespace-pre-wrap break-words text-sm">{m.text || ""}</div>
                  </div>
                ))
            )}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
            能力说明：文字指令、CSV 导入与 AI 技能与微信侧一致；官方通道对主动推送/随意文件有限额，
            图片（日报）走被动回复窗口更稳。发文件前可先说「24号数据」指定导入日。
          </p>
        </section>
      </div>

      {toast ? (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border bg-background px-3 py-2 text-sm shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
