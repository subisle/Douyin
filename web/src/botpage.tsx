import { useState } from "react";

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

const SAMPLES = ["日报", "昨天", "18号报告", "9.11", "9月", "2026年", "柚子", "柚子 9月", "开启日报推送", "帮助"];

/**
 * 机器人页：双通道状态 + 指令试玩。
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

  const loadStatus = async () => {
    try {
      const res = await fetch("/api/v1/bots/status");
      if (!res.ok) throw new Error(`后端返回 ${res.status}`);
      const json = (await res.json()) as { data: { channels: ChannelStatus[]; push: boolean } };
      setStatus(json.data.channels ?? []);
      setPush(json.data.push);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const act = async (path: string, method = "POST") => {
    try {
      await fetch(path, { method });
      await loadStatus();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const parse = async (input: string) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/v1/bots/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input }),
      });
      if (!res.ok) throw new Error(`后端返回 ${res.status}`);
      const json = (await res.json()) as { data: Parsed };
      setParsed(json.data);
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
