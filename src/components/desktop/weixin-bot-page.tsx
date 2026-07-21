"use client";

import Image from "next/image";
import { type ComponentProps, useEffect, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  Clock3,
  HelpCircle,
  KeyRound,
  Loader2,
  LogOut,
  MessageCircle,
  Plus,
  QrCode,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { getDataApi } from "@/client/http-electron-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  WeixinBotAccountSummary,
  WeixinBotContact,
  WeixinBotCustomCommand,
  WeixinBotCustomCommandAction,
  WeixinBotPhase,
  WeixinBotSettings,
  WeixinBotSettingsSavePayload,
  WeixinBotStatus,
} from "@/types/electron";

const EMPTY_STATUS: WeixinBotStatus = {
  available: true,
  phase: "disconnected",
  connected: false,
  monitoring: false,
  accountId: null,
  userId: null,
  baseUrl: "https://ilinkai.weixin.qq.com",
  savedAt: null,
  qrDataUrl: null,
  qrExpiresAt: null,
  statusText: "尚未连接",
  lastPollAt: null,
  lastMessageAt: null,
  error: null,
  receivedCount: 0,
  sentCount: 0,
  accounts: [],
};

const DEFAULT_SETTINGS: WeixinBotSettings = {
  autoReplyEnabled: false,
  autoReplyText: "消息已收到。",
  accessMode: "open",
  allowUserIds: [],
  allowGroupIds: [],
  customCommands: [],
  ai: {
    enabled: true,
    baseUrl: "http://162.243.93.40:8317/v1",
    model: "grok-4.5",
    timeoutMs: 45_000,
    maxToolRounds: 4,
    hasApiKey: true,
  },
  contacts: [],
};

const COMMAND_HINTS: { example: string; desc: string }[] = [
  { example: "艺名", desc: "全部数据" },
  { example: "每日报告", desc: "双团图" },
  { example: "18号报告", desc: "指定日" },
  { example: "艺名+时长", desc: "累计时长" },
  { example: "艺名+音浪", desc: "最新音浪" },
  { example: "音浪文件", desc: "导出 CSV" },
  { example: "人工客服", desc: "开启智能" },
  { example: "退出客服", desc: "关闭智能" },
];

const CUSTOM_ACTION_OPTIONS: { value: WeixinBotCustomCommandAction; label: string }[] = [
  { value: "reply", label: "固定回复" },
  { value: "daily_report", label: "每日报告(双团)" },
  { value: "male_report", label: "男团报告" },
  { value: "female_report", label: "女队报告" },
  { value: "wave_file", label: "音浪 CSV" },
  { value: "help", label: "帮助" },
];

const PHASE_LABEL: Record<WeixinBotPhase, string> = {
  disconnected: "未连接",
  connecting: "连接中",
  awaiting_scan: "待扫码",
  scanned: "待确认",
  running: "运行中",
  stopped: "已暂停",
  session_expired: "登录过期",
  error: "连接异常",
};

type BusyAction =
  | "login"
  | "cancel"
  | "start"
  | "stop"
  | "disconnect"
  | "save"
  | "save-ai"
  | "save-commands"
  | "save-reply";

type ConfirmAction = "disconnect" | null;

