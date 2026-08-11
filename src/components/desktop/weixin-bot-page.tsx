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
  WeixinBotDailyReportPushSettings,
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

const DEFAULT_DAILY_PUSH: WeixinBotDailyReportPushSettings = {
  enabled: false,
  reminderEnabled: true,
  lastReminderDate: null,
  adminUserIds: [],
  adminRemarks: {},
  recipientUserIds: [],
  recipientGroupIds: [],
  lastPush: null,
};

const DEFAULT_SETTINGS: WeixinBotSettings = {
  accountId: null,
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
    timeoutMs: 90_000,
    maxToolRounds: 4,
    progressEnabled: true,
    hasApiKey: false,
  },
  contacts: [],
  dailyReportPush: DEFAULT_DAILY_PUSH,
};

const COMMAND_HINTS: { example: string; desc: string }[] = [
  { example: "艺名", desc: "全部数据" },
  { example: "每日报告", desc: "双团图" },
  { example: "18号报告", desc: "指定日" },
  { example: "艺名+时长", desc: "累计时长" },
  { example: "艺名+音浪", desc: "最新音浪" },
  { example: "音浪文件", desc: "导出 CSV" },
  { example: "开启日报推送", desc: "任意用户可开关" },
  { example: "关闭日报推送", desc: "任意用户可开关" },
  { example: "日报推送状态", desc: "查看开关" },
  { example: "清空对话", desc: "清会话记忆" },
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
  | "select"
  | "stop"
  | "disconnect"
  | "save"
  | "save-ai"
  | "save-commands"
  | "save-reply"
  | "save-push";

type ConfirmAction = { kind: "disconnect"; accountId: string } | null;

function normalizeSettings(input?: Partial<WeixinBotSettings> | null): WeixinBotSettings {
  const ai = input?.ai || DEFAULT_SETTINGS.ai;
  return {
    accountId: input?.accountId ? String(input.accountId) : null,
    autoReplyEnabled: Boolean(input?.autoReplyEnabled),
    autoReplyText: String(input?.autoReplyText ?? DEFAULT_SETTINGS.autoReplyText),
    accessMode: "open",
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
      // 与后端一致：默认开启；仅显式 false 视为关闭，避免保存后被默认值顶回勾选语义混乱
      enabled: ai.enabled !== false,
      baseUrl: String(ai.baseUrl || DEFAULT_SETTINGS.ai.baseUrl),
      model: String(ai.model || DEFAULT_SETTINGS.ai.model),
      timeoutMs: Number(ai.timeoutMs) || DEFAULT_SETTINGS.ai.timeoutMs,
      maxToolRounds: Number(ai.maxToolRounds) || DEFAULT_SETTINGS.ai.maxToolRounds,
      progressEnabled: ai.progressEnabled !== false,
      hasApiKey: Boolean(ai.hasApiKey),
    },
    contacts: Array.isArray(input?.contacts)
      ? input!.contacts.map((item) => ({
          accountId: String(item?.accountId || ""),
          id: String(item?.id || ""),
          kind: item?.kind === "group" ? "group" : "user",
          conversationId: String(item?.conversationId || item?.id || ""),
          groupId: item?.groupId ? String(item.groupId) : null,
          lastContent: String(item?.lastContent || ""),
          lastSeenAt: String(item?.lastSeenAt || ""),
          allowed: Boolean(item?.allowed),
          hasContext: Boolean(item?.hasContext),
        }))
      : [],
    dailyReportPush: {
      enabled: Boolean(input?.dailyReportPush?.enabled),
      reminderEnabled:
        input?.dailyReportPush?.reminderEnabled === undefined
          ? true
          : Boolean(input.dailyReportPush.reminderEnabled),
      lastReminderDate: input?.dailyReportPush?.lastReminderDate ?? null,
      adminUserIds: Array.isArray(input?.dailyReportPush?.adminUserIds)
        ? input!.dailyReportPush!.adminUserIds.map(String)
        : [],
      adminRemarks:
        input?.dailyReportPush?.adminRemarks &&
        typeof input.dailyReportPush.adminRemarks === "object"
          ? Object.fromEntries(
              Object.entries(input.dailyReportPush.adminRemarks).map(([k, v]) => [k, String(v ?? "")])
            )
          : {},
      recipientUserIds: Array.isArray(input?.dailyReportPush?.recipientUserIds)
        ? input!.dailyReportPush!.recipientUserIds.map(String)
        : [],
      recipientGroupIds: Array.isArray(input?.dailyReportPush?.recipientGroupIds)
        ? input!.dailyReportPush!.recipientGroupIds.map(String)
        : [],
      lastPush: input?.dailyReportPush?.lastPush ?? null,
    },
  };
}

