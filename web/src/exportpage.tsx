import { useEffect, useState } from "react";

const todayLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// 把 SVG 画到 canvas 再导出 PNG。
// 走浏览器渲染是刻意的：emoji 奖牌、中文字体、水印只有真实浏览器能画对。
async function svgToPng(svgText: string, scale = 2): Promise<Blob> {
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("SVG 加载失败"));
    img.src = url;
  });

  const w = img.naturalWidth || 1440;
  const h = img.naturalHeight || 800;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 canvas");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 生成失败"))), "image/png");
  });
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 导出图片——字段与样式对齐 615：
 * 排名 / 主播姓名 / 未播天数 / 日音浪 / 累计总音浪（可选：当月时长、师傅、等级）
 * 女队用 classic 样式，男团用 apple 样式。
 */
export function ExportPage() {
  const [date, setDate] = useState(todayLocal());
  const [gender, setGender] = useState("female");
  const [style, setStyle] = useState("auto");
  const [duration, setDuration] = useState(false);
  const [master, setMaster] = useState(false);
  const [tier, setTier] = useState(false);
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setErr("");
    try {
      const usp = new URLSearchParams({
        date,
        gender,
        style,
        duration: duration ? "1" : "0",
        master: master ? "1" : "0",
        tier: tier ? "1" : "0",
      });
      const res = await fetch(`/api/v1/exports/report.svg?${usp}`);
      if (!res.ok) throw new Error(`后端返回 ${res.status}`);
      setSvg(await res.text());
    } catch (e) {
      setErr((e as Error).message);
      setSvg("");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewUrl = svg ? URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) : "";

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>导出图片</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        字段：排名 / 主播姓名 / 未播天数 / 日音浪 / 累计总音浪，可选当月时长、师傅、等级。
        女队默认 classic 样式，男团默认 apple 样式。
      </p>

      <div className="toolbar">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="female">女队</option>
          <option value="male">男团</option>
        </select>
        <select value={style} onChange={(e) => setStyle(e.target.value)}>
          <option value="auto">跟随性别</option>
          <option value="classic">classic（样式一）</option>
          <option value="apple">apple（样式二）</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={duration} onChange={(e) => setDuration(e.target.checked)} />
          当月时长
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={master} onChange={(e) => setMaster(e.target.checked)} />
          师傅
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={tier} onChange={(e) => setTier(e.target.checked)} />
          等级
        </label>
        <button onClick={() => void load()} disabled={busy}>
          生成预览
        </button>
      </div>

      <div className="toolbar">
        <button
          className="ghost"
          disabled={!svg}
          onClick={() => download(new Blob([svg], { type: "image/svg+xml" }), `report-${date}-${gender}.svg`)}
        >
          下载 SVG
        </button>
        <button
          className="ghost"
          disabled={!svg}
          onClick={async () => {
            try {
              download(await svgToPng(svg, 2), `report-${date}-${gender}.png`);
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          下载 PNG（2 倍图）
        </button>
        {busy && <span className="muted">生成中…</span>}
      </div>

      {err && <p className="err">{err}</p>}

      {svg ? (
        <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "#fff" }}>
          <img src={previewUrl} alt="导出图预览" style={{ width: "100%", display: "block" }} />
        </div>
      ) : (
        !busy && <p className="muted">还没有预览，点「生成预览」。</p>
      )}

      <p className="muted" style={{ fontSize: 12 }}>
        PNG 由浏览器渲染 SVG 得到，字体与 emoji 与最终 bot 发送的一致。
      </p>
    </div>
  );
}
