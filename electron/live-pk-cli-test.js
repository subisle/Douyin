const { app } = require("electron");
const fs = require("fs");
const { LivePkWatcher } = require("./live-pk-watcher");
const { captureDouyinLiveOptions } = require("./live-pk-capture");

const liveRoomUrl = process.argv[2];
const maxMinutes = Number(process.argv[3] || 0);
const jsonlPath = process.env.DOUYIN_LIVE_JSONL || "";

function time() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function nameOf(payload) {
  if (payload.isMystery && payload.displayName && payload.realName && payload.displayName !== payload.realName) {
    return `${payload.realName}(${payload.displayName})`;
  }
  return payload.realName || payload.nickname || payload.displayName || payload.userId || "未知";
}

function identity(payload) {
  const parts = [];
  if (payload.cacheHit) parts.push("缓存命中");
  if (payload.isMystery) parts.push(`神秘人${payload.mysteryMan ? `L${payload.mysteryMan}` : ""}`);
  if (payload.uniqueId) parts.push(`抖音号:${payload.uniqueId}`);
  if (payload.secUid) parts.push(`sec:${payload.secUid.slice(0, 12)}...`);
  if (payload.userLevel) parts.push(`用户等级:${payload.userLevel}`);
  if (payload.badgeLevel) parts.push(`徽章等级:${payload.badgeLevel}`);
  if (payload.consumeLevel) parts.push(`财富等级:${payload.consumeLevel}`);
  if (payload.payScore) parts.push(`付费分:${payload.payScore}`);
  if (payload.totalRechargeDiamondCount) parts.push(`充值钻石:${payload.totalRechargeDiamondCount}`);
  if (payload.fanTicketCount) parts.push(`粉丝票:${payload.fanTicketCount}`);
  return parts.length ? ` [${parts.join(" / ")}]` : "";
}

function eventLabel(eventType) {
  const labels = {
    "room-user-seq": "在线榜",
    "room-stats": "在线人数",
    fansclub: "粉丝团",
    social: "社交",
    like: "点赞",
    "pico-like": "互动点赞",
    "chat-like": "弹幕点赞",
    "room-message": "房间消息",
    "room-verify": "房间校验",
    "room-start": "开播",
    "short-touch-area": "短触区",
    "in-room-banner": "房间横幅",
    "ranklist-hour-entrance": "小时榜",
    "rank-list-hour-enter": "小时榜",
    "gift-update": "礼物更新",
    "linkmic-score": "连线分数",
    "live-mode": "直播形态",
    "pk-battle": "PK状态",
    "pk-score-snapshot": "PK分数",
  };
  return labels[eventType] || eventType || "事件";
}

function eventSummary(payload) {
  if (payload.eventType === "room-stats") {
    return [payload.displayShort, payload.displayMiddle, payload.displayLong, payload.total ? `累计${payload.total}` : ""]
      .filter(Boolean)
      .join(" / ");
  }
  if (payload.eventType === "room-user-seq") {
    return [
      payload.totalUserText || (payload.totalUser ? `在线${payload.totalUser}` : ""),
      payload.popularityText || (payload.popularity ? `人气${payload.popularity}` : ""),
      payload.upRightStatsText,
      payload.ranks?.length ? `榜单${payload.ranks.length}人` : "",
    ].filter(Boolean).join(" / ");
  }
  if (payload.eventType === "like" || payload.eventType === "pico-like") {
    return [
      payload.count ? `本次${payload.count}` : "",
      payload.total ? `累计${payload.total}` : "",
      payload.emoji || "",
      payload.scene || "",
    ].filter(Boolean).join(" / ");
  }
  if (payload.eventType === "chat-like") {
    return [
      payload.count ? `弹幕点赞${payload.count}` : "",
      Array.isArray(payload.entries) ? `${payload.entries.length}条消息` : "",
    ].filter(Boolean).join(" / ");
  }
  if (payload.eventType === "linkmic-score") {
    return [
      payload.hotScore ? `热度分${payload.hotScore}` : "",
      payload.scoreSource !== undefined ? `来源${payload.scoreSource}` : "",
      payload.extra || "",
    ].filter(Boolean).join(" / ");
  }
  if (payload.eventType === "live-mode" || payload.eventType === "pk-battle" || payload.eventType === "pk-score-snapshot") {
    const scores = Array.isArray(payload.scores)
      ? payload.scores.map((score) => {
          const name = score.realName || score.displayName || score.nickname || score.anchorId || score.userId || "";
          return `${name}(${score.anchorId || score.userId || ""})=${score.score}`;
        }).join(" / ")
      : "";
    return [
      payload.liveModeLabel || payload.liveMode || "",
      payload.participantCount ? `${payload.participantCount}方` : "",
      payload.pkCountDown !== undefined ? `倒计时${payload.pkCountDown}` : "",
      scores,
      payload.battlePhase ? `阶段${payload.battlePhase}` : "",
      payload.battleId ? `battle:${payload.battleId}` : "",
    ].filter(Boolean).join(" / ");
  }
  if (payload.eventType === "short-touch-area") {
    return [payload.name, payload.messageType !== undefined ? `消息类型${payload.messageType}` : "", payload.containerPayload]
      .filter(Boolean)
      .join(" / ");
  }
  if (payload.eventType === "in-room-banner") {
    return [payload.position !== undefined ? `位置${payload.position}` : "", payload.actionType !== undefined ? `动作${payload.actionType}` : "", payload.containerUrl || payload.lynxContainerUrl]
      .filter(Boolean)
      .join(" / ");
  }
  if (payload.eventType === "gift-update") {
    return [
      payload.updateType !== undefined ? `更新${payload.updateType}` : "",
      Array.isArray(payload.updateGiftIds) ? `礼物${payload.updateGiftIds.length}` : "",
      Array.isArray(payload.updateAssetIds) ? `资产${payload.updateAssetIds.length}` : "",
    ].filter(Boolean).join(" / ");
  }
  return [payload.content, payload.tipContent, payload.shareTarget, payload.method].filter(Boolean).join(" / ");
}

