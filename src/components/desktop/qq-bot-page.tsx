"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Link2,
  Loader2,
  MessageCircle,
  PlugZap,
  RefreshCw,
  Save,
  Trash2,
  Unplug,
} from "lucide-react";
import { getDataApi } from "@/client/http-electron-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  QqBotInstanceStatus,
  QqBotMessage,
  QqBotPhase,
  QqBotSettings,
  QqBotStatus,
} from "@/types/electron";

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
  const [instances, setInstances] = useState<QqBotInstanceStatus[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [messages, setMessages] = useState<QqBotMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  /** 多实例接口可用时优先用实例接口；桌面旧版本没有则退回单实例接口 */
  const multiEnabled = typeof api?.getQqBotInstances === "function";

  const refreshInstances = useCallback(async (): Promise<QqBotInstanceStatus[]> => {
    if (!api?.getQqBotInstances) return [];
    const result = await api.getQqBotInstances();
    if (!result.success) return [];
    const list = result.data || [];
    setInstances(list);
    setSelectedKey((current) => (current && list.some((item) => item.key === current) ? current : list[0]?.key || ""));
    return list;
  }, []);

  const refreshMessages = useCallback(async () => {
    if (!api) return;
    const result = await api.getQqBotMessages();
    if (result.success) setMessages(result.data || []);
  }, []);

  const loadInstance = useCallback(
    async (key: string) => {
      if (!api) return;
      const statusResult = multiEnabled && api.getQqBotInstanceStatus
        ? await api.getQqBotInstanceStatus(key)
        : await api.getQqBotStatus();
      if (!statusResult.success) throw new Error(statusResult.error || "读取状态失败");
      setStatus(statusResult.data);

      const settingsResult = multiEnabled && api.getQqBotInstanceSettings
        ? await api.getQqBotInstanceSettings(key)
        : await api.getQqBotSettings();
      if (!settingsResult.success) throw new Error(settingsResult.error || "读取设置失败");
      setSettings({ ...DEFAULT_SETTINGS, ...settingsResult.data });
      await refreshMessages();
    },
    [multiEnabled, refreshMessages]
  );

  const refreshAll = useCallback(async () => {
    if (!api) {
      setError("当前环境不支持 QQ 机器人接口");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await refreshInstances();
      await loadInstance(selectedKey || list[0]?.key || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [loadInstance, refreshInstances, selectedKey]);

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
    // 只在挂载时初始化一次；切换实例由 handleSelectInstance 主动触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSelectInstance(key: string) {
    setSelectedKey(key);
    setBusy(`select:${key}`);
    setError(null);
    try {
      await loadInstance(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleInstanceAction(key: string, action: "connect" | "disconnect") {
    if (!api) return;
    setBusy(`${action}:${key}`);
    setError(null);
    try {
      const instanceFn = action === "connect" ? api.connectQqBotInstance : api.disconnectQqBotInstance;
      const result = multiEnabled && key && instanceFn
        ? await instanceFn.call(api, key)
        : action === "connect"
          ? await api.connectQqBot()
          : await api.disconnectQqBot();
      if (!result.success) throw new Error(result.error || `${action} 失败`);
      showToast(action === "connect" ? "已发起连接" : "已断开");
      await refreshInstances();
      if (key === selectedKey) await loadInstance(key);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      showToast(msg);
    } finally {
      setBusy(null);
    }
  }

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
      const result = multiEnabled && selectedKey && api.saveQqBotInstanceSettings
        ? await api.saveQqBotInstanceSettings(selectedKey, payload)
        : await api.saveQqBotSettings(payload);
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
                凭证与消息日志在下方；多机器人时每个配置一份文件
              </span>
            </div>
          ) : (
            <>
              <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                <MessageCircle className="size-5 text-violet-500" />
                QQ 机器人
              </h1>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                官方 QQ 开放平台通道。业务能力与微信机器人共用（同一套指令 / 日报）。任意用户私聊、任意群
                @ 均可使用。需在{" "}
                <a
                  className="text-violet-600 underline underline-offset-2"
                  href="https://q.qq.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  q.qq.com
                </a>{" "}
                创建机器人，订阅「群聊@消息 / 私聊消息」，填入 AppID 与 ClientSecret。
                需要同时跑多个机器人时，在 data/builtin/qq-bots/ 下每个机器人放一份 JSON 配置（appId +
                clientSecret），启动时自动逐个连接。
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

      {instances.length > 0 && (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Bot className="size-4 text-violet-500" />
            机器人实例
            <span className="text-xs font-normal text-muted-foreground">
              共 {instances.length} 个 · 一份配置（data/builtin/qq-bots/*.json）一个实例
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 px-2 text-xs"
              onClick={() => void handleSelectInstance(selectedKey)}
            >
              <RefreshCw className="mr-1 size-3.5" />
              刷新
            </Button>
          </div>
          <div className="mt-2 divide-y">
            {instances.map((item) => {
              const active = item.key === selectedKey;
              const rowBusy = busy === `connect:${item.key}` || busy === `disconnect:${item.key}`;
              return (
                <div key={item.key} className="flex flex-wrap items-center gap-2 py-2">
                  <button
                    type="button"
                    onClick={() => void handleSelectInstance(item.key)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors",
                      active ? "bg-violet-500/10" : "hover:bg-muted"
                    )}
                  >
                    <span className="truncate text-sm font-medium">{item.label || item.key}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {item.appId ? `AppID ${item.appId}` : "未配置 AppID"}
                    </span>
                    <Badge
                      className={cn(
                        "ml-1 border-0",
                        item.phase === "ready"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : item.phase === "error"
                            ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                            : "bg-muted text-muted-foreground"
                      )}
                    >
                      {PHASE_LABEL[item.phase] || item.phase}
                    </Badge>
                    {item.messageCount > 0 ? (
                      <span className="text-xs text-muted-foreground">{item.messageCount} 条消息</span>
                    ) : null}
                  </button>
                  <Button
                    size="sm"
                    variant={item.connected ? "outline" : "default"}
                    className={cn(
                      "h-7 px-2 text-xs",
                      !item.connected && "bg-violet-600 hover:bg-violet-600/90"
                    )}
                    disabled={rowBusy}
                    onClick={() => void handleInstanceAction(item.key, item.connected ? "disconnect" : "connect")}
                  >
                    {rowBusy ? (
                      <Loader2 className="mr-1 size-3.5 animate-spin" />
                    ) : item.connected ? (
                      <Unplug className="mr-1 size-3.5" />
                    ) : (
                      <PlugZap className="mr-1 size-3.5" />
                    )}
                    {item.connected ? "断开" : "连接"}
                  </Button>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            新增机器人：在宿主机 <code className="rounded bg-muted px-1">$DOUYIN_DATA_DIR/builtin/qq-bots/</code>
            下放一份 JSON（
            <code className="rounded bg-muted px-1">{`{ "appId": "...", "clientSecret": "...", "label": "备注" }`}</code>
            ），然后重启容器即可。AppID 重复、缺字段或
            <code className="rounded bg-muted px-1">enabled:false</code> 的配置会被自动跳过。
          </p>
        </section>
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
              disabled={
                busy === "connect"
                || busy === `connect:${selectedKey}`
                || status.connected
              }
              onClick={() => void handleInstanceAction(selectedKey, "connect")}
            >
              {busy === "connect" || busy === `connect:${selectedKey}` ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <PlugZap className="mr-1 size-3.5" />
              )}
              连接
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy === "disconnect"
                || busy === `disconnect:${selectedKey}`
                || (!status.connected && status.phase === "idle")
              }
              onClick={() => void handleInstanceAction(selectedKey, "disconnect")}
            >
              {busy === "disconnect" || busy === `disconnect:${selectedKey}` ? (
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
            能力说明：文字指令、CSV 导入与微信侧一致；官方通道对主动推送/随意文件有限额，
            图片（日报）走被动回复窗口更稳。发文件前可先说「9.11」指定导入日，再连传音浪与时长两个 CSV。
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