export function WeixinBotPage({ embedded = false }: { embedded?: boolean } = {}) {
  const api = getDataApi();
  const [status, setStatus] = useState<WeixinBotStatus>(EMPTY_STATUS);
  const [settings, setSettings] = useState<WeixinBotSettings>(DEFAULT_SETTINGS);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [settingsTab, setSettingsTab] = useState<"push" | "commands" | "ai">("push");

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
      // 入站消息只刷新对接列表，避免整表回写把未保存的勾选/输入顶回去
      void api.getWeixinBotSettings().then((result) => {
        if (!active || !result.success) return;
        const next = normalizeSettings(result.data);
        setSettings((current) => ({
          ...current,
          accountId: next.accountId ?? current.accountId,
          contacts: next.contacts,
        }));
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
    const targetAccountId = String(accountId || "");
    if (
      confirmAction?.kind !== "disconnect"
      || confirmAction.accountId !== targetAccountId
    ) {
      setConfirmAction({ kind: "disconnect", accountId: targetAccountId });
      return;
    }
    void runStatusAction("disconnect", () => api.disconnectWeixinBot(accountId));
  }

  async function handleSelectAccount(accountId: string) {
    if (!api) return;
    await runStatusAction("start", () => api.setActiveWeixinBotAccount(accountId));
    const result = await api.getWeixinBotSettings();
    if (result.success) setSettings(normalizeSettings(result.data));
    else setFeedback(result.error);
  }

  async function saveSettingsPatch(
    action: BusyAction,
    patch: WeixinBotSettingsSavePayload
  ) {
    if (!api) return;
    setBusyAction(action);
    setFeedback("");
    try {
      const result = await api.saveWeixinBotSettings({
        ...patch,
        accountId: patch.accountId || status.accountId || undefined,
      });
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

  async function handleSaveDailyPush() {
    await saveSettingsPatch("save-push", {
      dailyReportPush: {
        ...settings.dailyReportPush,
        // 产品：始终推全部有会话联系人，不再配置对象名单
        recipientUserIds: [],
        recipientGroupIds: [],
      },
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
        progressEnabled: settings.ai.progressEnabled !== false,
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
      <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载微信机器人…
      </div>
    );
  }

  const loginActive = ["connecting", "awaiting_scan", "scanned"].includes(status.phase);
  const accounts = status.accounts || [];

  return (
    <TooltipProvider>
      <div className="space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0">
            {embedded ? (
              <div className="flex flex-wrap items-center gap-2">
                <PhaseBadge phase={status.phase} />
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
                {accounts.length > 0 ? (
                  <Badge variant="outline" className="text-[10px]">
                    {accounts.length} 账号
                  </Badge>
                ) : null}
                {status.statusText ? (
                  <span className="text-xs text-muted-foreground">{status.statusText}</span>
                ) : null}
              </div>
            ) : (
              <>
                <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-[#07c160] text-white shadow-sm">
                    <Bot className="size-4" />
                  </span>
                  微信机器人
                  <PhaseBadge phase={status.phase} />
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
                  {accounts.length > 0 ? (
                    <Badge variant="outline" className="text-[10px]">
                      {accounts.length} 账号
                    </Badge>
                  ) : null}
                </h1>
                <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                  官方 iLink 通道 · 任意用户扫码即可用 · 业务与 QQ 共用 Agent / 技能 / 日报。
                  {status.statusText ? ` ${status.statusText}` : ""}
                </p>
              </>
            )}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {loginActive ? (
              <Button size="sm" variant="outline" onClick={handleCancelLogin} disabled={busyAction !== null}>
                {busyAction === "cancel" ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
                取消扫码
              </Button>
            ) : (
              <Button
                size="sm"
                className="bg-[#07c160] text-white hover:bg-[#06ad56]"
                onClick={handleLogin}
                disabled={!status.available || busyAction !== null}
              >
                {busyAction === "login" ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <QrCode className="mr-1 size-3.5" />
                )}
                扫码连接
              </Button>
            )}
            {status.monitoring ? (
              <Button size="sm" variant="outline" disabled={busyAction !== null} onClick={() => handleStop()}>
                {busyAction === "stop" ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <CirclePause className="mr-1 size-3.5" />
                )}
                暂停全部
              </Button>
            ) : status.connected ? (
              <Button size="sm" variant="outline" disabled={busyAction !== null} onClick={() => handleStart()}>
                {busyAction === "start" ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <CirclePlay className="mr-1 size-3.5" />
                )}
                启动全部
              </Button>
            ) : null}
            {status.connected ? (
              confirmAction?.kind === "disconnect" ? (
                <div className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 dark:border-rose-900 dark:bg-rose-950/40">
                  <span className="text-xs text-rose-700 dark:text-rose-200">确认断开？</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busyAction !== null}
                    onClick={() => handleDisconnect(confirmAction.accountId || undefined)}
                  >
                    {busyAction === "disconnect" ? <Loader2 className="size-3.5 animate-spin" /> : "确认"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmAction(null)}>
                    取消
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyAction !== null}
                  onClick={() => handleDisconnect(status.accountId || undefined)}
                >
                  <LogOut className="mr-1 size-3.5" />
                  断开
                </Button>
              )
            ) : null}
          </div>
        </div>

        {(feedback || status.error) && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{feedback || status.error}</span>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 hover:bg-rose-500/10"
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

        {/* 左：账号会话；右：推送 / 命令 / AI 用 Tab 切换，避免三组叠高 */}
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
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

          <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex flex-wrap gap-1 border-b p-1.5">
              {(
                [
                  { id: "push" as const, label: "推送提醒", icon: MessageCircle },
                  { id: "commands" as const, label: "命令能力", icon: HelpCircle },
                  { id: "ai" as const, label: "智能兜底", icon: Sparkles },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSettingsTab(id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                    settingsTab === id
                      ? "bg-[#07c160]/15 text-[#078b43] dark:text-[#48df8a]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>

            <div className="max-h-[min(70vh,720px)] space-y-3 overflow-y-auto p-3">
              {settingsTab === "push" ? (
                <DailyReportPushPanel
                  settings={settings}
                  busy={busyAction === "save-push"}
                  onChange={setSettings}
                  onSave={handleSaveDailyPush}
                  bare
                />
              ) : null}

              {settingsTab === "commands" ? (
                <>
                  <CommandGuide />
                  <CustomCommandsPanel
                    commands={settings.customCommands}
                    busy={busyAction === "save-commands"}
                    onAdd={addCustomCommand}
                    onChange={updateCustomCommand}
                    onRemove={removeCustomCommand}
                    onSave={handleSaveCommands}
                    bare
                  />
                </>
              ) : null}

              {settingsTab === "ai" ? (
                <>
                  <AiSettingsPanel
                    settings={settings}
                    apiKeyDraft={apiKeyDraft}
                    busy={busyAction === "save-ai"}
                    onSettingsChange={setSettings}
                    onApiKeyChange={setApiKeyDraft}
                    onSave={handleSaveAi}
                    onClearKey={handleClearApiKey}
                    bare
                  />
                  <AutoReplySettings
                    settings={settings}
                    busy={busyAction === "save-reply"}
                    onChange={setSettings}
                    onSave={handleSaveAutoReply}
                    bare
                  />
                </>
              ) : null}
            </div>
          </section>
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
    <section className="relative flex max-h-[min(70vh,720px)] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4 text-[11px] text-muted-foreground">
        <UsersRound className="size-3.5 text-[#07c160]" />
        <span className="font-medium text-foreground">账号与会话</span>
        <span className="text-muted-foreground/80">
          {accounts.length} 账号 · {contacts.length} 对接
        </span>
        <span className="ml-auto hidden sm:inline">点账号切换视图</span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="space-y-1.5">
          <div className="px-1 text-[11px] font-medium text-muted-foreground">微信账号</div>
          {accounts.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
              点右上「扫码连接」添加账号，可多账号并行
            </div>
          ) : (
            accounts.map((account) => {
              const active = activeAccountId === account.accountId;
              return (
                <div
                  key={account.accountId}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 transition-colors",
                    active
                      ? "border-[#07c160]/40 bg-[#07c160]/10"
                      : "border-border/60 bg-background/40 hover:border-border"
                  )}
                >
                  <button type="button" className="w-full text-left" onClick={() => onSelectAccount(account.accountId)}>
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <Bot className="size-3.5 shrink-0 text-[#07c160]" />
                      <span className="truncate">{compactId(account.accountId)}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-5 px-1.5 text-[10px]",
                          account.monitoring && "border-[#07c160]/30 bg-[#07c160]/10 text-[#078b43]"
                        )}
                      >
                        {PHASE_LABEL[account.phase] || account.phase}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {account.monitoring ? "运行中" : "已暂停"}
                      {account.lastPollAt ? ` · ${formatRelative(account.lastPollAt)}` : ""}
                    </div>
                  </button>
                  <div className="mt-2 flex items-center gap-1">
                    {account.monitoring ? (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => onStopAccount(account.accountId)}>
                        暂停
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => onStartAccount(account.accountId)}>
                        启动
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => onDisconnectAccount(account.accountId)}>
                      断开
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-1.5 border-t pt-3">
          <div className="px-1 text-[11px] font-medium text-muted-foreground">对接会话</div>
          {contacts.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
              有人给机器人发消息后会出现在此；重启仍保留
            </div>
          ) : (
            contacts.map((contact) => (
              <div
                key={`${contact.accountId}:${contact.id}`}
                className="flex items-start gap-2.5 rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-border/70 hover:bg-muted/30"
              >
                <div
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md",
                    contact.kind === "group" ? "bg-sky-500/10 text-sky-600" : "bg-[#07c160]/10 text-[#07c160]"
                  )}
                >
                  {contact.kind === "group" ? (
                    <UsersRound className="size-3.5" />
                  ) : (
                    <UserRound className="size-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{contactTitle(contact)}</span>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {contact.kind === "group" ? "群" : "用户"}
                    </Badge>
                    {contact.hasContext ? (
                      <span className="text-[10px] text-emerald-600">可推</span>
                    ) : null}
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
      <div className="border-t px-4 py-2 text-[11px] leading-5 text-muted-foreground">
        开放访问 · 任意用户/群可用 · 会话列表跟当前选中账号走
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
    <section className="flex flex-wrap items-center gap-4 rounded-xl border border-[#07c160]/25 bg-[#07c160]/8 p-4 shadow-sm">
      {status.qrDataUrl ? (
        <div className="overflow-hidden rounded-xl border bg-white p-2 shadow-sm">
          <Image
            src={status.qrDataUrl}
            alt="微信登录二维码"
            width={128}
            height={128}
            unoptimized
            className="size-32"
          />
        </div>
      ) : (
        <div className="flex size-32 items-center justify-center rounded-xl border border-dashed bg-background/60">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-sm font-semibold">{status.statusText || "扫码连接微信"}</div>
        <p className="text-xs leading-5 text-muted-foreground">
          用微信扫码登录 iLink。已有账号继续运行，可并行多个。
          {status.qrExpiresAt ? ` 有效至 ${formatClock(status.qrExpiresAt)}` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {loginActive ? (
            <Button size="sm" variant="outline" onClick={onCancel} disabled={busyAction !== null}>
              取消扫码
            </Button>
          ) : (
            <Button size="sm" className="bg-[#07c160] text-white hover:bg-[#06ad56]" onClick={onLogin} disabled={busyAction !== null}>
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
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-0.5">
        <span className="text-xs font-semibold">内置指令速查</span>
        <span className="ml-auto text-[10px] text-muted-foreground">任意用户 · 与 QQ 共用</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {COMMAND_HINTS.map((item) => (
          <div
            key={item.example}
            className="rounded-lg border bg-muted/20 px-2.5 py-1.5"
          >
            <div className="truncate text-[11px] font-medium">{item.example}</div>
            <div className="truncate text-[10px] text-muted-foreground">{item.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DailyReportPushPanel({
  settings,
  busy,
  onChange,
  onSave,
  bare = false,
}: {
  settings: WeixinBotSettings;
  busy: boolean;
  onChange: (settings: WeixinBotSettings) => void;
  onSave: () => void;
  bare?: boolean;
}) {
  const push = settings.dailyReportPush || DEFAULT_DAILY_PUSH;

  const updatePush = (patch: Partial<WeixinBotDailyReportPushSettings>) => {
    onChange({
      ...settings,
      dailyReportPush: { ...push, ...patch },
    });
  };

  return (
    <div className={cn(!bare && "overflow-hidden rounded-xl border bg-card shadow-sm")}>
      <div className={cn("flex h-9 items-center justify-between", bare ? "px-0.5" : "border-b px-3")}>
        <div className="text-xs font-semibold">日报自动推送</div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">改完点保存</span>
          <IconAction
            label="保存日报推送"
            icon={busy ? Loader2 : Save}
            loading={busy}
            variant="ghost"
            size="icon-sm"
            onClick={onSave}
            disabled={busy}
          />
        </div>
      </div>
      <div className={cn("space-y-3 text-xs", bare ? "pt-1" : "p-3")}>
        <label className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2.5">
          <div>
            <div className="font-medium text-foreground">音浪更新后自动发送</div>
            <div className="text-[10px] text-muted-foreground">
              推送给全部有会话联系人（前三文案 + 男女报告图）
            </div>
          </div>
          <input
            type="checkbox"
            className="size-4 accent-[#07c160]"
            checked={Boolean(push.enabled)}
            onChange={(event) => updatePush({ enabled: event.target.checked })}
          />
        </label>

        <label className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2.5">
          <div>
            <div className="font-medium text-foreground">午夜提醒</div>
            <div className="text-[10px] text-muted-foreground">
              每天过 0 点后给所有对接用户发「请发送音浪文件即可」
            </div>
          </div>
          <input
            type="checkbox"
            className="size-4 accent-[#07c160]"
            checked={Boolean(push.reminderEnabled)}
            onChange={(event) => updatePush({ reminderEnabled: event.target.checked })}
          />
        </label>

        <p className="text-[10px] leading-5 text-muted-foreground">
          任意用户可在聊天里发送「开启/关闭日报推送」切换开关。
        </p>

        {push.lastPush?.at ? (
          <div className="rounded-lg border bg-muted/20 px-2.5 py-1.5 text-[10px] text-muted-foreground">
            上次：{push.lastPush.date || "—"} · 成功 {push.lastPush.ok || 0} / 失败 {push.lastPush.fail || 0}
            {push.lastPush.skipped ? `（${push.lastPush.skipped}）` : ""} · {formatClock(push.lastPush.at)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CustomCommandsPanel({
  commands,
  busy,
  onAdd,
  onChange,
  onRemove,
  onSave,
  bare = false,
}: {
  commands: WeixinBotCustomCommand[];
  busy: boolean;
  onAdd: () => void;
  onChange: (id: string, patch: Partial<WeixinBotCustomCommand>) => void;
  onRemove: (id: string) => void;
  onSave: () => void;
  bare?: boolean;
}) {
  return (
    <div className={cn(!bare && "overflow-hidden rounded-xl border bg-card shadow-sm")}>
      <div className={cn("flex h-9 items-center justify-between", bare ? "px-0.5" : "border-b px-3")}>
        <div className="flex items-center gap-2">
          <Settings2 className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">自定义触发词</span>
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
      <div className={cn("max-h-48 space-y-2 overflow-y-auto", bare ? "pt-1" : "p-3")}>
        {commands.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-5 text-center text-[11px] text-muted-foreground">
            还没有自定义命令。点 + 添加触发词。
          </div>
        ) : (
          commands.map((command) => (
            <div key={command.id} className="space-y-1.5 rounded-lg border bg-muted/10 p-2.5">
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
    </div>
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
  bare = false,
}: {
  settings: WeixinBotSettings;
  apiKeyDraft: string;
  busy: boolean;
  onSettingsChange: (settings: WeixinBotSettings) => void;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
  onClearKey: () => void;
  bare?: boolean;
}) {
  const ai = settings.ai;
  return (
    <div className={cn(!bare && "overflow-hidden rounded-xl border bg-card shadow-sm")}>
      <div className={cn("flex h-9 items-center justify-between", bare ? "px-0.5" : "border-b px-3")}>
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">AI 接口</span>
          <span className="text-[10px] text-muted-foreground">微信 / QQ 共用</span>
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
      <div className={cn("space-y-2.5", bare ? "pt-1" : "p-3")}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-2 text-xs font-medium">
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
            启用智能对话
          </label>
          <label className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={ai.progressEnabled !== false}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  ai: { ...ai, progressEnabled: event.target.checked },
                })
              }
              className="size-4 accent-[#07c160]"
            />
            发送进度回执
          </label>
        </div>
        <Field
          label="接口地址"
          value={ai.baseUrl}
          onChange={(value) =>
            onSettingsChange({ ...settings, ai: { ...ai, baseUrl: value } })
          }
          placeholder="http://162.243.93.40:8317/v1"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Field
            label="模型"
            value={ai.model}
            onChange={(value) =>
              onSettingsChange({ ...settings, ai: { ...ai, model: value } })
            }
            placeholder="grok-4.5"
          />
          <Field
            label="单次请求超时（秒）"
            value={String(Math.round((Number(ai.timeoutMs) || 90_000) / 1000))}
            onChange={(value) => {
              const seconds = Number(value);
              const timeoutMs = Number.isFinite(seconds) && seconds > 0
                ? Math.min(120, Math.max(5, Math.round(seconds))) * 1000
                : 90_000;
              onSettingsChange({ ...settings, ai: { ...ai, timeoutMs } });
            }}
            placeholder="90"
          />
        </div>
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
        <p className="text-[10px] leading-5 text-muted-foreground">
          业务文本由 AI 选技能处理（查数/日报图/导出）；CSV 导入走确定性路径。
          Key 加密保存在本机，界面不回显明文。
        </p>
      </div>
    </div>
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
  bare = false,
}: {
  settings: WeixinBotSettings;
  busy: boolean;
  onChange: (settings: WeixinBotSettings) => void;
  onSave: () => void;
  bare?: boolean;
}) {
  return (
    <div className={cn("space-y-2", !bare && "overflow-hidden rounded-xl border bg-card p-3 shadow-sm")}>
      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={settings.autoReplyEnabled}
            onChange={(event) => onChange({ ...settings, autoReplyEnabled: event.target.checked })}
            className="size-4 accent-[#07c160]"
          />
          兜底自动回复
          <span className="font-normal text-muted-foreground">（命令 / AI / 导入均未命中时）</span>
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
        disabled={!settings.autoReplyEnabled}
        className="min-h-14 w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 text-xs outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
        aria-label="自动回复内容"
      />
      <p className="text-[10px] leading-4 text-muted-foreground">
        仅在未识别为命令 / AI / 导入时触发。
      </p>
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
    <section className="grid overflow-hidden rounded-xl border bg-card shadow-sm sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="flex items-center gap-2.5 border-b border-border/50 px-3 py-2.5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
          >
            <div className="flex size-7 items-center justify-center rounded-md bg-[#07c160]/10">
              <Icon className="size-3.5 text-[#07c160]" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-muted-foreground">{item.label}</div>
              <div className="truncate text-xs font-medium">{item.value}</div>
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
