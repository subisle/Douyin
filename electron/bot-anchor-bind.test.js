const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeDouyinNo,
  normalizeBindChannel,
  parseBindCommand,
  formatBindReply,
  findAnchorByDouyinNo,
  createAnchorBindService,
} = require("./bot-anchor-bind");

function roster() {
  return [
    {
      id: 11,
      name: "小张",
      gender: "male",
      anchorId: "anchor-zhang",
      douyinNo: "zhang_dy",
      aliasIds: ["zhang_alt"],
    },
    {
      id: 12,
      name: "小李",
      gender: "female",
      anchorId: "li_dy",
      douyinNo: "",
      aliasIds: [],
    },
  ];
}

function createMemoryDb(initialBinds = []) {
  let tableReady = false;
  let nextId = 1;
  const binds = initialBinds.map((row) => ({ ...row }));
  const events = [];

  function clone(row) {
    return row ? { ...row } : null;
  }

  const conn = {
    async beginTransaction() {
      events.push("begin");
    },
    async commit() {
      events.push("commit");
    },
    async rollback() {
      events.push("rollback");
    },
    release() {
      events.push("release");
    },
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (/FROM channel_anchor_binds WHERE channel = \? AND channel_user_id = \?/.test(text)) {
        const [channel, userId] = params;
        return [binds.filter((row) => row.channel === channel && row.channel_user_id === userId).map(clone)];
      }
      if (/FROM channel_anchor_binds WHERE douyin_no = \?/.test(text)) {
        const [douyinNo] = params;
        return [binds.filter((row) => row.douyin_no === douyinNo).map(clone)];
      }
      if (/^INSERT INTO channel_anchor_binds/.test(text)) {
        const [channel, userId, personId, douyinNo, anchorId] = params;
        if (binds.some((row) => row.douyin_no === douyinNo)) {
          const error = new Error("Duplicate entry");
          error.code = "ER_DUP_ENTRY";
          throw error;
        }
        if (binds.some((row) => row.channel === channel && row.channel_user_id === userId)) {
          const error = new Error("Duplicate entry");
          error.code = "ER_DUP_ENTRY";
          throw error;
        }
        const row = {
          id: nextId++,
          channel,
          channel_user_id: userId,
          person_id: personId,
          douyin_no: douyinNo,
          anchor_id: anchorId,
        };
        binds.push(row);
        return [{ insertId: row.id, affectedRows: 1 }];
      }
      if (/^UPDATE channel_anchor_binds SET person_id = \?/.test(text)) {
        const [personId, douyinNo, anchorId, id] = params;
        if (binds.some((row) => row.douyin_no === douyinNo && Number(row.id) !== Number(id))) {
          const error = new Error("Duplicate entry");
          error.code = "ER_DUP_ENTRY";
          throw error;
        }
        const row = binds.find((item) => Number(item.id) === Number(id));
        if (!row) return [{ affectedRows: 0 }];
        row.person_id = personId;
        row.douyin_no = douyinNo;
        row.anchor_id = anchorId;
        return [{ affectedRows: 1 }];
      }
      if (/^DELETE FROM channel_anchor_binds WHERE channel = \? AND channel_user_id = \?/.test(text)) {
        const [channel, userId] = params;
        const before = binds.length;
        for (let i = binds.length - 1; i >= 0; i -= 1) {
          if (binds[i].channel === channel && binds[i].channel_user_id === userId) binds.splice(i, 1);
        }
        return [{ affectedRows: before - binds.length }];
      }
      throw new Error(`unexpected sql: ${text}`);
    },
  };

  return {
    events,
    binds,
    async query(sql) {
      assert.match(String(sql), /CREATE TABLE IF NOT EXISTS channel_anchor_binds/);
      tableReady = true;
      events.push("ensure-schema");
      return [{ affectedRows: 0 }];
    },
    async getConnection() {
      assert.equal(tableReady, true);
      events.push("get-connection");
      return conn;
    },
    async getAnchors() {
      return roster();
    },
  };
}

test("normalize douyin handle and channel", () => {
  assert.equal(normalizeDouyinNo(" @Zhang_dy "), "Zhang_dy");
  assert.equal(normalizeDouyinNo("抖音号：abc.123"), "abc.123");
  assert.equal(normalizeBindChannel("qqbot"), "qq");
  assert.equal(normalizeBindChannel("weixin"), "weixin");
  assert.equal(normalizeBindChannel(""), "");
});

