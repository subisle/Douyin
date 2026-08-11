"use client";

import { useState } from "react";
import { Bot, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { WeixinBotPage } from "./weixin-bot-page";
import { QqBotPage } from "./qq-bot-page";

type BotTab = "weixin" | "qq";

const BOT_TABS: {
  id: BotTab;
  label: string;
  icon: typeof Bot;
  desc: string;
}[] = [
  {
    id: "weixin",
    label: "微信",
    icon: Bot,
    desc: "iLink 扫码 · 私聊/群聊",
  },
  {
    id: "qq",
    label: "QQ",
    icon: MessageCircle,
    desc: "开放平台 · 群@/私聊",
  },
];

/**
 * 机器人合并页：微信 iLink 与 QQ 开放平台共用同一套 Agent / 技能 / 日报，
 * 差异只在传输通道与身份（openid）；页内 Tab 切换，两侧状态相互独立。
 */
export function BotPage() {
  const [tab, setTab] = useState<BotTab>("weixin");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1 shadow-sm">
        {BOT_TABS.map(({ id, label, icon: Icon, desc }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={active}
              className={cn(
                "flex min-w-[7.5rem] flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors sm:flex-none",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="font-medium">{label}</span>
              <span
                className={cn(
                  "hidden text-xs sm:inline",
                  active ? "text-primary-foreground/80" : "text-muted-foreground/70"
                )}
              >
                {desc}
              </span>
            </button>
          );
        })}
      </div>

      {/* 两侧都挂载，隐藏非活动页，避免切换时丢状态 / 重拉设置 */}
      <div className={tab === "weixin" ? "block" : "hidden"}>
        <WeixinBotPage embedded />
      </div>
      <div className={tab === "qq" ? "block" : "hidden"}>
        <QqBotPage embedded />
      </div>
    </div>
  );
}
