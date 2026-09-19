import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

interface ChannelStatus {
  name: string;
  running: boolean;
  connected: boolean;
  note?: string;
}

interface Parsed {
  input: string;
  intent: {
    Kind: string;
    Date?: string;
    Period?: string;
    Year?: number;
    Query?: string;
    Gender?: string;
  };
}

interface WeixinQR {
  qrcode: string;
  url: string;
  expiresAt: string;
}

interface LoginStatus {
  phase: string;
  scanned: boolean;
  loggedIn: boolean;
  nickname?: string;
  note?: string;
}

const CHANNEL_LABEL: Record<string, string> = {
  weixin: "微信 iLink",
  qq: "QQ 开放平台",
};

const INTENT_LABEL: Record<string, string> = {
  help: "帮助",
  daily_report: "日报",
  monthly_report: "月报",
  yearly_report: "年报",
  daily_star: "每日之星",
  person_query: "查主播",
  push_toggle: "推送开关",
  push_status: "推送状态",
  pk_group: "PK 分组",
  unknown: "没听懂",
};

const LOGIN_PHASE_LABEL: Record<string, string> = {
  awaiting_scan: "等待扫码",
  scanned: "已扫码，请在手机上确认",
  running: "登录成功",
  session_expired: "二维码已过期",
  error: "登录异常",
};

const SAMPLES = ["日报", "昨天", "18号报告", "9.11", "9月", "2026年", "柚子", "柚子 9月", "开启日报推送", "帮助"];

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { message: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `请求失败（${res.status}）`);
  return json.data as T;
}

/**
 * 机器人页：双通道状态 + 微信扫码 + QQ 凭证 + 指令试玩。
 *
 * 「指令试玩」很重要：不用连真实微信/QQ 账号，就能验证"群里这句话会被理解成什么"。
 */
