const assert = require("node:assert/strict");
const test = require("node:test");
const sharp = require("sharp");

const {
  buildImportMeta,
  createWeixinCommandHandler,
  getLatestDate,
  matchImportRows,
  normalizeIsoDate,
  parseBotCommand,
  parseCsvText,
  pendingImportKey,
  resolveDateSpec,
} = require("./weixin-bot-commands");
const { threadKeyFromContext } = require("./weixin-bot-agent");
const {
  buildMediaItem,
  decryptAesEcb,
  downloadInboundMedia,
  encryptAesEcb,
  uploadMediaBuffer,
} = require("./weixin-bot-media");
const { renderDailyReportPng } = require("./weixin-bot-report");

function arrayBufferOf(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test("Chinese bot commands resolve reports, anchors, dates, and files", () => {
  assert.deepEqual(parseBotCommand("每日报告"), {
    type: "report",
    gender: "both",
    dateSpec: null,
  });
  assert.deepEqual(parseBotCommand("女团每日报告18号"), {
    type: "report",
    gender: "female",
    dateSpec: { type: "day", day: 18 },
  });
  assert.deepEqual(parseBotCommand("男团每日报告"), {
    type: "report",
    gender: "male",
    dateSpec: null,
  });
  assert.deepEqual(parseBotCommand("18号音浪"), {
    type: "report",
    gender: "male",
    dateSpec: { type: "day", day: 18 },
  });
  assert.deepEqual(parseBotCommand("女团18号音浪"), {
    type: "report",
    gender: "female",
    dateSpec: { type: "day", day: 18 },
  });
  assert.deepEqual(parseBotCommand("小张时长"), {
    type: "anchor-duration",
    query: "小张",
  });
  assert.deepEqual(parseBotCommand("小张多少日音浪"), {
    type: "anchor-wave-days",
    query: "小张",
  });
  assert.deepEqual(parseBotCommand("小张18号音浪"), {
    type: "anchor-wave",
    query: "小张",
    dateSpec: { type: "day", day: 18 },
  });
  assert.deepEqual(parseBotCommand("小张"), {
    type: "anchor-profile",
    query: "小张",
  });
  assert.deepEqual(parseBotCommand("小张音浪"), {
    type: "anchor-wave",
    query: "小张",
    dateSpec: null,
  });
  assert.deepEqual(parseBotCommand("18号报告"), {
    type: "report",
    gender: "both",
    dateSpec: { type: "day", day: 18 },
  });
  assert.deepEqual(parseBotCommand("人工客服"), { type: "agent-enable" });
  assert.deepEqual(parseBotCommand("退出客服"), { type: "agent-disable" });
  assert.deepEqual(parseBotCommand("音浪文件18号"), {
    type: "export-wave-file",
    dateSpec: { type: "day", day: 18 },
  });
  assert.equal(resolveDateSpec({ type: "day", day: 18 }, "2026-07-20"), "2026-07-18");
});

test("CSV parser matches account aliases and builds stable import metadata", () => {
  const text = "\uFEFF主播ID,主播昵称,音浪,排名\nunknown-a,甲,12.5万,1\nalias-b,乙,1234,2\nanchor-c,丙,-1,3\n";
  const parsed = parseCsvText(text, "wave");
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.rows[0].value, 125000);
  const matched = matchImportRows(parsed.rows, [
    { anchorId: "anchor-a", douyinNo: "", name: "甲", anchorName: "甲", aliasIds: [] },
    { anchorId: "anchor-b", douyinNo: "", name: "乙", anchorName: "乙", aliasIds: ["alias-b"] },
  ]);
  assert.deepEqual(matched.rows.map((row) => row.anchorId), ["anchor-a", "alias-b"]);
  assert.equal(matched.unmatched.length, 0);
  const meta1 = buildImportMeta(Buffer.from(text), "2026-07-18_音浪.csv", "wave", matched.rows);
  const meta2 = buildImportMeta(Buffer.from(text), "2026-07-18_音浪.csv", "wave", [...matched.rows].reverse());
  assert.equal(meta1.fileHash, meta2.fileHash);
  assert.equal(meta1.dataHash, meta2.dataHash);
  assert.equal(meta1.rowCount, 2);
});

