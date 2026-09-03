"use strict";

const CREATE_CHANNEL_ANCHOR_BINDS_SQL = `CREATE TABLE IF NOT EXISTS channel_anchor_binds (
  id INT NOT NULL AUTO_INCREMENT,
  channel VARCHAR(16) NOT NULL,
  channel_user_id VARCHAR(128) NOT NULL,
  person_id INT NOT NULL,
  douyin_no VARCHAR(64) NOT NULL,
  anchor_id VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bind_user (channel, channel_user_id),
  UNIQUE KEY uk_bind_douyin (douyin_no),
  UNIQUE KEY uk_bind_person (person_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const BIND_PREFIX_RE = /^(?:绑定(?:抖音号)?|bind)\s*[:：]?\s*/i;
const STATUS_RE = /^(?:我的绑定|查询绑定|查看绑定|绑定状态|\/?bindstatus)$/i;
const UNBIND_RE = /^(?:解绑|取消绑定|解除绑定|\/?unbind)$/i;
const BIND_NOISE_RE = /(?:音浪|时长|报告|日报|文件|导出|对比|分析)/;

function compactError(error) {
  return String(error instanceof Error ? error.message : error || "未知错误").slice(0, 300);
}

function normalizeDouyinNo(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^(?:抖音号|douyin(?:id|no|id)?|id)\s*[:：]?\s*/i, "")
    .replace(/^@+/, "")
    .trim();
}

function normalizeBindChannel(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "qq" || raw === "qqbot" || raw === "qq-bot" || raw === "qq_bot") return "qq";
  if (raw === "weixin" || raw === "wechat" || raw === "wx" || raw === "ilink") return "weixin";
  return raw;
}

function resolveBindChannel(context = {}) {
  return normalizeBindChannel(context.channel || context.channelType) || "weixin";
}

function resolveBindUserId(context = {}) {
  return String(context.fromUserId || context.userId || "").trim();
}

function parseBindCommand(input) {
  const original = String(input || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim()
    .replace(/[。！!，,；;]+$/g, "")
    .trim();
  if (!original) return null;
  if (STATUS_RE.test(original)) return { type: "bind-status" };
  if (UNBIND_RE.test(original)) return { type: "unbind" };
  if (!BIND_PREFIX_RE.test(original)) return null;
  const rest = original.replace(BIND_PREFIX_RE, "").trim();
  if (rest && BIND_NOISE_RE.test(rest)) return null;
  return { type: "bind", douyinNo: normalizeDouyinNo(rest) };
}

function accountKeysOf(anchor) {
  return [...new Set(
    [anchor?.anchorId, anchor?.douyinNo, ...(Array.isArray(anchor?.aliasIds) ? anchor.aliasIds : [])]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

function findAnchorByDouyinNo(douyinNo, anchors) {
  const raw = normalizeDouyinNo(douyinNo);
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  const list = Array.isArray(anchors) ? anchors : [];
  const exact = [];
  const folded = [];
  for (const anchor of list) {
    const keys = accountKeysOf(anchor);
    if (keys.includes(raw)) {
      exact.push(anchor);
      continue;
    }
    if (keys.some((key) => key.toLowerCase() === lowered)) folded.push(anchor);
  }
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  if (folded.length === 1) return folded[0];
  return null;
}

function toPublicBinding(row, anchor = null) {
  if (!row) return null;
  const douyinNo = String(row.douyin_no || row.douyinNo || "").trim();
  return {
    channel: normalizeBindChannel(row.channel) || String(row.channel || ""),
    channelUserId: String(row.channel_user_id || row.channelUserId || ""),
    personId: Number(row.person_id || row.personId || anchor?.id || 0) || 0,
    douyinNo,
    anchorId: String(row.anchor_id || row.anchorId || anchor?.anchorId || ""),
    name: String(anchor?.name || anchor?.anchorName || ""),
  };
}

function formatBindReply(result = {}) {
  const binding = result.binding || null;
  const name = String(binding?.name || "").trim() || "该主播";
  const douyinNo = String(binding?.douyinNo || "").trim();
  const labeled = douyinNo ? `${name}（抖音号 ${douyinNo}）` : name;

  switch (result.code) {
    case "bound":
      return `已绑定 ${labeled}。一个抖音号只能绑定一个用户。`;
    case "already-bound":
      return `你已绑定 ${labeled}。`;
    case "updated":
      return `已改绑为 ${labeled}。`;
    case "douyin-taken":
    case "person-taken":
      return "该抖音号已被其他用户绑定，一个抖音号只能绑定一个用户。";
    case "not-in-roster":
      return "只有主播列表里的抖音号才能绑定。请发送本人的抖音号，例如：绑定 your_id";
    case "missing-douyin":
      return "请发送「绑定 + 你的抖音号」，例如：绑定 your_id\n只有主播列表中的抖音号可以绑定。";
    case "missing-user":
      return "无法识别当前用户，请在私聊中重试。";
    case "unbound":
      return "已解除绑定。";
    case "not-bound":
      return "你还没有绑定抖音号。发送「绑定 + 抖音号」即可绑定。";
    case "status":
      return binding
        ? `当前绑定：${labeled}。`
        : "你还没有绑定抖音号。发送「绑定 + 抖音号」即可绑定。";
    default:
      return result.ok
        ? (binding ? `当前绑定：${labeled}。` : "已处理绑定请求。")
        : `绑定失败：${result.error || "请稍后重试"}`;
  }
}

function isDuplicateKeyError(error) {
  return error?.code === "ER_DUP_ENTRY" || /duplicate/i.test(String(error?.message || ""));
}

function createAnchorBindService({ db } = {}) {
  if (!db) throw new Error("绑定模块缺少数据库");
  let tableReady = false;

  async function ensureTable() {
    if (tableReady) return;
    if (typeof db.ensureChannelAnchorBindsTable === "function") {
      await db.ensureChannelAnchorBindsTable();
    } else if (typeof db.query === "function") {
      await db.query(CREATE_CHANNEL_ANCHOR_BINDS_SQL);
    } else {
      throw new Error("绑定模块无法创建数据表");
    }
    tableReady = true;
  }

  async function loadAnchors() {
    if (typeof db.getAnchors !== "function") return [];
    const rows = await db.getAnchors();
    return Array.isArray(rows) ? rows : [];
  }

  async function withConnection(fn) {
    if (typeof db.getConnection !== "function") {
      throw new Error("绑定模块缺少数据库连接");
    }
    const conn = await db.getConnection();
    try {
      return await fn(conn);
    } finally {
      conn.release?.();
    }
  }

  async function findUserRow(conn, channel, userId) {
    const [rows] = await conn.query(
      `SELECT id, channel, channel_user_id, person_id, douyin_no, anchor_id
         FROM channel_anchor_binds
        WHERE channel = ? AND channel_user_id = ?
        LIMIT 1`,
      [channel, userId]
    );
    return rows?.[0] || null;
  }

  async function findDouyinRow(conn, douyinNo) {
    const [rows] = await conn.query(
      `SELECT id, channel, channel_user_id, person_id, douyin_no, anchor_id
         FROM channel_anchor_binds
        WHERE douyin_no = ?
        LIMIT 1`,
      [douyinNo]
    );
    return rows?.[0] || null;
  }

  async function findPersonRow(conn, personId) {
    const [rows] = await conn.query(
      `SELECT id, channel, channel_user_id, person_id, douyin_no, anchor_id
         FROM channel_anchor_binds
        WHERE person_id = ?
        LIMIT 1`,
      [personId]
    );
    return rows?.[0] || null;
  }

  async function hydrate(row, anchors = null) {
    if (!row) return null;
    const list = anchors || await loadAnchors();
    const handle = String(row.douyin_no || "").trim();
    const personId = Number(row.person_id || 0);
    const byHandle = handle ? findAnchorByDouyinNo(handle, list) : null;
    const byPerson = personId
      ? list.find((item) => Number(item.id) === personId) || null
      : null;
    return toPublicBinding(row, byHandle || byPerson);
  }

  function sameIdentity(row, channel, userId) {
    return Boolean(
      row
      && normalizeBindChannel(row.channel) === channel
      && String(row.channel_user_id || "") === userId
    );
  }

  async function identityOf(context = {}) {
    const channel = resolveBindChannel(context);
    const channelUserId = resolveBindUserId(context);
    if (!channelUserId) {
      return { ok: false, code: "missing-user", error: "无法识别当前用户" };
    }
    return { ok: true, channel, channelUserId };
  }

  async function status(context = {}) {
    const ident = await identityOf(context);
    if (!ident.ok) return ident;
    await ensureTable();
    return withConnection(async (conn) => {
      const row = await findUserRow(conn, ident.channel, ident.channelUserId);
      const binding = await hydrate(row);
      return { ok: true, code: "status", binding };
    });
  }

  async function unbind(context = {}) {
    const ident = await identityOf(context);
    if (!ident.ok) return ident;
    await ensureTable();
    return withConnection(async (conn) => {
      const existing = await findUserRow(conn, ident.channel, ident.channelUserId);
      if (!existing) return { ok: true, code: "not-bound", binding: null };
      await conn.query(
        "DELETE FROM channel_anchor_binds WHERE channel = ? AND channel_user_id = ?",
        [ident.channel, ident.channelUserId]
      );
      return { ok: true, code: "unbound", binding: await hydrate(existing) };
    });
  }

  async function bind(input = {}) {
    const ident = await identityOf(input);
    if (!ident.ok) return ident;
    const douyinNo = normalizeDouyinNo(input.douyinNo || input.query || input.douyin_no);
    if (!douyinNo) {
      return { ok: false, code: "missing-douyin", error: "请提供抖音号" };
    }

    const anchors = await loadAnchors();
    const anchor = findAnchorByDouyinNo(douyinNo, anchors);
    if (!anchor) {
      return { ok: false, code: "not-in-roster", error: "抖音号不在主播列表中" };
    }
    const personId = Number(anchor.id);
    if (!Number.isInteger(personId) || personId <= 0) {
      return { ok: false, code: "not-in-roster", error: "主播档案无效" };
    }
    const storedHandle = accountKeysOf(anchor).includes(douyinNo)
      ? douyinNo
      : (String(anchor.douyinNo || "").trim() || douyinNo);
    const anchorId = String(anchor.anchorId || storedHandle);

    await ensureTable();
    return withConnection(async (conn) => {
      await conn.beginTransaction();
      try {
        const [userRow, handleRow, personRow] = await Promise.all([
          findUserRow(conn, ident.channel, ident.channelUserId),
          findDouyinRow(conn, storedHandle),
          findPersonRow(conn, personId),
        ]);

        const taken = [handleRow, personRow].find((row) => row && !sameIdentity(row, ident.channel, ident.channelUserId));
        if (taken) {
          await conn.rollback();
          return { ok: false, code: "douyin-taken", error: "该抖音号已被绑定" };
        }

        if (userRow && Number(userRow.person_id) === personId && String(userRow.douyin_no) === storedHandle) {
          await conn.commit();
          return { ok: true, code: "already-bound", binding: await hydrate(userRow, anchors) };
        }

        if (userRow) {
          await conn.query(
            `UPDATE channel_anchor_binds
                SET person_id = ?, douyin_no = ?, anchor_id = ?
              WHERE id = ?`,
            [personId, storedHandle, anchorId, userRow.id]
          );
          await conn.commit();
          const updated = {
            ...userRow,
            person_id: personId,
            douyin_no: storedHandle,
            anchor_id: anchorId,
          };
          return { ok: true, code: "updated", binding: await hydrate(updated, anchors) };
        }

        await conn.query(
          `INSERT INTO channel_anchor_binds
             (channel, channel_user_id, person_id, douyin_no, anchor_id)
           VALUES (?, ?, ?, ?, ?)`,
          [ident.channel, ident.channelUserId, personId, storedHandle, anchorId]
        );
        await conn.commit();
        return {
          ok: true,
          code: "bound",
          binding: toPublicBinding({
            channel: ident.channel,
            channel_user_id: ident.channelUserId,
            person_id: personId,
            douyin_no: storedHandle,
            anchor_id: anchorId,
          }, anchor),
        };
      } catch (error) {
        try { await conn.rollback(); } catch { /* ignore */ }
        if (isDuplicateKeyError(error)) {
          return { ok: false, code: "douyin-taken", error: "该抖音号已被绑定" };
        }
        return { ok: false, code: "error", error: compactError(error) };
      }
    });
  }

  return {
    bind,
    status,
    unbind,
    ensureTable,
  };
}

module.exports = {
  CREATE_CHANNEL_ANCHOR_BINDS_SQL,
  normalizeDouyinNo,
  normalizeBindChannel,
  resolveBindChannel,
  resolveBindUserId,
  parseBindCommand,
  formatBindReply,
  findAnchorByDouyinNo,
  createAnchorBindService,
};