function normalizeSettings(input?: Partial<WeixinBotSettings> | null): WeixinBotSettings {
  const ai = input?.ai || DEFAULT_SETTINGS.ai;
  return {
    autoReplyEnabled: Boolean(input?.autoReplyEnabled),
    autoReplyText: String(input?.autoReplyText ?? DEFAULT_SETTINGS.autoReplyText),
    accessMode: input?.accessMode === "allowlist" ? "allowlist" : "open",
    allowUserIds: Array.isArray(input?.allowUserIds) ? input!.allowUserIds.map(String) : [],
    allowGroupIds: Array.isArray(input?.allowGroupIds) ? input!.allowGroupIds.map(String) : [],
    customCommands: Array.isArray(input?.customCommands)
      ? input!.customCommands.map((item, index) => ({
          id: String(item?.id || `cmd_${index + 1}`),
          trigger: String(item?.trigger || ""),
          action: (CUSTOM_ACTION_OPTIONS.some((opt) => opt.value === item?.action)
            ? item.action
            : "reply") as WeixinBotCustomCommandAction,
          replyText: String(item?.replyText || ""),
          enabled: item?.enabled !== false,
        }))
      : [],
    ai: {
      enabled: Boolean(ai.enabled),
      baseUrl: String(ai.baseUrl || DEFAULT_SETTINGS.ai.baseUrl),
      model: String(ai.model || DEFAULT_SETTINGS.ai.model),
      timeoutMs: Number(ai.timeoutMs) || DEFAULT_SETTINGS.ai.timeoutMs,
      maxToolRounds: Number(ai.maxToolRounds) || DEFAULT_SETTINGS.ai.maxToolRounds,
      hasApiKey: Boolean(ai.hasApiKey),
    },
    contacts: Array.isArray(input?.contacts)
      ? input!.contacts.map((item) => ({
          id: String(item?.id || ""),
          kind: item?.kind === "group" ? "group" : "user",
          conversationId: String(item?.conversationId || item?.id || ""),
          groupId: item?.groupId ? String(item.groupId) : null,
          lastContent: String(item?.lastContent || ""),
          lastSeenAt: String(item?.lastSeenAt || ""),
          allowed: Boolean(item?.allowed),
        }))
      : [],
  };
}

