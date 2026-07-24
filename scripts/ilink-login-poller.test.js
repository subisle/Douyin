"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoginPoller } = require("./ilink-login-poller");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("login poller claims slot, writes QR, saves credential on confirm", async () => {
  const events = [];
  const writes = [];
  const credentials = [];
  let statusCalls = 0;

  const loginStore = {
    expireStale: async () => ({ ok: true, expired: 0 }),
    claimLoginRequest: async () => ({
      ok: true,
      requestId: "req-1",
      loginSlotId: "default",
      actorId: "admin",
      accountId: null,
      status: "claimed",
    }),
    writeLoginResult: async (input) => {
      writes.push(input);
      return { ok: true };
    },
    markLoginSucceeded: async (input) => {
      writes.push({ ...input, status: "succeeded" });
      return { ok: true };
    },
    markLoginFailed: async (input) => {
      writes.push({ ...input, status: "failed" });
      return { ok: true };
    },
  };

  const adapter = {
    getBotQrCode: async () => ({
      qrcode: "QR-CODE-1",
      qrcode_img_content: "data:image/png;base64,abc",
    }),
    getQrCodeStatus: async () => {
      statusCalls += 1;
      if (statusCalls === 1) return { status: "wait" };
      if (statusCalls === 2) return { status: "scaned" };
      return {
        status: "confirmed",
        bot_token: "tok-from-qr",
        ilink_bot_id: "bot-99",
        baseurl: "https://ilinkai.weixin.qq.com",
      };
    },
  };

  const poller = createLoginPoller({
    loginStore,
    credentialStore: {
      setCredential: async (input) => {
        credentials.push(input);
        return { ok: true, accountId: 1 };
      },
    },
    adapter,
    workspaceId: "ws",
    loginSlotId: "default",
    ownerId: "worker-1",
    accountKey: "acc-key",
    pollMs: 5,
    sleep: async () => {
      await delay(1);
    },
    onEvent: (e) => events.push(e),
  });

  const p = poller.start();
  await delay(50);
  await poller.stop();
  await p;

  assert.ok(writes.some((w) => w.status === "awaiting_scan"));
  assert.ok(writes.some((w) => w.status === "scanned" || w.result?.phase === "scanned"));
  assert.equal(credentials.length, 1);
  assert.equal(credentials[0].token, "tok-from-qr");
  assert.equal(credentials[0].accountKey, "acc-key");
  assert.ok(!JSON.stringify(writes).includes("tok-from-qr"));
  assert.equal(poller.getState().phase, "succeeded");
});

test("login poller idle when nothing to claim", async () => {
  const poller = createLoginPoller({
    loginStore: {
      expireStale: async () => ({ ok: true, expired: 0 }),
      claimLoginRequest: async () => ({ ok: false, code: "NOT_CLAIMABLE" }),
    },
    adapter: {
      getBotQrCode: async () => {
        throw new Error("should not fetch qr");
      },
      getQrCodeStatus: async () => {
        throw new Error("should not poll status");
      },
    },
    workspaceId: "ws",
    ownerId: "w",
    pollMs: 5,
    sleep: async () => {
      await delay(1);
    },
  });
  const p = poller.start();
  await delay(20);
  await poller.stop();
  await p;
  assert.ok(["idle", "stopped", "polling_slots"].includes(poller.getState().phase));
});
