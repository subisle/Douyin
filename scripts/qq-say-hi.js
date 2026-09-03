"use strict";

/**
 * 一次性脚本：给已对接的 QQ 用户主动发「你好」。
 * 用法：node scripts/qq-say-hi.js [openid]
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  fetchAppAccessToken,
  sendC2cMessage,
} = require("../shared/qqbot-adapter");

async function main() {
  const openid = process.argv[2] || "89D66F74F5CDEF99EA729F59B73379F5";
  const storagePath = path.join(os.homedir(), "Library/Application Support/douyin/qq-bot.v1.json");
  const raw = JSON.parse(fs.readFileSync(storagePath, "utf8"));
  const { appId, clientSecret, apiBase } = raw.settings || {};
  if (!appId || !clientSecret) throw new Error("缺少 QQ 机器人凭据");

  const { accessToken } = await fetchAppAccessToken({ appId, clientSecret });

  const result = await sendC2cMessage({
    accessToken,
    appId,
    apiBase,
    openid,
    content: "你好",
    msgType: 0,
  });
  console.log("发送成功:", JSON.stringify(result));
}

main().catch((error) => {
  console.error("发送失败:", error.message);
  process.exit(1);
});