test("parse bind commands", () => {
  assert.deepEqual(parseBindCommand("绑定 zhang_dy"), { type: "bind", douyinNo: "zhang_dy" });
  assert.deepEqual(parseBindCommand("绑定抖音号：@zhang_dy"), { type: "bind", douyinNo: "zhang_dy" });
  assert.deepEqual(parseBindCommand("绑定"), { type: "bind", douyinNo: "" });
  assert.deepEqual(parseBindCommand("我的绑定"), { type: "bind-status" });
  assert.deepEqual(parseBindCommand("查询绑定"), { type: "bind-status" });
  assert.deepEqual(parseBindCommand("解绑"), { type: "unbind" });
  assert.equal(parseBindCommand("小张"), null);
  assert.equal(parseBindCommand("绑定小张音浪"), null);
});

test("only roster douyin numbers can be bound", () => {
  const anchors = roster();
  assert.equal(findAnchorByDouyinNo("zhang_dy", anchors).id, 11);
  assert.equal(findAnchorByDouyinNo("zhang_alt", anchors).id, 11);
  assert.equal(findAnchorByDouyinNo("li_dy", anchors).id, 12);
  assert.equal(findAnchorByDouyinNo("小张", anchors), null);
  assert.equal(findAnchorByDouyinNo("nobody", anchors), null);
});

test("bind succeeds for roster douyin and is idempotent", async () => {
  const db = createMemoryDb();
  const service = createAnchorBindService({ db });
  const first = await service.bind({
    channel: "weixin",
    channelUserId: "wx-1",
    douyinNo: "@zhang_dy",
  });
  assert.equal(first.ok, true);
  assert.equal(first.code, "bound");
  assert.equal(first.binding.douyinNo, "zhang_dy");
  assert.equal(first.binding.name, "小张");

  const again = await service.bind({
    channel: "weixin",
    channelUserId: "wx-1",
    douyinNo: "zhang_dy",
  });
  assert.equal(again.ok, true);
  assert.equal(again.code, "already-bound");
  assert.equal(db.binds.length, 1);
});

test("one douyin number can only bind one user", async () => {
  const db = createMemoryDb();
  const service = createAnchorBindService({ db });
  const first = await service.bind({
    channel: "weixin",
    channelUserId: "wx-1",
    douyinNo: "zhang_dy",
  });
  assert.equal(first.ok, true);

  const taken = await service.bind({
    channel: "qq",
    channelUserId: "qq-2",
    douyinNo: "zhang_dy",
  });
  assert.equal(taken.ok, false);
  assert.equal(taken.code, "douyin-taken");
  assert.match(formatBindReply(taken), /已被绑定/);
});

test("unknown or non-roster handles are rejected", async () => {
  const service = createAnchorBindService({ db: createMemoryDb() });
  const missing = await service.bind({
    channel: "weixin",
    channelUserId: "wx-1",
    douyinNo: "",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "missing-douyin");

  const unknown = await service.bind({
    channel: "weixin",
    channelUserId: "wx-1",
    douyinNo: "not_in_roster",
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "not-in-roster");

  const byName = await service.bind({
    channel: "weixin",
    channelUserId: "wx-1",
    douyinNo: "小张",
  });
  assert.equal(byName.ok, false);
  assert.equal(byName.code, "not-in-roster");
});

test("same user can rebind to another free roster douyin", async () => {
  const db = createMemoryDb();
  const service = createAnchorBindService({ db });
  await service.bind({ channel: "qqbot", channelUserId: "qq-1", douyinNo: "zhang_dy" });
  const moved = await service.bind({ channel: "qq", channelUserId: "qq-1", douyinNo: "li_dy" });
  assert.equal(moved.ok, true);
  assert.equal(moved.code, "updated");
  assert.equal(moved.binding.douyinNo, "li_dy");
  assert.equal(db.binds.length, 1);
  assert.equal(db.binds[0].douyin_no, "li_dy");
});

test("status and unbind follow the current user", async () => {
  const db = createMemoryDb();
  const service = createAnchorBindService({ db });
  await service.bind({ channel: "weixin", channelUserId: "wx-9", douyinNo: "zhang_alt" });

  const status = await service.status({ channel: "weixin", channelUserId: "wx-9" });
  assert.equal(status.ok, true);
  assert.equal(status.binding.douyinNo, "zhang_alt");
  assert.equal(status.binding.name, "小张");

  const empty = await service.status({ channel: "weixin", channelUserId: "wx-other" });
  assert.equal(empty.ok, true);
  assert.equal(empty.binding, null);

  const unbound = await service.unbind({ channel: "weixin", channelUserId: "wx-9" });
  assert.equal(unbound.ok, true);
  assert.equal(unbound.code, "unbound");
  const after = await service.status({ channel: "weixin", channelUserId: "wx-9" });
  assert.equal(after.binding, null);
});
