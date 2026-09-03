const https = require("https");
const { autoUpdater } = require("electron-updater");

// 更新源指向主仓库的最新 Release（发版时上传 dmg/zip/blockmap/latest-mac.yml 即生效）
const GITHUB_UPDATE_FEED = "https://github.com/subisle/Douyin/releases/latest/download";
const AKAMS_PROXY_NODES = [
  "gh.dpik.top",
  "github.tbap.top",
  "gh-proxy.com",
  "cdn.gh-proxy.com",
  "github.dpik.top",
  "ghfile.geekertao.top",
  "gh-proxy.net",
  "github-proxy.memory-echoes.cn",
  "git.yylx.win",
  "gh.felicity.ac.cn",
  "gh.927223.xyz",
  "gh.b52m.cn",
  "gh.acmsz.top",
  "gh.tryxd.cn",
  "gitproxy.click",
  "github.chenc.dev",
  "ghfast.top",
  "github.geekery.cn",
  "ghp.keleyaa.com",
  "ghproxy.monkeyray.net",
];

const UPDATE_FEED_CANDIDATES = [
  ...AKAMS_PROXY_NODES.map((node) => ({
    name: `akams/${node}`,
    url: `https://${node}/${GITHUB_UPDATE_FEED}`,
    akamsNode: true,
  })),
  {
    name: "GitHub",
    url: GITHUB_UPDATE_FEED,
  },
];

const DEFAULT_UPDATE_FEED = UPDATE_FEED_CANDIDATES[0];
const UPDATE_PROBE_TIMEOUT_MS = 4500;
const UPDATE_REQUEST_HEADERS = {
  "cache-control": "no-cache, no-store, must-revalidate",
  pragma: "no-cache",
  expires: "0",
  "user-agent": "douyin-data-manager-updater",
};

function createUpdater({ isDev, sendStatus }) {
  let status = {
    status: "idle",
    info: null,
    progress: null,
    error: null,
    feed: null,
    checkedAt: null,
  };

  const setStatus = (partial) => {
    status = { ...status, ...partial };
    sendStatus?.({ ...status });
  };

  const configureUpdateFeed = (feed) => {
    autoUpdater.requestHeaders = UPDATE_REQUEST_HEADERS;
    autoUpdater.setFeedURL({
      provider: "generic",
      url: feed.url,
      requestHeaders: UPDATE_REQUEST_HEADERS,
    });
    setStatus({ feed: feed.name });
  };

  const selectAndConfigureFeed = async () => {
    const feed = await selectUpdateFeed();
    configureUpdateFeed(feed);
    return feed;
  };

  const check = async () => {
    if (isDev) {
      setStatus({
        status: "idle",
        info: null,
        progress: null,
        error: null,
        checkedAt: new Date().toISOString(),
      });
      return { status: status.status };
    }
    setStatus({ status: "checking", progress: null, error: null });
    await selectAndConfigureFeed();
    await autoUpdater.checkForUpdates();
    return { status: status.status };
  };

  const download = async () => {
    if (isDev) return { status: "idle" };
    if (status.status !== "available") {
      await check();
    } else {
      await selectAndConfigureFeed();
    }
    if (status.status !== "available") {
      throw new Error(status.status === "not-available" ? "当前已经是最新版本" : "没有可下载的更新");
    }
    await autoUpdater.downloadUpdate();
    return { status: status.status };
  };

  const install = () => {
    if (isDev) return { status: "idle" };
    autoUpdater.quitAndInstall();
    return { status: "installing" };
  };

  const init = () => {
    if (isDev) {
      console.log("[updater] 开发模式，跳过自动更新初始化");
      return;
    }

    configureUpdateFeed(DEFAULT_UPDATE_FEED);
    // OTA 自动更新：后台增量下载（blockmap 只传差异块），退出应用时自动安装
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on("checking-for-update", () => {
      console.log("[updater] 正在检查更新…");
      setStatus({ status: "checking", info: null, progress: null, error: null });
    });

    autoUpdater.on("update-available", (info) => {
      console.log("[updater] 发现新版本:", info.version);
      setStatus({
        status: "available",
        info: normalizeUpdateInfo(info),
        progress: null,
        error: null,
        checkedAt: new Date().toISOString(),
      });
    });

    autoUpdater.on("update-not-available", () => {
      console.log("[updater] 当前已是最新版本");
      setStatus({
        status: "not-available",
        info: null,
        progress: null,
        error: null,
        checkedAt: new Date().toISOString(),
      });
    });

    autoUpdater.on("download-progress", (progress) => {
      console.log(`[updater] 下载进度: ${progress.percent.toFixed(1)}%`);
      setStatus({
        status: "downloading",
        progress: {
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
        },
        error: null,
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      console.log("[updater] 更新已下载，等待安装");
      setStatus({
        status: "downloaded",
        info: normalizeUpdateInfo(info),
        error: null,
      });
    });

    autoUpdater.on("error", (error) => {
      console.error("[updater] 更新错误:", error?.message || error);
      setStatus({ status: "error", error: error?.message || String(error) });
    });

    setTimeout(() => {
      check().catch((err) => {
        console.error("[updater] 检查更新失败:", err?.message || err);
      });
    }, 5000);

    setInterval(
      () => {
        check().catch((err) => {
          console.error("[updater] 定时检查更新失败:", err?.message || err);
        });
      },
      60 * 60 * 1000
    );
  };

  return {
    init,
    check,
    download,
    install,
    getStatus: () => ({ ...status }),
  };
}

function normalizeUpdateInfo(info) {
  return {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes,
  };
}

// 探测用的清单文件名：mac 用 latest-mac.yml，其他平台用 latest.yml
const UPDATE_MANIFEST_NAME = process.platform === "darwin" ? "latest-mac.yml" : "latest.yml";

function probeUpdateFeed(candidate) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const cacheBust = `t=${Date.now()}`;
    const url = `${candidate.url.replace(/\/$/, "")}/${UPDATE_MANIFEST_NAME}?${cacheBust}`;
    const req = https.request(
      url,
      {
        method: "GET",
        timeout: UPDATE_PROBE_TIMEOUT_MS,
        headers: UPDATE_REQUEST_HEADERS,
      },
      (res) => {
        const statusCode = Number(res.statusCode || 0);
        let sample = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (sample.length < 256) sample += chunk;
        });
        res.on("end", () => {
          const elapsedMs = Date.now() - startedAt;
          const ok = statusCode >= 200 && statusCode < 300 && sample.includes("version:");
          resolve({ ...candidate, ok, statusCode, elapsedMs });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", () => {
      resolve({ ...candidate, ok: false, statusCode: 0, elapsedMs: Date.now() - startedAt });
    });
    req.end();
  });
}

async function selectUpdateFeed() {
  const probes = await Promise.all(UPDATE_FEED_CANDIDATES.map((candidate) => probeUpdateFeed(candidate)));
  const usable = probes.filter((item) => item.ok);
  const akamsNodes = usable.filter((item) => item.akamsNode);
  const preferred = akamsNodes.sort((a, b) => a.elapsedMs - b.elapsedMs)[0] || null;
  const selected = preferred || usable.sort((a, b) => a.elapsedMs - b.elapsedMs)[0] || DEFAULT_UPDATE_FEED;
  console.log(
    `[updater] 使用更新源: ${selected.name} (${selected.url})`,
    probes.map((item) => `${item.name}:${item.ok ? `${item.elapsedMs}ms` : `fail-${item.statusCode}`}`).join(", ")
  );
  return selected;
}

module.exports = {
  createUpdater,
};
