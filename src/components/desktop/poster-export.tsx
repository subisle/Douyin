"use client";

import { forwardRef } from "react";
import type { DailyReportData } from "@/types/electron";
import { formatDailyWaveLabel } from "./draw-report-canvas";

/* ── 颜色常量 ── */
const C = {
  bgBase: "#07090e",
  cardBg: "rgba(20, 25, 40, 0.5)",
  textMain: "#ffffff",
  textMuted: "#8b949e",
  borderLight: "rgba(255, 255, 255, 0.08)",
  colorS: "#f59e0b", // A级 金
  colorA: "#ec4899", // C级 粉 (原模板 C→粉)
  colorB: "#06b6d4", // B级 青
  colorC: "#8b5cf6", // D级 紫
  sky: "#38bdf8",
  indigo: "#a5b4fc",
};

function tierColor(tier: string): string {
  const c = tier.charAt(0).toUpperCase();
  if (c === "A") return C.colorS;
  if (c === "B") return C.colorB;
  if (c === "C") return C.colorA;
  return C.colorC;
}

/** 格式化音浪数字：加千分位 */
function fmtWave(v: number): string {
  if (!v) return "0";
  return v.toLocaleString("zh-CN");
}

/** 分钟 → x.x h */
function fmtHours(minutes: number): string {
  if (!minutes) return "0 h";
  const h = minutes / 60;
  return h >= 10 ? `${h.toFixed(0)} h` : `${h.toFixed(1)} h`;
}

/** 日期格式化 2026-06-30 → 2026.06.30 */
function fmtDate(d: string): string {
  return d.replace(/-/g, ".");
}

interface PosterProps {
  report: DailyReportData;
}