export function WeixinBotPage() {
  const api = getDataApi();
  const [status, setStatus] = useState<WeixinBotStatus>(EMPTY_STATUS);
  const [settings, setSettings] = useState<WeixinBotSettings>(DEFAULT_SETTINGS);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api) return;
    let active = true;

    void Promise.all([
      api.getWeixinBotStatus(),
      api.getWeixinBotSettings(),
    ]).then(([statusResult, settingsResult]) => {
      if (!active) return;
      if (statusResult.success) setStatus(statusResult.data);
      else setFeedback(statusResult.error);
      if (settingsResult.success) setSettings(normalizeSettings(settingsResult.data));
      setLoading(false);
    }).catch((error) => {
      if (!active) return;
      setFeedback(error instanceof Error ? error.message : String(error));
      setLoading(false);
    });

    const removeStatus = api.onWeixinBotStatus((next) => {
      if (active) setStatus(next);
    });
    const removeMessage = api.onWeixinBotMessage(() => {
      if (!active) return;
      // 入站消息会写入对接列表，刷新 contacts
      void api.getWeixinBotSettings().then((result) => {
        if (active && result.success) setSettings(normalizeSettings(result.data));
      });
    });

    return () => {
      active = false;
      removeStatus();
      removeMessage();
    };
  }, [api]);

  const contacts = settings.contacts || [];

  async function runStatusAction(
    action: BusyAction,
    request: () => Promise<{ success: true; data: WeixinBotStatus } | { success: false; error: string }>
  ) {
    setBusyAction(action);
    setFeedback("");
    try {
      const result = await request();
      if (result.success) setStatus(result.data);
      else setFeedback(result.error);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
      setConfirmAction(null);
    }
  }

  function handleLogin() {
    if (!api) return;
    void runStatusAction("login", () => api.startWeixinBotLogin());
  }

  function handleCancelLogin() {
    if (!api) return;
    void runStatusAction("cancel", () => api.cancelWeixinBotLogin());
  }

  function handleStart(accountId?: string) {
    if (!api) return;
    void runStatusAction("start", () => api.startWeixinBot(accountId));
  }

  function handleStop(accountId?: string) {
    if (!api) return;
    void runStatusAction("stop", () => api.stopWeixinBot(accountId));
  }

  function handleDisconnect(accountId?: string) {
    if (!api) return;
    if (confirmAction !== "disconnect") {
      setConfirmAction("disconnect");
      return;
    }
    void runStatusAction("disconnect", () => api.disconnectWeixinBot(accountId));
  }

  function handleSelectAccount(accountId: string) {
    if (!api) return;
    void runStatusAction("start", () => api.setActiveWeixinBotAccount(accountId));
  }

  async function saveSettingsPatch(
    action: BusyAction,
    patch: WeixinBotSettingsSavePayload
  ) {
    if (!api) return;
    setBusyAction(action);
    setFeedback("");
    try {
      const result = await api.saveWeixinBotSettings(patch);
      if (result.success) {
        setSettings(normalizeSettings(result.data));
        if (action === "save-ai") setApiKeyDraft("");
      } else {
        setFeedback(result.error);
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveAutoReply() {
    await saveSettingsPatch("save-reply", {
      autoReplyEnabled: settings.autoReplyEnabled,
      autoReplyText: settings.autoReplyText,
    });
  }

  async function handleSaveCommands() {
    await saveSettingsPatch("save-commands", {
      customCommands: settings.customCommands,
    });
  }

  async function handleSaveAi() {
    await saveSettingsPatch("save-ai", {
      ai: {
        enabled: settings.ai.enabled,
        baseUrl: settings.ai.baseUrl,
        model: settings.ai.model,
        timeoutMs: settings.ai.timeoutMs,
        maxToolRounds: settings.ai.maxToolRounds,
        ...(apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {}),
      },
    });
  }

  async function handleClearApiKey() {
    await saveSettingsPatch("save-ai", {
      ai: {
        enabled: false,
        clearApiKey: true,
        apiKey: "",
      },
    });
  }

  function updateCustomCommand(id: string, patch: Partial<WeixinBotCustomCommand>) {
    setSettings((current) => ({
      ...current,
      customCommands: current.customCommands.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      ),
    }));
  }

  function addCustomCommand() {
    setSettings((current) => ({
      ...current,
      customCommands: [
        ...current.customCommands,
        {
          id: `cmd_${Date.now()}`,
          trigger: "",
          action: "reply",
          replyText: "",
          enabled: true,
        },
      ],
    }));
  }

  function removeCustomCommand(id: string) {
    setSettings((current) => ({
      ...current,
      customCommands: current.customCommands.filter((item) => item.id !== id),
    }));
  }

  if (loading) {
    return (
      <div className="flex min-h-[640px] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-label="正在读取微信机器人状态" />
      </div>
    );
  }

  const loginActive = ["connecting", "awaiting_scan", "scanned"].includes(status.phase);
  const accounts = status.accounts || [];

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <header className="flex min-h-16 flex-wrap items-center justify-between gap-4 border-b border-border/70 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#07c160] text-white shadow-sm">
              <Bot className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold">微信机器人</h2>
                <PhaseBadge phase={status.phase} />
                {accounts.length > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {accounts.length} 个账号
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {status.statusText}
                {" · 支持多账号并行 · 一点生成二维码"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {loginActive ? (
              <Button size="sm" variant="outline" onClick={handleCancelLogin} disabled={busyAction !== null}>
                {busyAction === "cancel" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                取消扫码
              </Button>
            ) : (
              <Button size="sm" onClick={handleLogin} disabled={!status.available || busyAction !== null}>
                {busyAction === "login" ? <Loader2 className="size-3.5 animate-spin" /> : <QrCode className="size-3.5" />}
                扫码连接
              </Button>
            )}
            {status.monitoring ? (
              <IconAction
                label="暂停全部"
                icon={busyAction === "stop" ? Loader2 : CirclePause}
                loading={busyAction === "stop"}
                onClick={() => handleStop()}
                disabled={busyAction !== null}
              />
            ) : status.connected ? (
              <IconAction
                label="启动全部"
                icon={busyAction === "start" ? Loader2 : CirclePlay}
                loading={busyAction === "start"}
                onClick={() => handleStart()}
                disabled={busyAction !== null}
              />
            ) : null}
            {status.connected && (
              confirmAction === "disconnect" ? (
                <div className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/8 px-2 py-1">
                  <span className="text-xs text-red-700 dark:text-red-300">确认断开当前/全部凭据？</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busyAction !== null}
                    onClick={() => handleDisconnect(status.accountId || undefined)}
                  >
                    {busyAction === "disconnect" ? <Loader2 className="size-3.5 animate-spin" /> : "确认"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmAction(null)}>
                    取消
                  </Button>
                </div>
              ) : (
                <IconAction
                  label="断开当前账号"
                  icon={LogOut}
                  variant="outline"
                  onClick={() => handleDisconnect(status.accountId || undefined)}
                  disabled={busyAction !== null}
                />
              )
            )}
          </div>
        </header>

        {(feedback || status.error) && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{feedback || status.error}</span>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 hover:bg-red-500/10"
              onClick={() => {
                setFeedback("");
                setStatus((current) => ({ ...current, error: null }));
              }}
              aria-label="关闭提示"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {(loginActive || status.qrDataUrl) && (
          <QrLoginBanner
            status={status}
            busyAction={busyAction}
            onLogin={handleLogin}
            onCancel={handleCancelLogin}
          />
        )}

        <StatusStrip status={status} />
        <div className="grid gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(300px,0.9fr)]">
          <UserListPanel
            accounts={accounts}
            contacts={contacts}
            activeAccountId={status.accountId}
            busy={busyAction !== null}
            onSelectAccount={handleSelectAccount}
            onStartAccount={(id) => handleStart(id)}
            onStopAccount={(id) => handleStop(id)}
            onDisconnectAccount={(id) => handleDisconnect(id)}
          />

          <div className="flex min-h-[560px] flex-col gap-3">
            <CommandGuide />
            <CustomCommandsPanel
              commands={settings.customCommands}
              busy={busyAction === "save-commands"}
              onAdd={addCustomCommand}
              onChange={updateCustomCommand}
              onRemove={removeCustomCommand}
              onSave={handleSaveCommands}
            />
            <AiSettingsPanel
              settings={settings}
              apiKeyDraft={apiKeyDraft}
              busy={busyAction === "save-ai"}
              onSettingsChange={setSettings}
              onApiKeyChange={setApiKeyDraft}
              onSave={handleSaveAi}
              onClearKey={handleClearApiKey}
            />
            <AutoReplySettings
              settings={settings}
              busy={busyAction === "save-reply"}
              onChange={setSettings}
              onSave={handleSaveAutoReply}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function UserListPanel({
  accounts,
  contacts,
  activeAccountId,
  busy,
  onSelectAccount,
  onStartAccount,
  onStopAccount,
  onDisconnectAccount,
}: {
  accounts: WeixinBotAccountSummary[];
  contacts: WeixinBotContact[];
  activeAccountId: string | null;
  busy: boolean;
  onSelectAccount: (id: string) => void;
  onStartAccount: (id: string) => void;
  onStopAccount: (id: string) => void;
  onDisconnectAccount: (id: string) => void;
}) {
  return (
    <section className="flex min-h-[560px] flex-col overflow-hidden rounded-lg border border-border/70 bg-card/70">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-3 text-sm font-semibold">
        <UsersRound className="size-4 text-[#07c160]" />
        用户列表
        <span className="text-xs font-normal text-muted-foreground">
          {accounts.length} 账号 · {contacts.length} 对接
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
        <div className="space-y-1">
          <div className="px-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
            微信账号
          </div>
          {accounts.length === 0 ? (
            <p className="px-1 py-3 text-[11px] text-muted-foreground">
              点右上角「扫码连接」添加，可并行多个。
            </p>
          ) : (
            accounts.map((account) => {
              const active = activeAccountId === account.accountId;
              return (
                <div
                  key={account.accountId}
                  className={cn(
                    "rounded-lg border px-2.5 py-2",
                    active ? "border-[#07c160]/35 bg-[#07c160]/10" : "border-border/50"
                  )}
                >
                  <button type="button" className="w-full text-left" onClick={() => onSelectAccount(account.accountId)}>
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <Bot className="size-3.5 shrink-0 text-[#07c160]" />
                      <span className="truncate">{compactId(account.accountId)}</span>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {PHASE_LABEL[account.phase] || account.phase}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {account.monitoring ? "运行中" : "已暂停"}
                      {account.lastPollAt ? ` · ${formatRelative(account.lastPollAt)}` : ""}
                    </div>
                  </button>
                  <div className="mt-1.5 flex items-center gap-1">
                    {account.monitoring ? (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStopAccount(account.accountId)}>
                        暂停
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStartAccount(account.accountId)}>
                        启动
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDisconnectAccount(account.accountId)}>
                      断开
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-1 border-t border-border/60 pt-2">
          <div className="px-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
            对接会话
          </div>
          {contacts.length === 0 ? (
            <p className="px-1 py-3 text-[11px] text-muted-foreground">
              有人给机器人发消息后会出现在此；重启仍保留。
            </p>
          ) : (
            contacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-start gap-2 rounded-lg border border-transparent px-2.5 py-2 hover:border-border/70 hover:bg-muted/40"
              >
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60">
                  {contact.kind === "group" ? (
                    <UsersRound className="size-3.5 text-muted-foreground" />
                  ) : (
                    <UserRound className="size-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{contactTitle(contact)}</span>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {contact.kind === "group" ? "群" : "用户"}
                    </Badge>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {contact.lastContent || "暂无预览"}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {formatRelative(contact.lastSeenAt || null)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="border-t border-border/70 px-3 py-2 text-[10px] leading-4 text-muted-foreground">
        账号与对接合并展示；权限右键稍后接入。
      </div>
    </section>
  );
}

function QrLoginBanner({
  status,
  busyAction,
  onLogin,
  onCancel,
}: {
  status: WeixinBotStatus;
  busyAction: BusyAction | null;
  onLogin: () => void;
  onCancel: () => void;
}) {
  const loginActive = ["connecting", "awaiting_scan", "scanned"].includes(status.phase);
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-lg border border-[#07c160]/25 bg-[#07c160]/6 p-3">
      {status.qrDataUrl ? (
        <div className="overflow-hidden rounded-lg border border-border/70 bg-white p-2">
          <Image
            src={status.qrDataUrl}
            alt="微信登录二维码"
            width={120}
            height={120}
            unoptimized
            className="size-30"
          />
        </div>
      ) : (
        <div className="flex size-30 items-center justify-center rounded-lg border border-dashed border-border/70">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-sm font-semibold">{status.statusText || "扫码连接微信"}</div>
        <p className="text-xs text-muted-foreground">
          一点生成二维码；已有账号继续运行。
          {status.qrExpiresAt ? ` 有效至 ${formatClock(status.qrExpiresAt)}` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {loginActive ? (
            <Button size="sm" variant="outline" onClick={onCancel} disabled={busyAction !== null}>
              取消扫码
            </Button>
          ) : (
            <Button size="sm" onClick={onLogin} disabled={busyAction !== null}>
              刷新二维码
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function CommandGuide() {
  return (
    <aside className="overflow-hidden rounded-lg border border-border/70 bg-card/70">
      <div className="flex h-9 items-center gap-2 border-b border-border/70 px-3">
        <HelpCircle className="size-3.5 text-[#07c160]" />
        <span className="text-sm font-semibold">命令菜单</span>
      </div>
      <div className="grid grid-cols-2 gap-1 p-2">
        {COMMAND_HINTS.map((item) => (
          <div
            key={item.example}
            className="rounded-md border border-border/50 bg-background/40 px-2 py-1.5"
          >
            <div className="truncate text-[11px] font-medium">{item.example}</div>
            <div className="truncate text-[10px] text-muted-foreground">{item.desc}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function CustomCommandsPanel({
  commands,
  busy,
  onAdd,
  onChange,
  onRemove,
  onSave,
}: {
  commands: WeixinBotCustomCommand[];
  busy: boolean;
  onAdd: () => void;
  onChange: (id: string, patch: Partial<WeixinBotCustomCommand>) => void;
  onRemove: (id: string) => void;
  onSave: () => void;
}) {
  return (
    <aside className="overflow-hidden rounded-lg border border-border/70 bg-card/70">
      <div className="flex h-10 items-center justify-between border-b border-border/70 px-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Settings2 className="size-3.5 text-[#07c160]" />
          自定义命令
        </div>
        <div className="flex items-center gap-1">
          <IconAction label="新增命令" icon={Plus} variant="ghost" size="icon-sm" onClick={onAdd} disabled={busy} />
          <IconAction
            label="保存自定义命令"
            icon={busy ? Loader2 : Save}
            loading={busy}
            variant="ghost"
            size="icon-sm"
            onClick={onSave}
            disabled={busy}
          />
        </div>
      </div>
      <div className="max-h-56 space-y-2 overflow-y-auto p-2.5">
        {commands.length === 0 ? (
          <p className="px-1 py-3 text-center text-[11px] text-muted-foreground">
            还没有自定义命令。点 + 添加触发词。
          </p>
        ) : (
          commands.map((command) => (
            <div key={command.id} className="space-y-1.5 rounded-lg border border-border/60 p-2">
              <div className="flex items-center gap-2">
                <input
                  value={command.trigger}
                  onChange={(event) => onChange(command.id, { trigger: event.target.value })}
                  placeholder="触发词，如 发日报"
                  className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
                />
                <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={command.enabled}
                    onChange={(event) => onChange(command.id, { enabled: event.target.checked })}
                    className="size-3.5 accent-[#07c160]"
                  />
                  启用
                </label>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => onRemove(command.id)}
                  aria-label="删除命令"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <select
                value={command.action}
                onChange={(event) =>
                  onChange(command.id, { action: event.target.value as WeixinBotCustomCommandAction })
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
              >
                {CUSTOM_ACTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {command.action === "reply" && (
                <input
                  value={command.replyText}
                  onChange={(event) => onChange(command.id, { replyText: event.target.value })}
                  placeholder="固定回复内容"
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
                />
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function AiSettingsPanel({
  settings,
  apiKeyDraft,
  busy,
  onSettingsChange,
  onApiKeyChange,
  onSave,
  onClearKey,
}: {
  settings: WeixinBotSettings;
  apiKeyDraft: string;
  busy: boolean;
  onSettingsChange: (settings: WeixinBotSettings) => void;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
  onClearKey: () => void;
}) {
  const ai = settings.ai;
  return (
    <aside className="overflow-hidden rounded-lg border border-border/70 bg-card/70">
      <div className="flex h-10 items-center justify-between border-b border-border/70 px-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-3.5 text-[#07c160]" />
          AI 设置
        </div>
        <IconAction
          label="保存 AI 设置"
          icon={busy ? Loader2 : Save}
          loading={busy}
          variant="ghost"
          size="icon-sm"
          onClick={onSave}
          disabled={busy}
        />
      </div>
      <div className="space-y-2 p-2.5">
        <label className="flex items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={ai.enabled}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                ai: { ...ai, enabled: event.target.checked },
              })
            }
            className="size-4 accent-[#07c160]"
          />
          启用轻量 AI Agent
        </label>
        <Field
          label="接口地址"
          value={ai.baseUrl}
          onChange={(value) =>
            onSettingsChange({ ...settings, ai: { ...ai, baseUrl: value } })
          }
          placeholder="http://162.243.93.40:8317/v1"
        />
        <Field
          label="模型"
          value={ai.model}
          onChange={(value) =>
            onSettingsChange({ ...settings, ai: { ...ai, model: value } })
          }
          placeholder="grok-4.5"
        />
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <KeyRound className="size-3" />
              API Key
            </span>
            <span>{ai.hasApiKey ? "已保存（不回显）" : "未配置"}</span>
          </div>
          <input
            type="password"
            value={apiKeyDraft}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder={ai.hasApiKey ? "输入新 Key 以覆盖" : "sk-..."}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
            autoComplete="off"
          />
          {ai.hasApiKey && (
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={onClearKey}
              disabled={busy}
            >
              清除已保存 Key
            </button>
          )}
        </div>
        <p className="text-[10px] leading-4 text-muted-foreground">
          仅根据已有数据库技能回答；命令优先于 AI。Key 加密保存在本机，界面不回显明文。
        </p>
      </div>
    </aside>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
      />
    </label>
  );
}

function AutoReplySettings({
  settings,
  busy,
  onChange,
  onSave,
}: {
  settings: WeixinBotSettings;
  busy: boolean;
  onChange: (settings: WeixinBotSettings) => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-2 overflow-hidden rounded-lg border border-border/70 bg-card/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={settings.autoReplyEnabled}
            onChange={(event) => onChange({ ...settings, autoReplyEnabled: event.target.checked })}
            className="size-4 accent-[#07c160]"
          />
          自动回复
        </label>
        <IconAction
          label="保存自动回复"
          icon={busy ? Loader2 : Save}
          loading={busy}
          variant="ghost"
          size="icon-sm"
          onClick={onSave}
          disabled={busy || (settings.autoReplyEnabled && !settings.autoReplyText.trim())}
        />
      </div>
      <textarea
        rows={2}
        maxLength={1000}
        value={settings.autoReplyText}
        onChange={(event) => onChange({ ...settings, autoReplyText: event.target.value })}
        placeholder="未命中命令时的固定回复"
        className="min-h-14 w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 text-xs outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
        aria-label="自动回复内容"
      />
      <p className="text-[10px] leading-4 text-muted-foreground">
        仅在未识别为命令/AI/导入时触发。
      </p>
    </div>
  );
}

function ConnectionPanel({
  status,
  busyAction,
  onLogin,
  onCancel,
}: {
  status: WeixinBotStatus;
  busyAction: BusyAction | null;
  onLogin: () => void;
  onCancel: () => void;
}) {
  const hasQr = Boolean(status.qrDataUrl);
  const loginActive = ["connecting", "awaiting_scan", "scanned"].includes(status.phase);

  return (
    <section className="grid min-h-[590px] overflow-hidden rounded-lg border border-border/70 bg-card/70 md:grid-cols-[minmax(0,0.85fr)_minmax(360px,1.15fr)]">
      <div className="flex flex-col justify-between border-b border-border/70 p-6 md:border-b-0 md:border-r">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#07c160]/25 bg-[#07c160]/10 px-3 py-1 text-xs font-medium text-[#078b43] dark:text-[#48df8a]">
            <Wifi className="size-3.5" />
            iLink 机器人连接
          </div>
          <div>
            <h3 className="text-lg font-semibold">{hasQr ? "微信扫码连接" : "连接微信机器人"}</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              扫码后凭据加密保存在本机。软件重启会自动恢复连接，无需重新绑定。
            </p>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <ConnectionRow label="状态" value={status.statusText} />
            <ConnectionRow label="账号" value={status.accountId || "-"} />
            <ConnectionRow label="接口" value={status.baseUrl || "-"} />
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {loginActive ? (
            <Button variant="outline" onClick={onCancel} disabled={busyAction !== null}>
              {busyAction === "cancel" ? <Loader2 className="size-4 animate-spin" /> : null}
              取消连接
            </Button>
          ) : (
            <Button onClick={onLogin} disabled={!status.available || busyAction !== null}>
              {busyAction === "login" ? <Loader2 className="size-4 animate-spin" /> : <QrCodeIcon />}
              {status.available ? "扫码连接" : "桌面端不可用"}
            </Button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-center bg-background/40 p-6">
        {status.qrDataUrl ? (
          <div className="space-y-3 text-center">
            <div className="mx-auto overflow-hidden rounded-xl border border-border/70 bg-white p-3 shadow-sm">
              <Image
                src={status.qrDataUrl}
                alt="微信登录二维码"
                width={240}
                height={240}
                unoptimized
                className="size-60"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              二维码有效至 {formatClock(status.qrExpiresAt)} · 使用微信扫一扫
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="flex size-20 items-center justify-center rounded-2xl border border-dashed border-border/80">
              <QrCodeIcon className="size-8 opacity-60" />
            </div>
            <p className="max-w-xs text-center text-sm leading-6">
              点击「扫码连接」生成二维码。连接成功后可管理对接列表、命令与 AI。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function QrCodeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3z" />
      <path d="M14 14h3v3h-3zM20 14h1v1h-1zM17 17h1v1h-1zM20 20h1v1h-1zM14 20h3v1h-3z" />
    </svg>
  );
}

function ConnectionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-10 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-xs text-foreground">{value}</span>
    </div>
  );
}

function StatusStrip({ status }: { status: WeixinBotStatus }) {
  const items = [
    { icon: Wifi, label: "轮询", value: formatRelative(status.lastPollAt) },
    { icon: MessageCircle, label: "消息", value: `${status.receivedCount}/${status.sentCount}` },
    { icon: Clock3, label: "最近", value: formatRelative(status.lastMessageAt) },
    {
      icon: CheckCircle2,
      label: "账号",
      value: status.accountId ? compactId(status.accountId) : "-",
    },
  ];
  return (
    <section className="grid overflow-hidden rounded-lg border border-border/70 bg-card/60 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.label} className="flex items-center gap-3 border-b border-border/50 px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 lg:border-b-0">
            <Icon className="size-4 text-[#07c160]" />
            <div>
              <div className="text-[11px] text-muted-foreground">{item.label}</div>
              <div className="text-sm font-medium">{item.value}</div>
            </div>
          </div>
        );
      })}
    </section>
  );
}


function PhaseBadge({ phase }: { phase: WeixinBotPhase }) {
  const active = phase === "running";
  const pending = ["connecting", "awaiting_scan", "scanned"].includes(phase);
  const warning = phase === "stopped" || phase === "session_expired";
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1",
        active && "border-[#07c160]/30 bg-[#07c160]/10 text-[#078b43] dark:text-[#48df8a]",
        pending && "border-primary/30 bg-primary/10 text-primary",
        warning && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        phase === "error" && "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
      )}
    >
      {active ? <Wifi className="size-3" /> : phase === "disconnected" ? <WifiOff className="size-3" /> : null}
      {PHASE_LABEL[phase]}
    </Badge>
  );
}


function IconAction({
  label,
  icon: Icon,
  loading = false,
  size = "icon",
  type = "button",
  ...props
}: {
  label: string;
  icon: LucideIcon;
  loading?: boolean;
  size?: "icon" | "icon-sm";
  type?: "button" | "submit";
} & Omit<ComponentProps<typeof Button>, "children" | "size" | "type">) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size={size} type={type} aria-label={label} {...props}>
          <Icon className={cn("size-4", loading && "animate-spin")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}


function contactTitle(contact: Pick<WeixinBotContact, "kind" | "id" | "groupId">) {
  if (contact.kind === "group") return `群聊 ${compactId(contact.groupId || contact.id)}`;
  return `微信用户 ${compactId(contact.id)}`;
}

function compactId(value: string | null) {
  if (!value) return "-";
  if (value.length <= 18) return value;
  return `${value.slice(0, 6)}...${value.slice(-8)}`;
}

function formatClock(value: string | null) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatRelative(value: string | null) {
  if (!value) return "尚未轮询";
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return "-";
  const seconds = Math.max(0, Math.floor((Date.now() - millis) / 1000));
  if (seconds < 5) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  return new Date(millis).toLocaleString("zh-CN", { hour12: false });
}
