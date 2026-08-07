#!/usr/bin/env node
/**
 * Smoke multi-room protocol enter: concurrent, lean bootstrap, shared gifts.
 * Usage: node scripts/smoke-live-multi.mjs [web_rid...]
 */
import { createRequire } from "module";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const { LivePkMultiMonitor } = require("../electron/live-pk-multi-monitor.js");
const {
  resolveDouyinLiveOptions,
  fetchGiftListShared,
} = require("../electron/live-pk-protocol.js");
const { LivePkWatcher } = require("../electron/live-pk-watcher.js");

const rooms = process.argv.slice(2);
const targets = rooms.length > 0
  ? rooms
  : ["724154245800", "967902661800"];

function openWsBrief(url, cookie, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        cookie: cookie || undefined,
        origin: "https://live.douyin.com",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch { /* ignore */ }
      reject(new Error(`WSS 超时 ${timeoutMs}ms`));
    }, timeoutMs);
    let opened = false;
    let firstMsg = null;
    ws.on("open", () => {
      opened = true;
    });
    ws.on("message", (data) => {
      if (firstMsg) return;
      firstMsg = Buffer.isBuffer(data) ? data : Buffer.from(data);
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve({ opened, bytes: firstMsg.length });
    });
    ws.on("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`WSS unexpected-response http ${res.statusCode}`));
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on("close", () => {
      if (firstMsg) return;
      clearTimeout(timer);
      if (opened) resolve({ opened, bytes: 0 });
      else reject(new Error("WSS closed before open/message"));
    });
  });
}

async function smokeLeanSharedEnter() {
  console.log("\n=== lean shared enter (parallel) ===");
  const started = Date.now();
  const results = await Promise.all(
    targets.map(async (webRid) => {
      const t0 = Date.now();
      const options = await resolveDouyinLiveOptions(`https://live.douyin.com/${webRid}`, {
        bootstrapMode: "lean",
        shareGiftList: true,
        onStatus: (msg) => console.log(`  [${webRid}] ${msg}`),
      });
      const giftCount =
        options.bootstrap?.giftList?.data?.pages?.[0]?.gifts?.length ||
        options.bootstrap?.giftList?.data?.gifts?.length ||
        0;
      const mode = options.bootstrap?.bootstrapMode;
      console.log(
        `  [${webRid}] room=${options.roomId} gifts=${giftCount} mode=${mode} source=${options.source} ${Date.now() - t0}ms`
      );
      const ws = await openWsBrief(options.websocketUrl, options.cookie);
      console.log(`  [${webRid}] WSS firstFrame=${ws.bytes}B`);
      return {
        webRid,
        roomId: options.roomId,
        giftCount,
        mode,
        wsBytes: ws.bytes,
        ms: Date.now() - t0,
      };
    })
  );
  console.log(`  parallel total wall=${Date.now() - started}ms rooms=${results.length}`);
  const cacheT0 = Date.now();
  const again = await fetchGiftListShared(results[0].roomId, results[0].webRid, "");
  const againCount =
    again?.data?.pages?.[0]?.gifts?.length || again?.data?.gifts?.length || 0;
  console.log(`  gift cache re-fetch gifts=${againCount} in ${Date.now() - cacheT0}ms`);
  return results;
}

async function smokeMultiMonitor() {
  console.log("\n=== LivePkMultiMonitor concurrent start ===");
  const monitor = new LivePkMultiMonitor({
    createWatcher: () => new LivePkWatcher(),
    captureLiveOptions: async (url, opts) => {
      const resolved = await resolveDouyinLiveOptions(url, {
        cookie: opts?.cookie || "",
        onStatus: opts?.onStatus,
        bootstrapMode: opts?.bootstrapMode || "lean",
        shareGiftList: opts?.shareGiftList !== false,
      });
      return resolved;
    },
    maxRooms: 16,
    captureConcurrency: 4,
    preferProtocol: true,
  });

  const roomInputs = targets.map((webRid) => ({
    liveRoomUrl: `https://live.douyin.com/${webRid}`,
    name: webRid,
    douyinNo: webRid,
  }));
  const t0 = Date.now();
  monitor.start({ rooms: roomInputs, captureConcurrency: Math.min(4, targets.length) });

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const s = monitor.getStatus();
    if (s.pendingCount === 0 && s.roomCount > 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const final = monitor.getStatus();
  const wall = Date.now() - t0;
  console.log(
    `  status=${final.status} running=${final.runningCount}/${final.roomCount} error=${final.errorCount} wall=${wall}ms`
  );
  for (const room of final.rooms) {
    console.log(
      `  · ${room.name} status=${room.status} source=${room.source} transport=${room.transport} roomId=${room.roomId} events=${room.eventCount} msg=${room.lastMessage}${room.lastError ? ` err=${room.lastError}` : ""}`
    );
  }

  await new Promise((r) => setTimeout(r, 4000));
  const after = monitor.getStatus();
  let totalEvents = 0;
  for (const room of after.rooms) {
    totalEvents += room.eventCount;
    console.log(
      `  after-hold ${room.name} events=${room.eventCount} gifts=${room.giftEvents} chats=${room.chatEvents} members=${room.memberEvents}`
    );
  }
  monitor.stop();
  return {
    running: final.runningCount,
    error: final.errorCount,
    wall,
    totalEvents,
    rooms: after.rooms.map((r) => ({
      name: r.name,
      status: r.status,
      source: r.source,
      events: r.eventCount,
    })),
  };
}

async function main() {
  const lean = await smokeLeanSharedEnter();
  const multi = await smokeMultiMonitor();
  console.log("\n--- summary ---");
  for (const r of lean) {
    console.log(`OK lean ${r.webRid} room=${r.roomId} gifts=${r.giftCount} frame=${r.wsBytes}B`);
  }
  console.log(
    multi.running === targets.length && multi.error === 0
      ? `OK multi running=${multi.running} events=${multi.totalEvents} wall=${multi.wall}ms`
      : `ERR multi running=${multi.running} error=${multi.error} wall=${multi.wall}ms`
  );
  if (multi.running !== targets.length || multi.error !== 0) process.exit(1);
  if (lean.some((r) => !r.roomId || r.wsBytes <= 0)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
