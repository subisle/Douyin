#!/usr/bin/env node
/**
 * Smoke-test pure-protocol Douyin live enter + WSS open.
 * Usage: node scripts/smoke-live-protocol.mjs [web_rid...]
 */
import { createRequire } from "module";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const {
  resolveDouyinLiveOptions,
} = require("../electron/live-pk-protocol.js");

const rooms = process.argv.slice(2);
const targets = rooms.length > 0
  ? rooms
  : ["724154245800", "967902661800"];

function openWs(url, cookie, timeoutMs = 12000) {
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

async function runOne(webRid) {
  const liveRoomUrl = `https://live.douyin.com/${webRid}`;
  const started = Date.now();
  const options = await resolveDouyinLiveOptions(liveRoomUrl, {
    onStatus: (msg) => console.log(`  · ${msg}`),
  });
  const enterMs = Date.now() - started;
  const roomId = options.roomId || options.bootstrap?.roomId || "";
  const giftPages = options.bootstrap?.giftList?.data?.pages?.length || 0;
  const giftCount =
    options.bootstrap?.giftList?.data?.pages?.[0]?.gifts?.length ||
    options.bootstrap?.giftList?.data?.gifts?.length ||
    0;
  console.log(
    `  room_id=${roomId} enter=${enterMs}ms gifts=${giftCount} (pages=${giftPages}) source=${options.source}`
  );
  const wsStarted = Date.now();
  const ws = await openWs(options.websocketUrl, options.cookie);
  console.log(
    `  WSS open ok firstFrame=${ws.bytes}B in ${Date.now() - wsStarted}ms`
  );
  return { webRid, roomId, enterMs, giftCount, wsBytes: ws.bytes };
}

async function main() {
  const results = [];
  for (const webRid of targets) {
    console.log(`\n=== ${webRid} ===`);
    try {
      results.push({ ok: true, ...(await runOne(webRid)) });
    } catch (error) {
      console.error(`  FAIL: ${error?.message || error}`);
      results.push({ ok: false, webRid, error: error?.message || String(error) });
    }
  }
  console.log("\n--- summary ---");
  for (const r of results) {
    console.log(
      r.ok
        ? `OK  ${r.webRid} room=${r.roomId} gifts=${r.giftCount} frame=${r.wsBytes}B`
        : `ERR ${r.webRid} ${r.error}`
    );
  }
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
