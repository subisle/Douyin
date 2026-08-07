"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Play, RefreshCw, Search, Square } from "lucide-react";
import { getDataApi } from "@/client/http-electron-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useElectronData } from "./use-electron-data";
import type {
  AnchorRow,
  LivePkMultiMonitorStatus,
  LivePkMultiRoomInput,
  LivePkMultiRoomStatus,
  LivePkMultiScoreRow,
} from "@/types/electron";

const IDLE_MULTI: LivePkMultiMonitorStatus = {
  status: "idle",
  roomCount: 0,
  runningCount: 0,
  pendingCount: 0,
  errorCount: 0,
  maxRooms: 32,
  captureConcurrency: 8,
  preferProtocol: true,
  scoreOnly: true,
  updatedAt: "",
  rooms: [],
};

function safeText(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function compactNumber(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  if (number >= 100000000) return `${(number / 100000000).toFixed(1)}亿`;
  if (number >= 10000) return `${(number / 10000).toFixed(1)}万`;
  return String(Math.round(number) || 0);
}

/** 从主播档案推断直播间 URL：优先数字抖音号/主播 ID 作为 web_rid */
function roomUrlFromAnchor(anchor: AnchorRow): string {
  const candidates = [anchor.douyinNo, anchor.anchorId, ...(anchor.aliasIds || [])]
    .map((value) => safeText(value).trim())
    .filter(Boolean);
  for (const raw of candidates) {
    if (/^https?:\/\/live\.douyin\.com\//i.test(raw)) return raw;
    const rid = raw.replace(/^@/, "");
    if (/^\d{6,}$/.test(rid)) return `https://live.douyin.com/${rid}`;
  }
  return "";
}

function selectionKey(anchor: AnchorRow) {
  return String(anchor.id || anchor.anchorId || anchor.douyinNo);
}

function statusTone(status: string) {
  switch (status) {
    case "running":
      return "default" as const;
    case "queued":
    case "capturing":
    case "connecting":
      return "outline" as const;
    case "error":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "running":
      return "运行中";
    case "queued":
      return "排队";
    case "capturing":
      return "进房中";
    case "connecting":
      return "连接中";
    case "error":
      return "错误";
    case "idle":
      return "空闲";
    case "starting":
      return "启动中";
    case "partial":
      return "部分运行";
    default:
      return status || "—";
  }
}

function topScore(scores: LivePkMultiScoreRow[] | undefined) {
  if (!scores?.length) return null;
  return [...scores].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
}

function parseExtraUrls(text: string): LivePkMultiRoomInput[] {
  const lines = text
    .split(/[\n,，\s]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rooms: LivePkMultiRoomInput[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    let url = line;
    if (/^\d{6,}$/.test(line)) url = `https://live.douyin.com/${line}`;
    if (!/^https?:\/\/live\.douyin\.com\//i.test(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rid = url.replace(/^https?:\/\/live\.douyin\.com\//i, "").split(/[/?#]/)[0];
    rooms.push({
      liveRoomUrl: url,
      name: rid || url,
      douyinNo: rid,
      anchorId: rid,
    });
  }
  return rooms;
}

export function MultiMonitorPage({ active = true }: { active?: boolean }) {
  const anchorsRes = useElectronData((api) => api.getAnchors());
  const anchors = useMemo(() => anchorsRes.data ?? [], [anchorsRes.data]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [extraUrls, setExtraUrls] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [multiStatus, setMultiStatus] = useState<LivePkMultiMonitorStatus>(IDLE_MULTI);

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase();
    if (!kw) return anchors;
    return anchors.filter((anchor) => {
      const hay = [
        anchor.name,
        anchor.anchorName,
        anchor.anchorId,
        anchor.douyinNo,
        ...(anchor.aliasIds || []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(kw);
    });
  }, [anchors, query]);

  const selectable = useMemo(
    () =>
      filtered
        .map((anchor) => ({
          anchor,
          key: selectionKey(anchor),
          url: roomUrlFromAnchor(anchor),
        }))
        .filter((row) => row.url),
    [filtered]
  );

  const selectedRooms = useMemo(() => {
    const fromAnchors: LivePkMultiRoomInput[] = [];
    for (const anchor of anchors) {
      const key = selectionKey(anchor);
      if (!selected.has(key)) continue;
      const url = roomUrlFromAnchor(anchor);
      if (!url) continue;
      fromAnchors.push({
        liveRoomUrl: url,
        personId: String(anchor.id),
        anchorId: anchor.anchorId || anchor.douyinNo,
        name: anchor.name || anchor.anchorName || anchor.douyinNo || anchor.anchorId,
        douyinNo: anchor.douyinNo || "",
      });
    }
    const extras = parseExtraUrls(extraUrls);
    const seen = new Set(fromAnchors.map((room) => safeText(room.liveRoomUrl).toLowerCase()));
    for (const room of extras) {
      const key = safeText(room.liveRoomUrl).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      fromAnchors.push(room);
    }
    return fromAnchors;
  }, [anchors, extraUrls, selected]);

  useEffect(() => {
    const api = getDataApi();
    if (!api?.onLivePkMultiStatus) return;
    const off = api.onLivePkMultiStatus((status) => {
      setMultiStatus(status);
    });
    void api.getLivePkMultiMonitorStatus?.().then((result) => {
      if (result.success) setMultiStatus(result.data);
    });
    return () => off();
  }, []);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of selectable) next.add(row.key);
      return next;
    });
  }, [selectable]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const startMonitor = async () => {
    const api = getDataApi();
    if (!api?.startLivePkMultiMonitor) {
      setMessage("当前环境不支持多主播监控");
      return;
    }
    if (selectedRooms.length === 0) {
      setMessage("请至少选择一名有可解析直播间 ID 的主播，或粘贴直播间 URL");
      return;
    }
    setBusy(true);
    setMessage(`并行音浪监控 · ${selectedRooms.length} 路 · 无需 Cookie`);
    const result = await api.startLivePkMultiMonitor({
      rooms: selectedRooms,
      // 只监控音浪：不采礼物/弹幕/进场，不传 cookie
      captureConcurrency: Math.min(8, Math.max(2, selectedRooms.length)),
      preferProtocol: true,
      scoreOnly: true,
    });
    setBusy(false);
    if (!result.success) {
      setMessage(result.error || "启动失败");
      return;
    }
    setMultiStatus(result.data);
    setMessage(
      `音浪监控 ${result.data.roomCount} 路 · 运行 ${result.data.runningCount} · 排队 ${result.data.pendingCount}`
    );
  };

  const stopMonitor = async () => {
    const api = getDataApi();
    if (!api?.stopLivePkMultiMonitor) return;
    setBusy(true);
    const result = await api.stopLivePkMultiMonitor();
    setBusy(false);
    if (!result.success) {
      setMessage(result.error || "停止失败");
      return;
    }
    setMultiStatus(result.data);
    setMessage("已全部停止");
  };

  const running =
    multiStatus.status === "running" ||
    multiStatus.status === "starting" ||
    multiStatus.status === "partial";

  return (
    <div className={cn("space-y-4", !active && "hidden")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={running ? "default" : "secondary"}>
          {statusLabel(multiStatus.status)}
        </Badge>
        <span className="text-sm text-muted-foreground">
          运行 {multiStatus.runningCount}/{multiStatus.roomCount || selectedRooms.length}
          {multiStatus.errorCount > 0 ? ` · 错误 ${multiStatus.errorCount}` : ""}
          {` · 并发 ${multiStatus.captureConcurrency || 8}`}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">只监控音浪 · 协议并行 · 无需 Cookie</span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索主播名 / 抖音号 / 主播 ID"
            className="h-10 pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="h-10" onClick={selectVisible}>
            全选可见
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-10" onClick={clearSelection}>
            清空选择
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10"
            onClick={() => anchorsRes.reload?.()}
            disabled={anchorsRes.loading}
          >
            <RefreshCw className={cn("size-4", anchorsRes.loading && "animate-spin")} />
            刷新名单
          </Button>
          <Button
            type="button"
            className="h-10 min-w-20"
            disabled={busy || selectedRooms.length === 0}
            onClick={() => void startMonitor()}
          >
            <Play className="size-4" />
            开始 ({selectedRooms.length})
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 min-w-20"
            disabled={busy || multiStatus.roomCount === 0}
            onClick={() => void stopMonitor()}
          >
            <Square className="size-4" />
            停止
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-3">
          <div className="rounded-xl border border-border/70 bg-card/40">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <div className="text-sm font-semibold">主播列表</div>
              <div className="text-xs text-muted-foreground">
                已选 {selected.size} · 可解析 {selectable.length}/{filtered.length}
              </div>
            </div>
            <div className="max-h-[420px] overflow-auto p-2">
              {anchorsRes.loading && anchors.length === 0 ? (
                <div className="px-2 py-8 text-center text-sm text-muted-foreground">加载主播…</div>
              ) : anchorsRes.error ? (
                <div className="px-2 py-8 text-center text-sm text-destructive">{anchorsRes.error}</div>
              ) : selectable.length === 0 ? (
                <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                  无可用直播间 ID（需数字抖音号/主播 ID）。可在下方粘贴 URL。
                </div>
              ) : (
                <div className="space-y-1">
                  {selectable.map(({ anchor, key, url }) => {
                    const checked = selected.has(key);
                    return (
                      <label
                        key={key}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                          checked ? "bg-primary/10" : "hover:bg-muted/50"
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          checked={checked}
                          onChange={() => toggle(key)}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium" title={anchor.name}>
                          {anchor.name || anchor.anchorName || "未命名"}
                        </span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground" title={url}>
                          {anchor.douyinNo || anchor.anchorId}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/40 p-3">
            <div className="mb-2 text-sm font-semibold">额外直播间 URL / web_rid</div>
            <textarea
              value={extraUrls}
              onChange={(event) => setExtraUrls(event.target.value)}
              placeholder={"每行一个，例如：\nhttps://live.douyin.com/778931042122\n724154245800"}
              className="h-24 w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-none transition focus:border-ring focus:ring-[3px] focus:ring-ring/50"
            />
            <div className="mt-1 text-[11px] text-muted-foreground">
              与左侧多选合并去重 · 最多 {multiStatus.maxRooms || 32} 路并行
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/40 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">实时分数卡</div>
            <div className="text-xs text-muted-foreground">
              {multiStatus.rooms.length > 0
                ? `${multiStatus.rooms.length} 路音浪`
                : "开始后显示各房音浪"}
            </div>
          </div>
          {multiStatus.rooms.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 px-4 py-16 text-center text-sm text-muted-foreground">
              多选开播主播后点开始 · 只监控音浪 · 无需 Cookie
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {multiStatus.rooms.map((room) => (
                <RoomCard key={room.sessionId} room={room} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-5 text-xs text-muted-foreground">{message}</div>
    </div>
  );
}

function RoomCard({ room }: { room: LivePkMultiRoomStatus }) {
  const top = topScore(room.scores);
  const ranked = [...(room.scores || [])].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3);
  const leader = ranked[0]?.score || 1;

  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" title={room.name}>
            {room.name || room.ownerNickname || room.douyinNo || "未命名"}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={room.liveRoomUrl}>
            {room.source || room.transport || "protocol"}
            {room.roomId ? ` · ${room.roomId}` : ""}
          </div>
        </div>
        <Badge variant={statusTone(room.status)} className="shrink-0">
          {statusLabel(room.status)}
        </Badge>
      </div>

      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          音浪刷新 {room.eventCount || 0}
          {room.onlineText ? ` · ${room.onlineText}` : ""}
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold text-muted-foreground">音浪 Top</div>
          <div className="text-lg font-black tabular-nums leading-none">
            {top ? top.scoreText || compactNumber(top.score) : "—"}
          </div>
        </div>
      </div>

      {ranked.length > 0 && (
        <div className="mt-2 space-y-1">
          {ranked.map((score, index) => {
            const width = Math.max(4, Math.round(((score.score || 0) / leader) * 100));
            return (
              <div key={`${score.anchorId}-${index}`} className="grid grid-cols-[16px_1fr_48px] items-center gap-1.5 text-[11px]">
                <span className="tabular-nums text-muted-foreground">{index + 1}</span>
                <div className="min-w-0">
                  <div className="truncate font-medium">{score.name || score.uniqueId || score.anchorId || "—"}</div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", index === 0 ? "bg-primary" : "bg-muted-foreground/30")}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
                <span className="text-right font-semibold tabular-nums">
                  {score.scoreText || compactNumber(score.score)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {(room.lastError || room.lastMessage) && (
        <div
          className={cn(
            "mt-2 truncate text-[11px]",
            room.lastError ? "text-destructive" : "text-muted-foreground"
          )}
          title={room.lastError || room.lastMessage}
        >
          {room.lastError || room.lastMessage}
        </div>
      )}
    </div>
  );
}