export function BotPage() {
  const [status, setStatus] = useState<ChannelStatus[]>([]);
  const [push, setPush] = useState(false);
  const [text, setText] = useState("柚子 9月");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await callApi<{ channels: ChannelStatus[]; push: boolean }>("/api/v1/bots/status");
      setStatus(data.channels ?? []);
      setPush(data.push);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const act = async (path: string, method = "POST") => {
    try {
      await callApi(path, { method });
      await loadStatus();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const parse = async (input: string) => {
    setBusy(true);
    setErr("");
    try {
      const data = await callApi<Parsed>("/api/v1/bots/parse", {
        method: "POST",
        body: JSON.stringify({ text: input }),
      });
      setParsed(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>机器人</h3>

      <div className="toolbar">
        <button className="ghost" onClick={() => void loadStatus()}>
          刷新状态
        </button>
        {err && <span className="err">{err}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {status.length === 0 && <p className="muted">点「刷新状态」查看通道。</p>}
        {status.map((c) => (
          <div key={c.name} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
            <p style={{ margin: "0 0 6px", fontWeight: 500 }}>{CHANNEL_LABEL[c.name] ?? c.name}</p>
            <p style={{ margin: "0 0 8px", fontSize: 13 }}>
              <span className={c.running ? "ok" : "muted"}>{c.running ? "运行中" : "已停止"}</span>
              {c.connected && <span className="ok"> · 已连接</span>}
            </p>
            {c.note && (
              <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                {c.note}
              </p>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => void act(`/api/v1/bots/${c.name}/start`)} disabled={c.running}>
                启动
              </button>
              <button className="ghost" onClick={() => void act(`/api/v1/bots/${c.name}/stop`)} disabled={!c.running}>
                停止
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <span className="muted">日报推送：</span>
        <button onClick={() => void fetch("/api/v1/bots/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !push }),
        }).then(loadStatus)}>
          {push ? "关闭" : "开启"}
        </button>
      </div>

      <WeixinLoginPanel onChanged={loadStatus} onError={setErr} />

      <QqCredentialsPanel onChanged={loadStatus} onError={setErr} />

      <h4 style={{ margin: "20px 0 10px" }}>指令试玩</h4>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        输入群里真实会打的话，看机器人把它理解成什么指令。不用连真实账号。
      </p>

      <div className="toolbar">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void parse(text)}
          placeholder="例如：柚子 9月"
          style={{ minWidth: 200 }}
        />
        <button onClick={() => void parse(text)} disabled={busy || !text.trim()}>
          解析
        </button>
      </div>

      <div className="toolbar">
        {SAMPLES.map((s) => (
          <button key={s} className="ghost" onClick={() => { setText(s); void parse(s); }}>
            {s}
          </button>
        ))}
      </div>

      {parsed && (
        <table>
          <thead>
            <tr>
              <th>输入</th>
              <th>识别为</th>
              <th>日期</th>
              <th>月份</th>
              <th>年份</th>
              <th>艺名</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{parsed.input}</td>
              <td>{INTENT_LABEL[parsed.intent.Kind] ?? parsed.intent.Kind}</td>
              <td>{parsed.intent.Date || "—"}</td>
              <td>{parsed.intent.Period || "—"}</td>
              <td>{parsed.intent.Year || "—"}</td>
              <td>{parsed.intent.Query || "—"}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

/** 微信扫码登录：取二维码 → 本地渲染 → 轮询扫码状态，登录成功自动停。 */
function WeixinLoginPanel({ onChanged, onError }: { onChanged: () => void; onError: (msg: string) => void }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [login, setLogin] = useState<LoginStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback((stopped: { value: boolean }) => {
    window.setTimeout(async () => {
      if (stopped.value) return;
      try {
        const st = await callApi<LoginStatus>("/api/v1/bots/weixin/qrcode/status");
        setLogin(st);
        if (st.loggedIn) {
          stopPolling();
          setQrDataUrl(null);
          onChanged();
          return;
        }
        if (st.phase === "session_expired" || st.phase === "error") {
          stopPolling();
          return;
        }
      } catch (e) {
        // 单次轮询失败不终止流程（网络抖动/超时），连续失败靠用户手动取消
        onError((e as Error).message);
      }
      if (!stopped.value) poll(stopped);
    }, 2500);
  }, [onChanged, onError, stopPolling]);

  const startLogin = async () => {
    setBusy(true);
    onError("");
    try {
      const qr = await callApi<WeixinQR>("/api/v1/bots/weixin/qrcode", { method: "POST" });
      // 优先用返回的图片地址，否则把二维码内容本地渲染（615 的做法）
      const dataUrl = qr.url && qr.url.startsWith("data:")
        ? qr.url
        : await QRCode.toDataURL(qr.qrcode, { width: 220, margin: 1 });
      setQrDataUrl(dataUrl);
      setLogin({ phase: "awaiting_scan", scanned: false, loggedIn: false });
      const stopped = { value: false };
      stopPolling();
      poll(stopped);
    } catch (e) {
      onError((e as Error).message);
      setLogin(null);
    } finally {
      setBusy(false);
    }
  };

  const cancelLogin = () => {
    stopPolling();
    setQrDataUrl(null);
    setLogin(null);
  };

  const phaseText = login ? LOGIN_PHASE_LABEL[login.phase] ?? login.note ?? login.phase : "";

  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, marginTop: 16 }}>
      <h4 style={{ margin: "0 0 8px" }}>微信扫码登录</h4>
      <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
        用任意微信扫码登录 iLink 机器人。二维码过期后点「重新取码」。
      </p>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="微信登录二维码"
            width={180}
            height={180}
            style={{ borderRadius: 8, border: "1px solid var(--border)", background: "#fff", padding: 6 }}
          />
        ) : (
          <div
            style={{
              width: 180, height: 180, display: "grid", placeItems: "center",
              border: "1px dashed var(--border)", borderRadius: 8, fontSize: 12,
            }}
            className="muted"
          >
            {login ? phaseText : "尚未开始"}
          </div>
        )}
        <div style={{ minWidth: 180 }}>
          {login && qrDataUrl && (
            <p style={{ fontSize: 13, marginTop: 0 }}>
              <span className={login.loggedIn ? "ok" : ""}>{phaseText}</span>
              {login.nickname ? ` · ${login.nickname}` : ""}
            </p>
          )}
          {login?.loggedIn && <p className="ok" style={{ fontSize: 13, margin: "0 0 10px" }}>登录成功，机器人可启动。</p>}
          <div style={{ display: "flex", gap: 6 }}>
            {qrDataUrl ? (
              <button className="ghost" onClick={cancelLogin}>取消</button>
            ) : (
              <button onClick={() => void startLogin()} disabled={busy}>
                {busy ? "取码中…" : qrDataUrl ? "重新取码" : "扫码连接"}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** QQ 凭证：AppID + ClientSecret，保存后立即挂载（无需重启）。 */
function QqCredentialsPanel({ onChanged, onError }: { onChanged: () => void; onError: (msg: string) => void }) {
  const [appId, setAppId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!appId.trim() || !clientSecret.trim()) {
      onError("AppID 与 ClientSecret 都不能为空");
      return;
    }
    setBusy(true);
    onError("");
    try {
      await callApi("/api/v1/bots/qq/credentials", {
        method: "POST",
        body: JSON.stringify({ appId: appId.trim(), clientSecret: clientSecret.trim() }),
      });
      setSaved(true);
      setClientSecret("");
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, marginTop: 16 }}>
      <h4 style={{ margin: "0 0 8px" }}>QQ 机器人配置</h4>
      <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
        在 <a href="https://q.qq.com" target="_blank" rel="noreferrer">q.qq.com</a>{" "}
        创建机器人、订阅「群聊@消息 / 私聊消息」后，把 AppID 与 ClientSecret 填到这里，保存即挂载（不用重启）。
        也可以用环境变量 DY_QQ_APP_ID / DY_QQ_CLIENT_SECRET 配置。
      </p>
      <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
        <label style={{ fontSize: 13 }}>
          <span className="muted">AppID</span>
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="从 QQ 开放平台复制"
            style={{ width: "100%" }}
            autoComplete="off"
          />
        </label>
        <label style={{ fontSize: 13 }}>
          <span className="muted">ClientSecret</span>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={saved ? "已保存（重新输入可覆盖）" : "请勿泄露"}
            style={{ width: "100%" }}
            autoComplete="off"
          />
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => void save()} disabled={busy}>
            {busy ? "保存中…" : "保存凭证"}
          </button>
          {saved && <span className="ok" style={{ fontSize: 12 }}>已保存，可在上方启动 QQ 通道</span>}
        </div>
      </div>
    </section>
  );
}