if (!liveRoomUrl) {
  console.error("用法: electron electron/live-pk-cli-test.js <直播间URL> [最多分钟数, 0表示持续]");
  process.exit(1);
}

app.on("window-all-closed", () => {
  // CLI 测试需要采集窗口关闭后继续保持 WebSocket 监听。
});

app.whenReady().then(async () => {
  const keepAlive = setInterval(() => {}, 60 * 60 * 1000);
  const watcher = new LivePkWatcher();
  const writeJsonl = (payload) => {
    if (!jsonlPath) return;
    fs.appendFileSync(jsonlPath, `${JSON.stringify(payload)}\n`);
  };
  watcher.on("status", (status) => {
    console.log(`[${time()}] 状态: ${status.status}${status.lastError ? ` ${status.lastError}` : ""}`);
    writeJsonl({ type: "status", at: new Date().toISOString(), status });
  });
  watcher.on("error-message", (message) => {
    console.log(`[${time()}] 错误: ${message}`);
    writeJsonl({ type: "error", at: new Date().toISOString(), message });
  });
  watcher.on("raw-message", (payload) => {
    writeJsonl(payload);
  });
  watcher.on("rank", (payload) => {
    writeJsonl(payload);
    const rows = payload.ranks.filter((rank) => rank.score > 0);
    if (rows.length === 0) return;
    for (const rank of rows) {
      console.log(
        `[${time()}] 分数 #${rank.rank} ${nameOf(rank)} ${rank.score}${identity(rank)}`
      );
    }
  });
  watcher.on("gift", (payload) => {
    writeJsonl(payload);
    const bonus = payload.bonusScore > 0
      ? ` 加成+${payload.bonusScore}(x${payload.bonusRate.toFixed(2)})`
      : "";
    console.log(
      `[${time()}] 礼物 ${nameOf(payload)} ${payload.giftName} x${payload.count} 单价${payload.diamondCount} 基础${payload.baseScore} 实际${payload.fanTicket}${bonus}${identity(payload)}`
      + `${payload.roomFanTicketCount ? ` 房间累计${payload.roomFanTicketCount}` : ""}`
    );
  });
  watcher.on("member", (payload) => {
    writeJsonl(payload);
    console.log(`[${time()}] 进场 ${nameOf(payload)}${identity(payload)}`);
  });
  watcher.on("chat", (payload) => {
    writeJsonl(payload);
    console.log(`[${time()}] 弹幕 ${nameOf(payload)}: ${payload.content}${identity(payload)}${payload.priorityLevel ? ` 优先级${payload.priorityLevel}` : ""}`);
  });
  watcher.on("event", (payload) => {
    writeJsonl(payload);
    console.log(`[${time()}] ${eventLabel(payload.eventType)} ${payload.nickname || ""}${identity(payload)} ${eventSummary(payload)}`.trim());
  });

  console.log(`[${time()}] 打开采集窗口: ${liveRoomUrl}`);
  const capture = captureDouyinLiveOptions(liveRoomUrl, {
    onStatus: (message) => console.log(`[${time()}] 采集: ${message}`),
    cookie: process.env.DOUYIN_LIVE_COOKIE || "",
    keepAlive: true,
  });
  const options = await capture.promise;
  if (process.env.DOUYIN_LIVE_COOKIE) options.cookie = process.env.DOUYIN_LIVE_COOKIE;
  console.log(`[${time()}] 已获取 IM 连接，开始持续监控`);
  await watcher.start({ ...options, includeRaw: Boolean(jsonlPath) });

  if (maxMinutes > 0) {
    setTimeout(() => {
      clearInterval(keepAlive);
      watcher.stop();
      app.quit();
    }, maxMinutes * 60 * 1000);
  }
}).catch((error) => {
  console.error(`[${time()}] 启动失败:`, error);
  app.quit();
});
