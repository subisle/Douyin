"use client";

import Image from "next/image";
import { type ComponentProps, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  Clock3,
  Inbox,
  Loader2,
  LogOut,
  MessageCircle,
  QrCode,
  Save,
  Send,
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
  WeixinBotMessage,
  WeixinBotPhase,
  WeixinBotSettings,
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
};

const DEFAULT_SETTINGS: WeixinBotSettings = {
  autoReplyEnabled: false,
  autoReplyText: "消息已收到。",
};

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

type BusyAction = "login" | "cancel" | "start" | "stop" | "disconnect" | "send" | "save" | "clear";

interface Conversation {
  id: string;
  userId: string;
  groupId: string | null;
  lastMessage: WeixinBotMessage;
  messageCount: number;
}

export function WeixinBotPage() {
  const api = getDataApi();
  const [status, setStatus] = useState<WeixinBotStatus>(EMPTY_STATUS);
  const [messages, setMessages] = useState<WeixinBotMessage[]>([]);
  const [settings, setSettings] = useState<WeixinBotSettings>(DEFAULT_SETTINGS);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [draft, setDraft] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const messageEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!api) return;
    let active = true;

    void Promise.all([
      api.getWeixinBotStatus(),
      api.getWeixinBotMessages(),
      api.getWeixinBotSettings(),
    ]).then(([statusResult, messageResult, settingsResult]) => {
      if (!active) return;
      if (statusResult.success) setStatus(statusResult.data);
      else setFeedback(statusResult.error);
      if (messageResult.success) setMessages(messageResult.data);
      if (settingsResult.success) setSettings(settingsResult.data);
      setLoading(false);
    }).catch((error) => {
      if (!active) return;
      setFeedback(error instanceof Error ? error.message : String(error));
      setLoading(false);
    });

    const removeStatus = api.onWeixinBotStatus((next) => {
      if (active) setStatus(next);
    });
    const removeMessage = api.onWeixinBotMessage((message) => {
      if (!active) return;
      setMessages((current) => upsertMessage(current, message));
      setSelectedConversationId((current) => current || message.conversationId);
    });
    const removeCleared = api.onWeixinBotMessagesCleared(() => {
      if (!active) return;
      setMessages([]);
      setSelectedConversationId("");
    });

    return () => {
      active = false;
      removeStatus();
      removeMessage();
      removeCleared();
    };
  }, [api]);

  const conversations = useMemo(() => buildConversations(messages), [messages]);
  const selectedConversation = conversations.find((item) => item.id === selectedConversationId) || null;
  const visibleMessages = useMemo(
    () => messages.filter((message) => message.conversationId === selectedConversationId),
    [messages, selectedConversationId]
  );

  useEffect(() => {
    if (!selectedConversationId && conversations[0]) {
      setSelectedConversationId(conversations[0].id);
      return;
    }
    if (selectedConversationId && !conversations.some((item) => item.id === selectedConversationId)) {
      setSelectedConversationId(conversations[0]?.id || "");
    }
  }, [conversations, selectedConversationId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [visibleMessages]);

  async function runStatusAction(action: BusyAction, request: () => Promise<{ success: true; data: WeixinBotStatus } | { success: false; error: string }>) {
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

  function handleStart() {
    if (!api) return;
    void runStatusAction("start", () => api.startWeixinBot());
  }

  function handleStop() {
    if (!api) return;
    void runStatusAction("stop", () => api.stopWeixinBot());
  }

  function handleDisconnect() {
    if (!api || !window.confirm("断开微信机器人并清除本机连接凭据？")) return;
    void runStatusAction("disconnect", () => api.disconnectWeixinBot());
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!api || !selectedConversationId || !text || busyAction) return;
    setBusyAction("send");
    setFeedback("");
    try {
      const result = await api.sendWeixinBotMessage({
        conversationId: selectedConversationId,
        text,
      });
      if (!result.success) {
        setFeedback(result.error);
        return;
      }
      setMessages((current) => upsertMessage(current, result.data));
      setDraft("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveSettings() {
    if (!api || busyAction) return;
    setBusyAction("save");
    setFeedback("");
    try {
      const result = await api.saveWeixinBotSettings(settings);
      if (result.success) setSettings(result.data);
      else setFeedback(result.error);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleClearMessages() {
    if (!api || messages.length === 0 || !window.confirm("清空当前运行期间的微信消息记录？")) return;
    setBusyAction("clear");
    setFeedback("");
    try {
      const result = await api.clearWeixinBotMessages();
      if (result.success) {
        setMessages([]);
        setSelectedConversationId("");
      } else {
        setFeedback(result.error);
      }
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[640px] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-label="正在读取微信机器人状态" />
      </div>
    );
  }

  const loginActive = ["connecting", "awaiting_scan", "scanned"].includes(status.phase);

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
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{status.statusText}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {status.monitoring ? (
              <IconAction
                label="暂停机器人"
                icon={busyAction === "stop" ? Loader2 : CirclePause}
                loading={busyAction === "stop"}
                onClick={handleStop}
                disabled={busyAction !== null}
              />
            ) : status.connected && !loginActive ? (
              <IconAction
                label="启动机器人"
                icon={busyAction === "start" ? Loader2 : CirclePlay}
                loading={busyAction === "start"}
                onClick={status.phase === "session_expired" ? handleLogin : handleStart}
                disabled={busyAction !== null}
              />
            ) : null}
            {status.connected && !loginActive && (
              <IconAction
                label="断开并清除连接"
                icon={LogOut}
                variant="outline"
                onClick={handleDisconnect}
                disabled={busyAction !== null}
              />
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

        {!status.connected || loginActive ? (
          <ConnectionPanel
            status={status}
            busyAction={busyAction}
            onLogin={handleLogin}
            onCancel={handleCancelLogin}
          />
        ) : (
          <>
            <StatusStrip status={status} />
            <section className="grid min-h-[548px] overflow-hidden rounded-lg border border-border/70 bg-card/70 lg:grid-cols-[270px_minmax(0,1fr)]">
              <aside className="flex min-h-0 flex-col border-b border-border/70 lg:border-b-0 lg:border-r">
                <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <MessageCircle className="size-4 text-[#07c160]" />
                    会话
                    <span className="text-xs font-normal text-muted-foreground">{conversations.length}</span>
                  </div>
                  <IconAction
                    label="清空消息记录"
                    icon={busyAction === "clear" ? Loader2 : Trash2}
                    loading={busyAction === "clear"}
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleClearMessages}
                    disabled={messages.length === 0 || busyAction !== null}
                  />
                </div>

                <div className="min-h-40 flex-1 overflow-y-auto p-2">
                  {conversations.length === 0 ? (
                    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
                      <Inbox className="size-7 opacity-60" />
                      <span className="text-xs">暂无微信消息</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {conversations.map((conversation) => (
                        <ConversationButton
                          key={conversation.id}
                          conversation={conversation}
                          active={selectedConversationId === conversation.id}
                          onClick={() => setSelectedConversationId(conversation.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <AutoReplySettings
                  settings={settings}
                  busy={busyAction === "save"}
                  onChange={setSettings}
                  onSave={handleSaveSettings}
                />
              </aside>

              <div className="flex min-h-[548px] min-w-0 flex-col">
                {selectedConversation ? (
                  <>
                    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          {selectedConversation.groupId ? (
                            <UsersRound className="size-4 text-muted-foreground" />
                          ) : (
                            <UserRound className="size-4 text-muted-foreground" />
                          )}
                          <span className="truncate">{conversationTitle(selectedConversation)}</span>
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {selectedConversation.messageCount} 条
                      </span>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto bg-background/35 px-4 py-4">
                      <div className="space-y-3">
                        {visibleMessages.map((message) => (
                          <MessageBubble key={message.id} message={message} />
                        ))}
                        <div ref={messageEndRef} />
                      </div>
                    </div>

                    <form className="flex shrink-0 items-end gap-2 border-t border-border/70 p-3" onSubmit={handleSend}>
                      <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                          }
                        }}
                        rows={2}
                        maxLength={4000}
                        className="min-h-16 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                        aria-label="回复内容"
                      />
                      <IconAction
                        label="发送消息"
                        icon={busyAction === "send" ? Loader2 : Send}
                        loading={busyAction === "send"}
                        className="size-10"
                        disabled={!draft.trim() || busyAction !== null}
                        type="submit"
                      />
                    </form>
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                    <MessageCircle className="size-9 opacity-50" />
                    <span className="text-sm">等待微信消息</span>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </TooltipProvider>
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
  return (
    <section className="grid min-h-[590px] overflow-hidden rounded-lg border border-border/70 bg-card/70 md:grid-cols-[minmax(0,0.85fr)_minmax(360px,1.15fr)]">
      <div className="flex flex-col justify-between border-b border-border/70 p-6 md:border-b-0 md:border-r">
        <div className="space-y-5">
          <div className="flex size-12 items-center justify-center rounded-lg bg-[#07c160]/10 text-[#079948]">
            {hasQr ? <QrCode className="size-6" /> : <Bot className="size-6" />}
          </div>
          <div>
            <h3 className="text-lg font-semibold">{hasQr ? "微信扫码连接" : "连接微信机器人"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{status.statusText}</p>
          </div>
          <div className="space-y-2 text-xs text-muted-foreground">
            <ConnectionRow label="接口" value="微信 iLink" />
            <ConnectionRow label="凭据" value="系统加密存储" />
            <ConnectionRow label="状态" value={PHASE_LABEL[status.phase]} />
          </div>
        </div>

        <div className="pt-6">
          {hasQr || status.phase === "connecting" || status.phase === "scanned" ? (
            <Button variant="outline" onClick={onCancel} disabled={busyAction !== null}>
              {busyAction === "cancel" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              取消连接
            </Button>
          ) : (
            <Button
              onClick={onLogin}
              disabled={!status.available || busyAction !== null}
              className="bg-[#07c160] text-white hover:bg-[#06ad56]"
            >
              {busyAction === "login" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <QrCode className="size-4" />
              )}
              {status.available ? "扫码连接" : "桌面端不可用"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-[420px] items-center justify-center bg-muted/20 p-6">
        {status.qrDataUrl ? (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-lg border border-border/80 bg-white p-3 shadow-sm">
              <Image
                src={status.qrDataUrl}
                alt="微信登录二维码"
                width={256}
                height={256}
                unoptimized
                className="size-64"
                priority
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {status.phase === "scanned" ? (
                <CheckCircle2 className="size-4 text-[#07c160]" />
              ) : (
                <Clock3 className="size-4" />
              )}
              {status.phase === "scanned" ? "已扫码，等待确认" : `二维码有效至 ${formatClock(status.qrExpiresAt)}`}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            {status.phase === "connecting" ? (
              <Loader2 className="size-10 animate-spin text-[#07c160]" />
            ) : (
              <QrCode className="size-12 opacity-35" />
            )}
            <span className="text-sm">{status.phase === "connecting" ? "正在生成二维码" : PHASE_LABEL[status.phase]}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function ConnectionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function StatusStrip({ status }: { status: WeixinBotStatus }) {
  const values = [
    { label: "Bot ID", value: compactId(status.accountId) },
    { label: "收到", value: String(status.receivedCount) },
    { label: "发送", value: String(status.sentCount) },
    { label: "最近轮询", value: formatRelative(status.lastPollAt) },
  ];
  return (
    <section className="grid overflow-hidden rounded-lg border border-border/70 bg-card/60 sm:grid-cols-2 lg:grid-cols-4">
      {values.map((item) => (
        <div key={item.label} className="min-w-0 border-b border-border/60 px-4 py-3 sm:odd:border-r sm:[&:nth-child(n+3)]:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
          <div className="text-xs text-muted-foreground">{item.label}</div>
          <div className="mt-1 truncate text-sm font-semibold" title={item.value}>{item.value}</div>
        </div>
      ))}
    </section>
  );
}

function ConversationButton({
  conversation,
  active,
  onClick,
}: {
  conversation: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition",
        active ? "bg-[#07c160]/10 text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      <div className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg border",
        active ? "border-[#07c160]/25 bg-[#07c160] text-white" : "border-border bg-background"
      )}>
        {conversation.groupId ? <UsersRound className="size-4" /> : <UserRound className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{conversationTitle(conversation)}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{formatClock(conversation.lastMessage.createdAt)}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{conversation.lastMessage.content}</div>
      </div>
    </button>
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
    <div className="shrink-0 space-y-2 border-t border-border/70 p-3">
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
        className="min-h-14 w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 text-xs outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
        aria-label="自动回复内容"
      />
    </div>
  );
}

function MessageBubble({ message }: { message: WeixinBotMessage }) {
  const outbound = message.direction === "outbound";
  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[78%] rounded-lg border px-3 py-2 shadow-xs",
        outbound
          ? "border-[#07c160]/25 bg-[#d9fdd3] text-[#17231d] dark:bg-[#0b5b30] dark:text-white"
          : "border-border/70 bg-card"
      )}>
        <div className="whitespace-pre-wrap break-words text-sm leading-5">{message.content}</div>
        <div className={cn(
          "mt-1 flex items-center justify-end gap-1.5 text-[10px]",
          outbound ? "text-[#315b3e] dark:text-white/70" : "text-muted-foreground"
        )}>
          <span>{formatClock(message.createdAt)}</span>
          {message.status === "failed" && <span className="font-medium text-red-600">发送失败</span>}
        </div>
      </div>
    </div>
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

function buildConversations(messages: WeixinBotMessage[]): Conversation[] {
  const grouped = new Map<string, Conversation>();
  for (const message of messages) {
    const current = grouped.get(message.conversationId);
    grouped.set(message.conversationId, {
      id: message.conversationId,
      userId: message.userId,
      groupId: message.groupId,
      lastMessage: !current || Date.parse(message.createdAt) >= Date.parse(current.lastMessage.createdAt)
        ? message
        : current.lastMessage,
      messageCount: (current?.messageCount || 0) + 1,
    });
  }
  return Array.from(grouped.values()).sort(
    (a, b) => Date.parse(b.lastMessage.createdAt) - Date.parse(a.lastMessage.createdAt)
  );
}

function upsertMessage(messages: WeixinBotMessage[], message: WeixinBotMessage) {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index < 0) return [...messages, message].slice(-200);
  const next = [...messages];
  next[index] = message;
  return next;
}

function conversationTitle(conversation: Pick<Conversation, "groupId" | "userId">) {
  return conversation.groupId
    ? `群聊 ${compactId(conversation.groupId)}`
    : `微信用户 ${compactId(conversation.userId)}`;
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
