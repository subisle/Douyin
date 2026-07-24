"use strict";

/**
 * Minimal login-slot poller: claim pending request → fetch QR → poll status →
 * persist encrypted progress + credentials on success.
 *
 * Does NOT log QR content or bot tokens.
 */

const DEFAULT_POLL_MS = 800;
const DEFAULT_SLOT = "default";

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error) {
  return Boolean(error && (error.name === "AbortError" || error.code === "ABORT_ERR"));
}

/**
 * @param {{
 *   loginStore: object,
 *   credentialStore?: object,
 *   adapter: { getBotQrCode: Function, getQrCodeStatus: Function },
 *   workspaceId: string,
 *   loginSlotId?: string,
 *   ownerId: string,
 *   accountKey?: string,
 *   pollMs?: number,
 *   now?: () => Date,
 *   sleep?: Function,
 *   onEvent?: Function,
 *   logger?: { log?: Function, error?: Function },
 * }} options
 */
function createLoginPoller(options) {
  if (!options?.loginStore || !options?.adapter) {
    throw new Error("createLoginPoller requires loginStore and adapter");
  }
  const loginStore = options.loginStore;
  const credentialStore = options.credentialStore || null;
  const adapter = options.adapter;
  const workspaceId = String(options.workspaceId || "default");
  const loginSlotId = String(options.loginSlotId || DEFAULT_SLOT);
  const ownerId = String(options.ownerId || "worker");
  const accountKey = String(options.accountKey || loginSlotId);
  const pollMs = Number(options.pollMs) > 0 ? Number(options.pollMs) : DEFAULT_POLL_MS;
  const sleepFn = typeof options.sleep === "function" ? options.sleep : sleep;
  const onEvent = typeof options.onEvent === "function" ? options.onEvent : () => {};
  const logger = options.logger || {};

  let controller = null;
  let loopPromise = null;
  let state = {
    phase: "idle",
    requestId: null,
    lastStatus: null,
    lastError: null,
  };

  function setState(patch) {
    state = { ...state, ...patch };
    onEvent({ type: "login_state", state: { ...state } });
    return { ...state };
  }

  async function handleClaimed(claimed, signal) {
    setState({
      phase: "fetching_qr",
      requestId: claimed.requestId,
      lastError: null,
    });

    const qrResponse = await adapter.getBotQrCode({});
    const qrcode = String(qrResponse?.qrcode || "").trim();
    const img = String(qrResponse?.qrcode_img_content || "").trim();
    if (!qrcode) {
      await loginStore.markLoginFailed({
        requestId: claimed.requestId,
        error: "empty qrcode from adapter",
      });
      setState({ phase: "failed", lastError: "empty qrcode" });
      return;
    }

    // Persist QR for control plane; never log img/token.
    await loginStore.writeLoginResult({
      requestId: claimed.requestId,
      status: "awaiting_scan",
      result: {
        qrcode,
        hasImage: Boolean(img),
        // Control plane may render from qrcode string; full data URL only if short enough policy later.
        qrcode_img_content: img ? String(img).slice(0, 200_000) : null,
      },
    });
    setState({ phase: "awaiting_scan", lastStatus: "wait" });
    onEvent({ type: "login_qr", requestId: claimed.requestId });

    while (!signal.aborted) {
      const statusResponse = await adapter.getQrCodeStatus({ qrcode });
      const phase = String(statusResponse?.status || "wait");
      setState({ lastStatus: phase });

      if (phase === "scaned" || phase === "scanned") {
        await loginStore.writeLoginResult({
          requestId: claimed.requestId,
          status: "scanned",
          result: { qrcode, phase: "scanned" },
        });
      } else if (phase === "expired") {
        await loginStore.markLoginFailed({
          requestId: claimed.requestId,
          error: "qr expired",
        });
        setState({ phase: "failed", lastError: "qr expired" });
        return;
      } else if (phase === "confirmed") {
        const token = String(statusResponse?.bot_token || "").trim();
        const ilinkBotId = String(statusResponse?.ilink_bot_id || "").trim();
        const baseUrl = String(statusResponse?.baseurl || "").trim();
        if (!token) {
          await loginStore.markLoginFailed({
            requestId: claimed.requestId,
            error: "missing bot_token",
          });
          setState({ phase: "failed", lastError: "missing bot_token" });
          return;
        }

        if (credentialStore && typeof credentialStore.setCredential === "function") {
          const saved = await credentialStore.setCredential({
            workspaceId,
            accountKey: accountKey || ilinkBotId || loginSlotId,
            token,
            baseUrl: baseUrl || undefined,
          });
          if (!saved?.ok) {
            await loginStore.markLoginFailed({
              requestId: claimed.requestId,
              error: saved?.error || "setCredential failed",
            });
            setState({ phase: "failed", lastError: "setCredential failed" });
            return;
          }
        }

        await loginStore.markLoginSucceeded({
          requestId: claimed.requestId,
          result: {
            phase: "confirmed",
            ilinkBotId: ilinkBotId || null,
            hasToken: true,
            // never include raw token in control result
          },
        });
        setState({ phase: "succeeded", lastStatus: "confirmed", lastError: null });
        onEvent({
          type: "login_succeeded",
          requestId: claimed.requestId,
          ilinkBotId: ilinkBotId || null,
        });
        return;
      }

      await sleepFn(pollMs, signal);
    }
  }

  async function tick(signal) {
    if (typeof loginStore.expireStale === "function") {
      await loginStore.expireStale({ workspaceId });
    }
    const claimed = await loginStore.claimLoginRequest({
      workspaceId,
      loginSlotId,
      ownerId,
    });
    if (!claimed?.ok) {
      setState({
        phase: state.phase === "succeeded" ? "succeeded" : "idle",
        lastError: null,
      });
      return { claimed: false };
    }
    await handleClaimed(claimed, signal);
    return { claimed: true };
  }

  async function loop() {
    const signal = controller.signal;
    setState({ phase: "polling_slots" });
    while (!signal.aborted) {
      try {
        await tick(signal);
        if (state.phase === "succeeded" || state.phase === "failed") {
          // Terminal for this slot attempt; stop until restarted.
          break;
        }
      } catch (error) {
        if (signal.aborted || isAbortError(error)) break;
        setState({
          lastError: error instanceof Error ? error.message : String(error),
        });
        if (typeof logger.error === "function") {
          logger.error("[login-poller] tick failed");
        }
      }
      if (signal.aborted) break;
      try {
        // Always yield — tests may inject a no-op sleep; still schedule a macrotask.
        await sleepFn(Math.max(1, pollMs), signal);
      } catch {
        break;
      }
    }
    if (state.phase !== "succeeded" && state.phase !== "failed") {
      setState({ phase: "stopped" });
    }
  }

  return {
    getState: () => ({ ...state }),
    async start() {
      if (loopPromise) return { ...state };
      controller = new AbortController();
      loopPromise = loop().finally(() => {
        loopPromise = null;
        controller = null;
      });
      await Promise.resolve();
      return { ...state };
    },
    async stop() {
      if (controller) controller.abort();
      if (loopPromise) {
        try {
          await loopPromise;
        } catch {
          // ignore
        }
      }
      if (state.phase !== "succeeded") setState({ phase: "stopped" });
      return { ...state };
    },
    // exposed for tests
    tick: (signal) => tick(signal || { aborted: false }),
  };
}

module.exports = {
  createLoginPoller,
  DEFAULT_POLL_MS,
  DEFAULT_SLOT,
};