export const PosterCard = forwardRef<HTMLDivElement, PosterProps>(
  ({ report }, ref) => {
    const rows = report.rows;
    const dailyWaveLabel = formatDailyWaveLabel(report.date);
    // 按当日音浪降序排列（海报展示用）
    const sorted = [...rows].sort((a, b) => b.dailyWave - a.dailyWave);
    const ranked = sorted.map((r, i) => ({ ...r, rank: i + 1 }));

    const maxDaily = ranked.length > 0
      ? Math.max(...ranked.filter((r) => r.isLive).map((r) => r.dailyWave))
      : 0;

    // KPI
    const totalDailyWave = ranked.reduce((s, r) => s + r.dailyWave, 0);
    const liveCount = ranked.filter((r) => r.isLive).length;
    const totalMinutes = ranked.reduce((s, r) => s + r.dailyDuration, 0);
    const totalHours = totalMinutes / 60;

    return (
      <div
        ref={ref}
        style={{
          width: 1080,
          height: 1920,
          backgroundColor: C.bgBase,
          backgroundImage: [
            "radial-gradient(circle at 15% 5%, rgba(6, 182, 212, 0.15) 0%, transparent 40%)",
            "radial-gradient(circle at 85% 15%, rgba(139, 92, 246, 0.15) 0%, transparent 40%)",
            "radial-gradient(circle at 50% 95%, rgba(56, 189, 248, 0.1) 0%, transparent 50%)",
          ].join(", "),
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          color: C.textMain,
          padding: "60px 50px",
          fontFamily: "'Inter', 'Noto Sans SC', sans-serif",
          boxSizing: "border-box",
        }}
      >
        {/* === 1. 海报头部 === */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 40,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              style={{
                fontSize: 24,
                color: C.sky,
                fontWeight: 700,
                letterSpacing: 4,
                textTransform: "uppercase",
              }}
            >
              XingHai Entertainment
            </div>
            <div
              style={{
                fontSize: 56,
                fontWeight: 900,
                letterSpacing: 2,
                background: "linear-gradient(90deg, #ffffff, #94a3b8)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              星嗨艺创数据枢纽
            </div>
          </div>
          <div
            style={{
              background: "rgba(56, 189, 248, 0.1)",
              border: "2px solid rgba(56, 189, 248, 0.3)",
              padding: "16px 32px",
              borderRadius: 100,
              fontSize: 28,
              fontWeight: 900,
              color: C.sky,
              fontFamily: "Inter",
            }}
          >
            {fmtDate(report.date)}
          </div>
        </div>

        {/* === 2. KPI 数据大盘 === */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 30,
            marginBottom: 40,
          }}
        >
          {[
            {
              title: "今日总音浪",
              value: fmtWave(totalDailyWave),
              color: C.sky,
              shadow: "rgba(56,189,248,0.4)",
            },
            {
              title: "开播总人数",
              value: `${liveCount}`,
              suffix: ` / ${ranked.length}`,
              color: "#fff",
              shadow: "rgba(255,255,255,0.2)",
            },
            {
              title: "总有效时长",
              value: totalHours >= 10 ? totalHours.toFixed(0) : totalHours.toFixed(1),
              suffix: "h",
              color: C.indigo,
              shadow: "rgba(165,180,252,0.4)",
            },
          ].map((kpi) => (
            <div
              key={kpi.title}
              style={{
                background: C.cardBg,
                border: `2px solid ${C.borderLight}`,
                borderRadius: 24,
                padding: 30,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                boxShadow: "inset 0 0 40px rgba(255,255,255,0.02)",
              }}
            >
              <div style={{ fontSize: 22, color: C.textMuted, fontWeight: 700 }}>
                {kpi.title}
              </div>
              <div
                style={{
                  fontSize: 54,
                  fontWeight: 900,
                  fontFamily: "Inter",
                  color: kpi.color,
                  textShadow: `0 0 20px ${kpi.shadow}`,
                }}
              >
                {kpi.value}
                {kpi.suffix && (
                  <span style={{ fontSize: 32, color: C.textMuted }}>
                    {kpi.suffix}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* === 3. 数据表区 === */}
        <div
          style={{
            flex: 1,
            background: C.cardBg,
            border: `2px solid ${C.borderLight}`,
            borderRadius: 32,
            padding: "10px 40px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* 列表头 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "80px 180px 120px 240px 140px 110px 80px",
              gap: 0,
              padding: "24px 0",
              borderBottom: "2px solid rgba(255,255,255,0.1)",
              fontSize: 22,
              fontWeight: 700,
              color: C.textMuted,
            }}
          >
            <div style={{ textAlign: "center" }}>RANK</div>
            <div>主播姓名</div>
            <div>等级</div>
            <div style={{ width: "100%" }}>{dailyWaveLabel}</div>
            <div>总音浪</div>
            <div>师傅</div>
            <div>时长</div>
          </div>

          {/* 列表体 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-evenly",
              flex: 1,
            }}
          >
            {ranked.map((r) => {
              const isOffline = !r.isLive;
              const mainColor = tierColor(r.tier);
              const pct =
                maxDaily > 0 && r.isLive
                  ? Math.min((r.dailyWave / maxDaily) * 100, 100)
                  : 0;

              return (
                <div
                  key={r.anchorId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "80px 180px 120px 240px 140px 110px 80px",
                    gap: 0,
                    alignItems: "center",
                    padding: "18px 0",
                    borderBottom:
                      r.rank === ranked.length
                        ? "none"
                        : "2px dashed rgba(255,255,255,0.05)",
                    opacity: isOffline ? 0.5 : 1,
                    filter: isOffline ? "grayscale(100%)" : "none",
                  }}
                >
                  {/* 序号 */}
                  <div
                    style={{
                      fontSize: r.rank === 1 ? 42 : r.rank === 2 ? 38 : r.rank === 3 ? 36 : 32,
                      fontWeight: 900,
                      fontFamily: "Inter",
                      color:
                        r.rank === 1
                          ? "#fef08a"
                          : r.rank === 2
                            ? "#e2e8f0"
                            : r.rank === 3
                              ? "#fdba74"
                              : C.textMuted,
                      textShadow:
                        r.rank === 1
                          ? "0 0 15px rgba(234,179,8,0.8)"
                          : r.rank === 2
                            ? "0 0 15px rgba(148,163,184,0.8)"
                            : r.rank === 3
                              ? "0 0 15px rgba(249,115,22,0.8)"
                              : "none",
                      textAlign: "center",
                    }}
                  >
                    {r.rank < 10 ? `0${r.rank}` : r.rank}
                  </div>

                  {/* 姓名 */}
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#fff" }}>
                    {r.name}
                  </div>

                  {/* 等级 */}
                  <div>
                    {r.tier && (
                      <div
                        style={{
                          display: "inline-flex",
                          justifyContent: "center",
                          alignItems: "center",
                          width: 70,
                          height: 40,
                          borderRadius: 8,
                          fontSize: 24,
                          fontWeight: 900,
                          fontFamily: "Inter",
                          border: `2px solid ${mainColor}`,
                          background: "rgba(0,0,0,0.3)",
                          color: mainColor,
                          boxShadow: `inset 0 0 15px ${mainColor}33`,
                        }}
                      >
                        {r.tier}
                      </div>
                    )}
                  </div>

                  {/* 当日音浪 */}
                  <div>
                    {isOffline ? (
                      <div
                        style={{
                          fontSize: 20,
                          color: C.textMuted,
                          border: `2px dashed ${C.textMuted}`,
                          padding: "4px 12px",
                          borderRadius: 8,
                          display: "inline-block",
                        }}
                      >
                        未开播
                      </div>
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          justifyContent: "center",
                          paddingRight: 20,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 28,
                            fontWeight: 900,
                            fontFamily: "Inter",
                            color: mainColor,
                          }}
                        >
                          {fmtWave(r.dailyWave)}
                        </div>
                        <div
                          style={{
                            width: "100%",
                            height: 8,
                            background: "rgba(255,255,255,0.08)",
                            borderRadius: 4,
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${pct}%`,
                              borderRadius: 4,
                              background: mainColor,
                              boxShadow: `0 0 10px ${mainColor}`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 总音浪 */}
                  <div
                    style={{
                      fontSize: 26,
                      fontFamily: "Inter",
                      fontWeight: 700,
                      color: "#cbd5e1",
                    }}
                  >
                    {fmtWave(r.totalWave)}
                  </div>

                  {/* 师傅 */}
                  <div style={{ fontSize: 22, color: "#94a3b8" }}>
                    {r.masterName || "—"}
                  </div>

                  {/* 时长 */}
                  <div
                    style={{
                      fontSize: 24,
                      fontFamily: "Inter",
                      fontWeight: 700,
                      color: C.indigo,
                    }}
                  >
                    {r.dailyDuration > 0
                      ? fmtHours(r.dailyDuration)
                      : "0 h"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* === 4. 底部水印 === */}
        <div
          style={{
            marginTop: 30,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 20px",
          }}
        >
          <div
            style={{
              fontSize: 26,
              fontWeight: 900,
              color: "rgba(255,255,255,0.3)",
              letterSpacing: 2,
            }}
          >
            @星嗨艺创 STAR HIGH DATA HUB
          </div>
          <div style={{ fontSize: 22, color: "rgba(255,255,255,0.2)" }}>
            * 数据内部保密 · 严禁外传
          </div>
        </div>
      </div>
    );
  }
);

PosterCard.displayName = "PosterCard";