test("Weixin media upload and download use AES-128-ECB CDN fields", async () => {
  const plaintext = Buffer.from("fixture media bytes", "utf8");
  let uploadRequest;
  let encryptedUpload;
  const uploaded = await uploadMediaBuffer({
    fetchImpl: async (url, options) => {
      assert.match(url, /novac2c\.cdn\.weixin\.qq\.com\/c2c\/upload/);
      assert.equal(options.method, "POST");
      encryptedUpload = Buffer.from(options.body);
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === "x-encrypted-param" ? "DOWNLOAD_PARAM" : null },
      };
    },
    getUploadUrl: async (request) => {
      uploadRequest = request;
      return { ret: 0, upload_param: "UPLOAD_PARAM" };
    },
    buffer: plaintext,
    toUserId: "sender@im.wechat",
    mediaKind: "image",
    fileName: "report.png",
  });
  assert.equal(uploadRequest.media_type, 1);
  assert.equal(uploadRequest.rawsize, plaintext.length);
  assert.equal(uploadRequest.filesize, encryptedUpload.length);
  assert.equal(uploadRequest.no_need_thumb, true);
  assert.deepEqual(decryptAesEcb(encryptedUpload, Buffer.from(uploaded.aeskey, "hex")), plaintext);

  const item = buildMediaItem("image", uploaded);
  assert.equal(item.type, 2);
  assert.equal(item.image_item.media.encrypt_query_param, "DOWNLOAD_PARAM");
  assert.equal(Buffer.from(item.image_item.media.aes_key, "base64").toString("utf8"), uploaded.aeskey);

  const inboundKey = Buffer.from(uploaded.aeskey, "hex");
  const encryptedInbound = encryptAesEcb(plaintext, inboundKey);
  const downloaded = await downloadInboundMedia({
    fetchImpl: async (url) => {
      assert.match(url, /\/download\?encrypted_query_param=INBOUND_PARAM$/);
      return { ok: true, status: 200, arrayBuffer: async () => arrayBufferOf(encryptedInbound) };
    },
    item: {
      type: 4,
      file_item: {
        file_name: "音浪.csv",
        media: {
          encrypt_query_param: "INBOUND_PARAM",
          aes_key: Buffer.from(uploaded.aeskey, "utf8").toString("base64"),
        },
      },
    },
  });
  assert.equal(downloaded.fileName, "音浪.csv");
  assert.deepEqual(downloaded.buffer, plaintext);
});

test("Weixin media download timeout covers a stalled response body", async () => {
  await assert.rejects(
    downloadInboundMedia({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Promise(() => {}),
      }),
      item: {
        type: 4,
        file_item: {
          file_name: "stalled.csv",
          media: { encrypt_query_param: "STALLED_PARAM" },
        },
      },
      timeoutMs: 20,
    }),
    /请求超时/
  );
});

test("Weixin media download aborts a stalled body when runner work is cancelled", async () => {
  const controller = new AbortController();
  const pending = downloadInboundMedia({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Promise(() => {}),
    }),
    item: {
      type: 4,
      file_item: {
        file_name: "cancelled.csv",
        media: { encrypt_query_param: "CANCELLED_PARAM" },
      },
    },
    timeoutMs: 1_000,
    signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(pending, (error) => error?.name === "AbortError");
});

test("Weixin media download enforces its byte limit while streaming", async () => {
  let reads = 0;
  let cancelled = false;
  const reader = {
    async read() {
      reads += 1;
      return { done: false, value: Buffer.alloc(4, reads) };
    },
    async cancel() {
      cancelled = true;
    },
    releaseLock() {},
  };

  await assert.rejects(
    downloadInboundMedia({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: { getReader: () => reader },
      }),
      item: {
        type: 4,
        file_item: {
          file_name: "large.csv",
          media: { encrypt_query_param: "LARGE_PARAM" },
        },
      },
      maxBytes: 6,
      timeoutMs: 500,
    }),
    /文件过大/
  );
  assert.equal(reads, 2);
  assert.equal(cancelled, true);
});

