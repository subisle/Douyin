"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { LivePkMultiMonitor, scoreRowsFromPayload } = require("./live-pk-multi-monitor");

function createFakeWatcher() {
  const watcher = new EventEmitter();
  watcher.status = "idle";
  watcher.startCalls = [];
  watcher.stopped = false;
  watcher.start = async (options) => {
    watcher.startCalls.push(options);
    watcher.status = "running";
    watcher.emit("status", { status: "running", roomId: options.roomId || "r1", startedAt: new Date().toISOString() });
    return { status: "running" };
  };
  watcher.stop = () => {
    watcher.stopped = true;
    watcher.status = "idle";
  };
  return watcher;
}

describe("scoreRowsFromPayload", () => {
  it("maps scores array", () => {
    const rows = scoreRowsFromPayload({
      scores: [{ rank: 1, anchorId: "a1", nickname: "甲", score: 12 }],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].anchorId, "a1");
    assert.equal(rows[0].score, 12);
  });
});

describe("LivePkMultiMonitor protocol path", () => {
  let watchers;
  /** @type {LivePkMultiMonitor} */
  let monitor;

  beforeEach(() => {
    watchers = [];
    monitor = new LivePkMultiMonitor({
      createWatcher: () => {
        const w = createFakeWatcher();
        watchers.push(w);
        return w;
      },
      captureLiveOptions: async (url, opts) => {
        // Simulate lean protocol options.
        opts?.onStatus?.(`协议进房 ${url}`);
        return {
          websocketUrl: `wss://example.test/push?room=${encodeURIComponent(url)}`,
          cookie: "ttwid=x",
          roomId: `room-for-${url}`,
          source: "protocol",
          bootstrap: { roomId: `room-for-${url}`, protocol: true, bootstrapMode: "lean" },
          linkmicSnapshotLookup: async () => null,
        };
      },
      maxRooms: 16,
      captureConcurrency: 4,
      preferProtocol: true,
      now: () => "2026-08-04T00:00:00.000Z",
    });
  });

  afterEach(() => {
    monitor.stop({ emit: false });
  });

  it("starts multiple rooms concurrently without browser windows", async () => {
    const rooms = [
      { liveRoomUrl: "https://live.douyin.com/111", name: "A", douyinNo: "111" },
      { liveRoomUrl: "https://live.douyin.com/222", name: "B", douyinNo: "222" },
      { liveRoomUrl: "https://live.douyin.com/333", name: "C", douyinNo: "333" },
    ];
    const started = monitor.start({ rooms });
    assert.equal(started.roomCount, 3);
    assert.equal(started.pendingCount, 3);
    assert.equal(started.scoreOnly, true);

    // Wait for queue workers.
    await new Promise((r) => setTimeout(r, 50));
    const status = monitor.getStatus();
    assert.equal(status.runningCount, 3);
    assert.equal(status.errorCount, 0);
    assert.equal(status.scoreOnly, true);
    assert.equal(watchers.length, 3);
    for (const w of watchers) {
      assert.equal(w.startCalls.length, 1);
      assert.equal(w.startCalls[0].source, "protocol");
      assert.equal(w.startCalls[0].scoreOnly, true);
      assert.ok(w.startCalls[0].websocketUrl.startsWith("wss://"));
    }
    for (const room of status.rooms) {
      assert.equal(room.source, "protocol");
      assert.equal(room.transport, "websocket");
      assert.equal(room.captureWindow, undefined);
    }
  });

  it("passes score bootstrap and ignores gift/chat noise", async () => {
    const captureCalls = [];
    monitor = new LivePkMultiMonitor({
      createWatcher: () => {
        const w = createFakeWatcher();
        watchers.push(w);
        return w;
      },
      captureLiveOptions: async (url, opts) => {
        captureCalls.push(opts);
        opts?.onStatus?.(`协议进房 ${url}`);
        return {
          websocketUrl: `wss://example.test/push?room=${encodeURIComponent(url)}`,
          cookie: "ttwid=x",
          roomId: "room-score",
          source: "protocol",
          bootstrap: { roomId: "room-score", protocol: true, bootstrapMode: "score" },
          linkmicSnapshotLookup: async () => null,
        };
      },
      maxRooms: 16,
      captureConcurrency: 4,
      preferProtocol: true,
      scoreOnly: true,
      now: () => "2026-08-04T00:00:00.000Z",
    });

    monitor.start({
      rooms: [{ liveRoomUrl: "https://live.douyin.com/111", name: "A" }],
    });
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(captureCalls[0].bootstrapMode, "score");
    assert.equal(captureCalls[0].shareGiftList, false);
    assert.equal(captureCalls[0].scoreOnly, true);
    assert.equal(watchers[0].startCalls[0].scoreOnly, true);

    // gift/chat should not be bound in scoreOnly; emitting them must not bump counters.
    watchers[0].emit("gift", { roomFanTicketCount: 99 });
    watchers[0].emit("chat", {});
    watchers[0].emit("member", {});
    watchers[0].emit("rank", {
      ranks: [{ rank: 1, userId: "u1", nickname: "甲", score: 88, scoreText: "88" }],
    });
    await new Promise((r) => setTimeout(r, 20));
    const room = monitor.getStatus().rooms[0];
    assert.equal(room.giftEvents, 0);
    assert.equal(room.chatEvents, 0);
    assert.equal(room.memberEvents, 0);
    assert.equal(room.scores[0]?.score, 88);
  });

  it("caps max rooms", () => {
    const rooms = Array.from({ length: 20 }, (_, i) => ({
      liveRoomUrl: `https://live.douyin.com/${i + 1}`,
    }));
    assert.throws(() => monitor.start({ rooms }), /最多同时监控/);
  });

  it("stops cleanly and clears sessions", async () => {
    monitor.start({
      rooms: [{ liveRoomUrl: "https://live.douyin.com/111", name: "A" }],
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(monitor.getStatus().runningCount, 1);
    monitor.stop();
    assert.equal(monitor.getStatus().roomCount, 0);
    assert.equal(watchers[0].stopped, true);
  });

  it("records per-room errors without killing others", async () => {
    let calls = 0;
    monitor = new LivePkMultiMonitor({
      createWatcher: () => {
        const w = createFakeWatcher();
        watchers.push(w);
        return w;
      },
      captureLiveOptions: async (url) => {
        calls += 1;
        if (String(url).includes("bad")) throw new Error("boom");
        return {
          websocketUrl: "wss://example.test/ok",
          source: "protocol",
          roomId: "ok",
        };
      },
      captureConcurrency: 2,
    });
    monitor.start({
      rooms: [
        { liveRoomUrl: "https://live.douyin.com/ok1", name: "OK" },
        { liveRoomUrl: "https://live.douyin.com/bad", name: "BAD" },
      ],
    });
    // startSession 对瞬态进房失败重试 3 次（450ms + 900ms），等最终 error
    await new Promise((r) => setTimeout(r, 1800));
    const status = monitor.getStatus();
    // OK 1 次 + BAD 3 次重试
    assert.equal(calls, 4);
    assert.equal(status.runningCount, 1);
    assert.equal(status.errorCount, 1);
    const bad = status.rooms.find((r) => r.name === "BAD");
    assert.equal(bad.status, "error");
    assert.match(bad.lastError, /boom/);
  });
});
