"use strict";

/**
 * P3 stub: Douyin account/works insight.
 * Desktop may later use live-pk-capture BrowserWindow signing.
 * Server must only READ cache tables — no BrowserWindow.
 */

async function resolveDouyinAccount({ douyinNo, query } = {}) {
  return {
    ok: false,
    error: "抖音账号解析尚未启用（P3）。服务器仅读缓存；请在桌面端刷新或等待日任务。",
    douyinNo: douyinNo || null,
    query: query || null,
  };
}

async function listAnchorAwemes() {
  return {
    ok: false,
    error: "作品列表尚未启用（P3 活跃池增量）。",
    items: [],
  };
}

async function getCachedDouyinProfile() {
  return { ok: true, found: false, message: "无缓存画像" };
}

module.exports = {
  resolveDouyinAccount,
  listAnchorAwemes,
  getCachedDouyinProfile,
};