test("daily report renderer produces a real PNG", async () => {
  const png = await renderDailyReportPng({
    date: "2026-07-18",
    gender: "male",
    summary: { total: 1, notLiveCount: 0, notLiveDays: 0 },
    rows: [{
      rank: 1,
      name: "测试主播",
      notLiveDays: 1,
      dailyWave: 12345,
      totalWave: 543210,
      dailyDuration: 95,
      tier: "A1",
      isLive: true,
    }],
  });
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 1440);
  assert.ok(metadata.height > 250);
});

test("daily report style defaults to apple for male and classic for female", async () => {
  const { resolveReportStyle, renderClassicSvg, renderAppleSvg } = require("./weixin-bot-report");
  assert.equal(resolveReportStyle("male"), "apple");
  assert.equal(resolveReportStyle("female"), "classic");
  assert.equal(resolveReportStyle("male", { style: "classic" }), "classic");
  assert.equal(resolveReportStyle("female", { style: "apple" }), "apple");

  const sample = {
    date: "2026-07-18",
    summary: { total: 1, notLiveCount: 0, notLiveDays: 0 },
    rows: [{
      rank: 1,
      name: "测试主播",
      notLiveDays: 1,
      dailyWave: 12345,
      totalWave: 543210,
      dailyDuration: 95,
      tier: "A1",
      isLive: true,
    }],
  };
  const maleSvg = renderAppleSvg({ ...sample, gender: "male" }, {});
  const femaleSvg = renderClassicSvg({ ...sample, gender: "female" }, {});
  assert.match(maleSvg, /星嗨艺创主播数据统计/);
  assert.match(femaleSvg, /薇笑传媒主播数据统计/);
  assert.match(maleSvg, /内部数据 · 请勿外传/);
  assert.match(maleSvg, /#007AFF/);
  assert.match(femaleSvg, /#1E293B/);
  assert.match(femaleSvg, /女主播 1 人/);

  const malePng = await renderDailyReportPng({ ...sample, gender: "male" });
  const femalePng = await renderDailyReportPng({ ...sample, gender: "female" });
  assert.equal(malePng.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(femalePng.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const maleMeta = await sharp(malePng).metadata();
  const femaleMeta = await sharp(femalePng).metadata();
  assert.equal(maleMeta.width, 1440);
  assert.equal(femaleMeta.width, 1440);
  assert.notEqual(maleMeta.height, femaleMeta.height);
});

test("command handler ignores a filename date and imports to yesterday by default", async () => {
  const csv = Buffer.from("主播ID,主播昵称,音浪,排名\nanchor-a,甲,1200,1\nanchor-b,乙,800,2\n", "utf8");
  let importCall;
  const replies = [];
  const handler = createWeixinCommandHandler({
    db: {
      getDashboardSummary: async () => ({ latestWaveDate: "2026-07-20", latestDataDate: "2026-07-20" }),
      getAnchors: async () => [
        { anchorId: "anchor-a", douyinNo: "", name: "甲", anchorName: "甲", aliasIds: [] },
        { anchorId: "anchor-b", douyinNo: "", name: "乙", anchorName: "乙", aliasIds: [] },
      ],
      importWaveSnapshots: async (date, rows, meta) => {
        importCall = { date, rows, meta };
        return { inserted: rows.length };
      },
    },
    renderReportPng: async () => Buffer.alloc(0),
  });
  const result = await handler({
    text: "",
    fromUserId: "tester",
    items: [{ type: 4, file_item: { file_name: "2026-07-18_音浪.csv" } }],
    downloadMedia: async () => ({ buffer: csv, fileName: "2026-07-18_音浪.csv" }),
    replyText: async (text) => { replies.push(text); },
  });
  assert.equal(result.handled, true);
  // 文件名日期不再作为导入日；默认昨天
  const yesterday = (() => {
    const now = new Date();
    now.setDate(now.getDate() - 1);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  })();
  assert.equal(importCall.date, yesterday);
  assert.deepEqual(importCall.rows, [
    { anchorId: "anchor-a", waveValue: 1200, rank: 1 },
    { anchorId: "anchor-b", waveValue: 800, rank: 2 },
  ]);
  assert.equal(importCall.meta.rowCount, 2);
  assert.match(replies.at(-1), new RegExp(`已导入 ${yesterday} 音浪数据`));
});

test("CSV import checks the runner lease after media staging and before the DB write", async () => {
  const csv = Buffer.from("主播ID,主播昵称,音浪,排名\nanchor-a,甲,1200,1\n", "utf8");
  let leaseValid = true;
  let importCalls = 0;
  const replies = [];
  const handler = createWeixinCommandHandler({
    db: {
      getAnchors: async () => [
        { anchorId: "anchor-a", douyinNo: "", name: "甲", anchorName: "甲", aliasIds: [] },
      ],
      importWaveSnapshots: async () => {
        importCalls += 1;
      },
    },
    renderReportPng: async () => Buffer.alloc(0),
  });

  const result = await handler({
    text: "",
    fromUserId: "lease-import-user",
    items: [{ type: 4, file_item: { file_name: "data.csv" } }],
    assertLease: () => {
      if (!leaseValid) throw new Error("runner lease lost");
    },
    downloadMedia: async () => {
      leaseValid = false;
      return { buffer: csv, fileName: "data.csv" };
    },
    replyText: async (text) => replies.push(text),
  });

  assert.equal(result.handled, true);
  assert.equal(importCalls, 0);
  assert.match(replies.at(-1), /runner lease lost/);
});

test("pending explicit date then CSV imports to that date", async () => {
  const csv = Buffer.from("主播ID,主播昵称,音浪,排名\nanchor-a,甲,1200,1\n", "utf8");
  let importCall;
  const replies = [];
  const handler = createWeixinCommandHandler({
    db: {
      getAnchors: async () => [
        { anchorId: "anchor-a", douyinNo: "", name: "甲", anchorName: "甲", aliasIds: [] },
      ],
      importWaveSnapshots: async (date, rows, meta) => {
        importCall = { date, rows, meta };
        return { inserted: rows.length };
      },
    },
    renderReportPng: async () => Buffer.alloc(0),
  });
  const ctx = { fromUserId: "tester-2", conversationId: "tester-2" };
  const remember = await handler({
    ...ctx,
    text: "24号数据",
    items: [],
    replyText: async (text) => { replies.push(text); },
  });
  assert.equal(remember.handled, true);
  assert.match(replies.at(-1), /已记住导入日期/);
  const result = await handler({
    ...ctx,
    text: "",
    items: [{ type: 4, file_item: { file_name: "主播榜.csv" } }],
    downloadMedia: async () => ({ buffer: csv, fileName: "主播榜.csv" }),
    replyText: async (text) => { replies.push(text); },
  });
  assert.equal(result.handled, true);
  const expected = (() => {
    const now = new Date();
    now.setDate(now.getDate() - 1);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-24`;
  })();
  assert.equal(importCall.date, expected);
});

test("report command without gender sends male then female images", async () => {
  const replies = [];
  const images = [];
  const genders = [];
  const handler = createWeixinCommandHandler({
    db: {
      getDashboardSummary: async () => ({ latestWaveDate: "2026-07-18", latestDataDate: "2026-07-18" }),
      exportWaveSnapshots: async () => [{ 音浪: 100 }],
      getDailyWaveReport: async (date, gender) => {
        genders.push(gender);
        return {
          date,
          gender,
          summary: { total: 1, notLiveCount: gender === "female" ? 1 : 0, notLiveDays: 0 },
          rows: [{ name: gender === "female" ? "乙" : "甲", isLive: true, dailyWave: 100, totalWave: 100, dailyDuration: 10 }],
        };
      },
    },
    renderReportPng: async (report) => Buffer.from(`PNG-${report.gender}`),
  });
  await handler({
    text: "每日报告",
    items: [{ type: 1, text_item: { text: "每日报告" } }],
    replyText: async (text) => { replies.push(text); },
    replyImage: async (image) => { images.push(image); },
  });
  assert.deepEqual(genders, ["male", "female"]);
  assert.match(replies[0], /2026-07-18 每日报告：依次发送男团、女队/);
  assert.match(replies[1], /2026-07-18 男团每日报告/);
  assert.match(replies[2], /2026-07-18 女队每日报告/);
  assert.equal(images[0].fileName, "2026-07-18_男团_每日报告.png");
  assert.equal(images[1].fileName, "2026-07-18_女队_每日报告.png");
  assert.deepEqual(images[0].buffer, Buffer.from("PNG-male"));
  assert.deepEqual(images[1].buffer, Buffer.from("PNG-female"));
});

test("report command with explicit gender still sends only one team", async () => {
  const replies = [];
  const images = [];
  const genders = [];
  const handler = createWeixinCommandHandler({
    db: {
      getDashboardSummary: async () => ({ latestWaveDate: "2026-07-18", latestDataDate: "2026-07-18" }),
      exportWaveSnapshots: async () => [{ 音浪: 100 }],
      getDailyWaveReport: async (date, gender) => {
        genders.push(gender);
        return {
          date,
          gender,
          summary: { total: 1, notLiveCount: 0, notLiveDays: 0 },
          rows: [{ name: "乙", isLive: true, dailyWave: 100, totalWave: 100, dailyDuration: 10 }],
        };
      },
    },
    renderReportPng: async () => Buffer.from("PNG"),
  });
  await handler({
    text: "女团每日报告",
    items: [{ type: 1, text_item: { text: "女团每日报告" } }],
    replyText: async (text) => { replies.push(text); },
    replyImage: async (image) => { images.push(image); },
  });
  assert.deepEqual(genders, ["female"]);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /2026-07-18 女队每日报告/);
  assert.equal(images[0].fileName, "2026-07-18_女队_每日报告.png");
});


test("normalizeIsoDate keeps local calendar day for Date values", () => {
  assert.equal(normalizeIsoDate("2026-07-18"), "2026-07-18");
  assert.equal(normalizeIsoDate("2026-07-18T00:00:00.000Z"), "2026-07-18");
  assert.equal(normalizeIsoDate(null), null);
  assert.equal(normalizeIsoDate(""), null);
  // Asia/Shanghai midnight as Date must not slip to previous UTC day via toISOString
  const localMidnight = new Date(2026, 6, 18, 0, 0, 0);
  assert.equal(normalizeIsoDate(localMidnight), "2026-07-18");
});

test("getLatestDate prefers summary fields and falls back safely", async () => {
  assert.equal(
    await getLatestDate({
      getDashboardSummary: async () => ({
        latestWaveDate: "2026-07-20",
        latestDurationDate: "2026-07-10",
        latestDataDate: "2026-07-20",
      }),
    }, "wave"),
    "2026-07-20"
  );
  assert.equal(
    await getLatestDate({
      getDashboardSummary: async () => ({
        latestWaveDate: "2026-07-20",
        latestDurationDate: "2026-07-10",
        latestDataDate: "2026-07-20",
      }),
    }, "duration"),
    "2026-07-10"
  );

  // missing new fields / empty object → export fallback
  assert.equal(
    await getLatestDate({
      getDashboardSummary: async () => ({}),
      exportWaveSnapshots: async () => [{ 日期: "2026-07-12" }, { 日期: "2026-07-15" }],
    }, "wave"),
    "2026-07-15"
  );

  // null summary and thrown summary both degrade to export / null
  assert.equal(
    await getLatestDate({
      getDashboardSummary: async () => null,
      exportWaveSnapshots: async () => [{ 日期: "2026-07-11" }],
    }, "wave"),
    "2026-07-11"
  );
  assert.equal(
    await getLatestDate({
      getDashboardSummary: async () => {
        throw new Error("db down");
      },
      exportWaveSnapshots: async () => {
        throw new Error("export failed");
      },
    }, "wave"),
    null
  );
});

test("report command falls back when dashboard summary is empty", async () => {
  const replies = [];
  const images = [];
  const handler = createWeixinCommandHandler({
    db: {
      getDashboardSummary: async () => ({}),
      exportWaveSnapshots: async (date) => {
        if (!date) return [{ 日期: "2026-07-16", 音浪: 100 }];
        return date === "2026-07-16" ? [{ 音浪: 100 }] : [];
      },
      getDailyWaveReport: async (date, gender) => ({
        date,
        gender,
        summary: { total: 1, notLiveCount: 0, notLiveDays: 0 },
        rows: [{ name: "甲", isLive: true, dailyWave: 100, totalWave: 100, dailyDuration: 10 }],
      }),
    },
    renderReportPng: async () => Buffer.from("PNG"),
  });
  await handler({
    text: "每日报告",
    items: [{ type: 1, text_item: { text: "每日报告" } }],
    replyText: async (text) => { replies.push(text); },
    replyImage: async (image) => { images.push(image); },
  });
  assert.match(replies[0], /2026-07-16 每日报告：依次发送男团、女队/);
  assert.match(replies[1], /2026-07-16 男团每日报告/);
  assert.match(replies[2], /2026-07-16 女队每日报告/);
  assert.equal(images[0].fileName, "2026-07-16_男团_每日报告.png");
  assert.equal(images[1].fileName, "2026-07-16_女队_每日报告.png");
});

test("anchor duration uses latestDurationDate when it diverges from wave", async () => {
  const replies = [];
  const handler = createWeixinCommandHandler({
    db: {
      getDashboardSummary: async () => ({
        latestWaveDate: "2026-07-20",
        latestDurationDate: "2026-07-08",
        latestDataDate: "2026-07-20",
      }),
      getAnchors: async () => ([
        { anchorId: "anchor-a", douyinNo: "dy-a", name: "小张", anchorName: "小张", gender: "male", aliasIds: [] },
      ]),
      exportDurationSnapshots: async (date) => {
        assert.equal(date, "2026-07-08");
        // handleAnchorDuration matches 抖音号 against anchorId/aliasIds
        return [{ 抖音号: "anchor-a", 时长分钟: 125 }];
      },
    },
    renderReportPng: async () => Buffer.alloc(0),
  });
  await handler({
    text: "小张时长",
    items: [{ type: 1, text_item: { text: "小张时长" } }],
    replyText: async (text) => { replies.push(text); },
  });
  assert.match(replies[0], /截至 2026-07-08/);
  assert.match(replies[0], /125/);
});

test("command handler replies instead of throwing when summary fails hard", async () => {
  const replies = [];
  const handler = createWeixinCommandHandler({
    db: {
      getDashboardSummary: async () => {
        throw new Error("summary boom");
      },
      // no export helpers → getLatestDate returns null → resolveDateSpec falls to yesterday
      exportWaveSnapshots: async () => {
        throw new Error("export boom");
      },
    },
    renderReportPng: async () => Buffer.from("PNG"),
  });
  const result = await handler({
    text: "每日报告",
    items: [{ type: 1, text_item: { text: "每日报告" } }],
    replyText: async (text) => { replies.push(text); },
    replyImage: async () => {},
  });
  assert.equal(result.handled, true);
  // should not throw; either empty-data message or soft failure text
  assert.ok(replies.length >= 1);
  assert.match(replies[0], /没有音浪快照|处理失败/);
});

test("mode store + matchFastRoute unit", () => {
  const {
    createModeStore,
    matchFastRoute,
    matchSystemToken,
  } = require("./weixin-bot-mode");
  const store = createModeStore();
  const ctx = { fromUserId: "u1", conversationId: "u1" };
  assert.equal(store.getMode(ctx), "instruction");
  store.setMode(ctx, "agent");
  assert.equal(store.isAgent(ctx), true);
  store.setMode(ctx, "instruction");
  assert.equal(store.isAgent(ctx), false);

  assert.equal(matchSystemToken("人工客服"), "enable");
  assert.equal(matchSystemToken("退出客服"), "disable");
  assert.equal(matchSystemToken("帮助"), "help");
  assert.equal(matchSystemToken("每日报告"), null);

  assert.deepEqual(matchFastRoute("每日报告", { parseBotCommand }), {
    type: "report",
    gender: "both",
    dateSpec: null,
  });
  assert.deepEqual(matchFastRoute("小张", { parseBotCommand }), {
    type: "anchor-profile",
    query: "小张",
  });
  // 口语问句不进 FastRoute
  assert.equal(matchFastRoute("帮我对比一下最近谁音浪好", { parseBotCommand }), null);
  assert.equal(matchFastRoute("对比一下小张和小李", { parseBotCommand }), null);
});

test("mode, AI thread, and pending import keys isolate bot accounts", () => {
  const { createModeStore, sessionKeyFromContext } = require("./weixin-bot-mode");
  const accountA = {
    accountId: "account-a@im.bot",
    fromUserId: "shared-user@im.wechat",
    conversationId: "shared-user@im.wechat",
  };
  const accountB = { ...accountA, accountId: "account-b@im.bot" };
  const store = createModeStore();

  store.setMode(accountA, "agent");
  assert.equal(store.getMode(accountA), "agent");
  assert.equal(store.getMode(accountB), "instruction");
  assert.notEqual(sessionKeyFromContext(accountA), sessionKeyFromContext(accountB));
  assert.notEqual(threadKeyFromContext(accountA), threadKeyFromContext(accountB));
  assert.notEqual(pendingImportKey(accountA), pendingImportKey(accountB));
});

test("agent mode: after 人工客服, 每日报告 still handled via FastRoute", async () => {
  const replies = [];
  const images = [];
  const genders = [];
  const mockAgent = {
    enableSession() {},
    disableSession() {},
    getPublicStatus() {
      return { enabled: true, configured: true };
    },
  };
  const handler = createWeixinCommandHandler({
    db: {
      getDashboardSummary: async () => ({ latestWaveDate: "2026-07-18", latestDataDate: "2026-07-18" }),
      exportWaveSnapshots: async () => [{ 音浪: 100 }],
      getDailyWaveReport: async (date, gender) => {
        genders.push(gender);
        return {
          date,
          gender,
          summary: { total: 1, notLiveCount: 0, notLiveDays: 0 },
          rows: [{ name: "甲", isLive: true, dailyWave: 100, totalWave: 100, dailyDuration: 10 }],
        };
      },
    },
    renderReportPng: async (report) => Buffer.from(`PNG-${report.gender}`),
    agent: mockAgent,
  });
  const ctx = { fromUserId: "agent-user", conversationId: "agent-user" };
  const enable = await handler({
    ...ctx,
    text: "人工客服",
    items: [],
    replyText: async (text) => { replies.push(text); },
  });
  assert.equal(enable.handled, true);
  assert.equal(handler.modeStore.isAgent(ctx), true);
  assert.match(replies.at(-1), /智能客服/);

  const report = await handler({
    ...ctx,
    text: "每日报告",
    items: [],
    replyText: async (text) => { replies.push(text); },
    replyImage: async (image) => { images.push(image); },
  });
  assert.equal(report.handled, true);
  assert.equal(report.via, "fast-route");
  assert.deepEqual(genders, ["male", "female"]);
  assert.ok(images.length >= 2);
});

test("agent mode: free text not matched returns handled false for agent fallback", async () => {
  const handler = createWeixinCommandHandler({
    db: {
      getDashboardSummary: async () => ({ latestWaveDate: "2026-07-18" }),
      getAnchors: async () => [],
    },
    renderReportPng: async () => Buffer.alloc(0),
    agent: {
      enableSession() {},
      disableSession() {},
      getPublicStatus() { return { enabled: true, configured: true }; },
    },
  });
  const ctx = { fromUserId: "agent-user-2", conversationId: "agent-user-2" };
  await handler({
    ...ctx,
    text: "人工客服",
    items: [],
    replyText: async () => {},
  });
  const free = await handler({
    ...ctx,
    text: "帮我对比一下最近谁音浪好",
    items: [],
    replyText: async () => {},
  });
  assert.equal(free.handled, false);
});


test("CSV怎么导入 not fast-route as anchor profile", () => {
  const { matchFastRoute, parseBotCommand } = require("./weixin-bot-commands");
  assert.equal(matchFastRoute("CSV怎么导入", { parseBotCommand }), null);
  assert.equal(matchFastRoute("业务日是什么", { parseBotCommand }), null);
});
