"use client";

import { useLayoutEffect, useRef, useState } from "react";

export interface DataTableStyle2Row {
  rank: number;
  name: string;
  waveText: string;
  waveRatio: number;
  totalWaveText: string;
  grade: string;
  durationText: string;
}

interface DataTableStyle2TemplateProps {
  title: string;
  formattedDate: string;
  genderText: string;
  totalCount: number;
  inactiveCount: number;
  totalDailyWaveText: string;
  totalWaveText: string;
  inactiveNames: string[];
  rows: DataTableStyle2Row[];
  /** 导出模式：禁用自适应缩放，固定 1080px 原始尺寸渲染 */
  exportMode?: boolean;
}

const STYLE_TEXT = `
.dt-style2-root {
    position: relative;
    width: 1080px;
    height: 1080px;
    overflow: hidden;
    font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #f8fafc;
    background: radial-gradient(circle at 50% 18%, #0a0f1c 0%, #020617 62%, #000000 100%);
}

.dt-style2-root *,
.dt-style2-root *::before,
.dt-style2-root *::after {
    box-sizing: border-box;
}

.dt-style2-root::before,
.dt-style2-root::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
}

.dt-style2-root::before {
    background:
        linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
    background-size: 28px 28px;
    opacity: 0.35;
}

.dt-style2-root::after {
    background: radial-gradient(circle at top right, rgba(0, 245, 212, 0.16), transparent 28%);
}

.dt-style2-poster {
    position: absolute;
    inset: 0;
    padding: 18px;
    background:
        linear-gradient(#020617, #020617) padding-box,
        linear-gradient(90deg, #00f5d4, #00b8ff) border-box;
    border: 6px solid transparent;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.dt-style2-poster-inner {
    position: absolute;
    inset: 18px;
    overflow: hidden;
}

.dt-style2-poster-content {
    width: 100%;
    transform-origin: top left;
}

.dt-style2-header-panel,
.dt-style2-stats-grid,
.dt-style2-board,
.dt-style2-footer-panel {
    width: 100%;
}

.dt-style2-header-panel {
    display: grid;
    grid-template-columns: 1fr 250px;
    gap: 16px;
    padding: 22px 24px;
    background: rgba(10, 24, 37, 0.88);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 24px;
    box-shadow: 0 22px 44px rgba(0, 0, 0, 0.32);
}

.dt-style2-title-group {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
}

.dt-style2-title-icon {
    width: 68px;
    height: 68px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    font-weight: 800;
    color: #ffffff;
    background: linear-gradient(135deg, rgba(0, 245, 212, 0.18), rgba(0, 184, 255, 0.18));
    border: 1px solid rgba(0, 245, 212, 0.32);
    box-shadow: 0 0 26px rgba(0, 245, 212, 0.16);
    flex-shrink: 0;
}

.dt-style2-title-copy {
    min-width: 0;
}

.dt-style2-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    font-size: 12px;
    letter-spacing: 1px;
    color: #00f5d4;
    background: rgba(0, 245, 212, 0.08);
    border: 1px solid rgba(0, 245, 212, 0.18);
}

.dt-style2-eyebrow::before {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: linear-gradient(135deg, #00f5d4, #00b8ff);
    box-shadow: 0 0 10px rgba(0, 245, 212, 0.6);
}

.dt-style2-title {
    margin: 0;
    font-size: 32px;
    line-height: 1.15;
    letter-spacing: 1px;
    color: #ffffff;
    text-shadow: 0 0 24px rgba(0, 245, 212, 0.18);
    white-space: nowrap;
}

.dt-style2-header-note {
    margin-top: 10px;
    font-size: 14px;
    color: #94a3b8;
    line-height: 1.5;
}

.dt-style2-date-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
    padding: 18px 20px;
    border-radius: 20px;
    background: rgba(15, 37, 56, 0.82);
    border: 1px solid rgba(0, 245, 212, 0.16);
    text-align: center;
}

.dt-style2-date-label {
    font-size: 12px;
    letter-spacing: 1px;
    color: #94a3b8;
}

.dt-style2-date {
    font-size: 24px;
    font-weight: 700;
    color: #ffffff;
    line-height: 1.2;
}

.dt-style2-deadline {
    font-size: 13px;
    color: #00f5d4;
}

.dt-style2-stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-top: 14px;
}

.dt-style2-stat-card {
    padding: 16px 18px;
    border-radius: 20px;
    background: rgba(10, 24, 37, 0.88);
    border: 1px solid rgba(255, 255, 255, 0.08);
}

.dt-style2-stat-label {
    font-size: 12px;
    color: #94a3b8;
    margin-bottom: 8px;
}

.dt-style2-stat-value {
    font-size: 28px;
    line-height: 1;
    font-weight: 700;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

.dt-style2-stat-gold {
    color: #ffffff;
    text-shadow: 0 0 18px rgba(0, 245, 212, 0.16);
}

.dt-style2-stat-danger {
    color: #f87171;
}

.dt-style2-board {
    margin-top: 14px;
    background: rgba(10, 24, 37, 0.88);
    border-radius: 24px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
    box-shadow: 0 18px 36px rgba(0, 0, 0, 0.22);
}

.dt-style2-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
}

.dt-style2-table-head {
    background: rgba(10, 24, 37, 0.95);
}

.dt-style2-table-head th {
    padding: 11px 8px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: #a5f3fc;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.dt-style2-table-head th:first-child,
.dt-style2-table-body td:first-child {
    padding-left: 14px;
}

.dt-style2-table-head th:last-child,
.dt-style2-table-body td:last-child {
    padding-right: 14px;
}

.dt-style2-table-row {
    background: transparent;
}

.dt-style2-table-row:nth-child(even) {
    background: rgba(255, 255, 255, 0.015);
}

.dt-style2-table-row.dt-style2-top1 {
    background: linear-gradient(90deg, rgba(0, 245, 212, 0.12), rgba(0, 184, 255, 0.03));
}

.dt-style2-table-row.dt-style2-top2 {
    background: linear-gradient(90deg, rgba(0, 245, 212, 0.09), rgba(255, 255, 255, 0.02));
}

.dt-style2-table-row.dt-style2-top3 {
    background: linear-gradient(90deg, rgba(0, 184, 255, 0.09), rgba(255, 255, 255, 0.02));
}

.dt-style2-table-body td {
    padding: 5px 8px;
    font-size: 12.5px;
    line-height: 1.2;
    vertical-align: middle;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.92);
}

.dt-style2-table-body tr:last-child td {
    border-bottom: none;
}

.dt-style2-rank-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 10px;
    font-size: 16px;
    font-weight: 700;
}

.dt-style2-rank-icon.dt-style2-icon-medal {
    background: linear-gradient(135deg, rgba(0, 245, 212, 0.2), rgba(0, 184, 255, 0.18));
    border: 1px solid rgba(0, 245, 212, 0.22);
}

.dt-style2-rank-icon.dt-style2-icon-normal {
    background: rgba(148, 163, 184, 0.14);
    border: 1px solid rgba(148, 163, 184, 0.18);
    color: rgba(255, 255, 255, 0.72);
    font-size: 12px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

.dt-style2-name-cell {
    font-size: 13px;
    color: #a5f3fc;
    font-weight: 600;
}

.dt-style2-name-cell.dt-style2-name-top {
    color: #ffffff;
}

.dt-style2-wave-text,
.dt-style2-total-wave {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.dt-style2-wave-text {
    font-size: 12px;
    color: #ffffff;
}

.dt-style2-total-wave {
    font-size: 12.5px;
    color: rgba(255, 255, 255, 0.95);
}

.dt-style2-daily-progress {
    width: 100%;
    max-width: 138px;
    height: 4px;
    margin-top: 4px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    overflow: hidden;
}

.dt-style2-daily-bar {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #00f5d4, #00b8ff);
    box-shadow: 0 0 12px rgba(0, 245, 212, 0.26);
}

.dt-style2-level-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 54px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    color: #04111f;
    box-shadow: 0 0 14px rgba(0, 0, 0, 0.15);
}
.dt-style2-level-badge.tier-a {
    background: linear-gradient(90deg, #34d399, #10b981);
    box-shadow: 0 0 14px rgba(52, 211, 153, 0.35);
}
.dt-style2-level-badge.tier-b {
    background: linear-gradient(90deg, #38bdf8, #3b82f6);
    box-shadow: 0 0 14px rgba(56, 189, 248, 0.35);
}
.dt-style2-level-badge.tier-c {
    background: linear-gradient(90deg, #fbbf24, #f59e0b);
    box-shadow: 0 0 14px rgba(251, 191, 36, 0.35);
}
.dt-style2-level-badge.tier-d {
    background: linear-gradient(90deg, #f43f5e, #ec4899);
    box-shadow: 0 0 14px rgba(244, 63, 94, 0.35);
}

.dt-style2-duration-text {
    color: #c4b5fd;
    font-size: 12px;
    text-align: center;
    white-space: nowrap;
}

.dt-style2-footer-panel {
    margin-top: 14px;
    padding: 16px 18px;
    border-radius: 22px;
    background: rgba(10, 24, 37, 0.88);
    border: 1px solid rgba(255, 255, 255, 0.08);
}

.dt-style2-footer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
}

.dt-style2-footer-title {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: #a5f3fc;
    font-weight: 700;
}

.dt-style2-footer-title::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: linear-gradient(135deg, #00f5d4, #00b8ff);
    box-shadow: 0 0 12px rgba(0, 245, 212, 0.48);
}

.dt-style2-footer-meta {
    font-size: 12px;
    color: #94a3b8;
}

.dt-style2-name-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.dt-style2-name-chip {
    padding: 5px 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 12px;
    color: rgba(255, 255, 255, 0.84);
}
`;

export function DataTableStyle2Template({
  title,
  formattedDate,
  genderText,
  totalCount,
  inactiveCount,
  totalDailyWaveText,
  totalWaveText,
  inactiveNames,
  rows,
  exportMode = false,
}: DataTableStyle2TemplateProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentScale, setContentScale] = useState(1);

  useLayoutEffect(() => {
    if (exportMode) {
      setContentScale(1);
      return;
    }
    const fitPoster = () => {
      if (!innerRef.current || !contentRef.current) return;

      const content = contentRef.current;
      content.style.transform = "scale(1)";
      content.style.width = "100%";

      const widthScale = innerRef.current.clientWidth / content.scrollWidth;
      const heightScale = innerRef.current.clientHeight / content.scrollHeight;
      const nextScale = Math.min(1, widthScale, heightScale);

      setContentScale(nextScale);
    };

    fitPoster();
    window.addEventListener("resize", fitPoster);
    return () => window.removeEventListener("resize", fitPoster);
  }, [formattedDate, inactiveCount, inactiveNames, rows, title, totalCount, totalDailyWaveText, totalWaveText, exportMode]);

  return (
    <div className="dt-style2-root">
      <style>{STYLE_TEXT}</style>

      <div className="dt-style2-poster">
        <div className="dt-style2-poster-inner" ref={innerRef}>
          <div
            className="dt-style2-poster-content"
            ref={contentRef}
            style={exportMode ? undefined : {
              transform: `scale(${contentScale})`,
              width: `${100 / contentScale}%`,
            }}
          >
            <div className="dt-style2-header-panel">
              <div className="dt-style2-title-group">
                <div className="dt-style2-title-icon">榜</div>
                <div className="dt-style2-title-copy">
                  <div className="dt-style2-eyebrow">每日音浪排行 · 深色导出版</div>
                  <h1 className="dt-style2-title">{title}</h1>
                  <div className="dt-style2-header-note">榜单已整理为正方形海报版式，适合直接截图或导出。</div>
                </div>
              </div>
              <div className="dt-style2-date-card">
                <div className="dt-style2-date-label">统计日期</div>
                <div className="dt-style2-date">{formattedDate}</div>
                <div className="dt-style2-deadline">截止到晚上12点</div>
              </div>
            </div>

            <div className="dt-style2-stats-grid">
              <div className="dt-style2-stat-card">
                <div className="dt-style2-stat-label">总上榜</div>
                <div className="dt-style2-stat-value dt-style2-stat-gold">{totalCount}</div>
              </div>
              <div className="dt-style2-stat-card">
                <div className="dt-style2-stat-label">未开播</div>
                <div className="dt-style2-stat-value dt-style2-stat-danger">{inactiveCount}</div>
              </div>
              <div className="dt-style2-stat-card">
                <div className="dt-style2-stat-label">总每日音浪</div>
                <div className="dt-style2-stat-value dt-style2-stat-gold">{totalDailyWaveText}</div>
              </div>
              <div className="dt-style2-stat-card">
                <div className="dt-style2-stat-label">总音浪</div>
                <div className="dt-style2-stat-value dt-style2-stat-gold">{totalWaveText}</div>
              </div>
            </div>

            <div className="dt-style2-board">
              <table className="dt-style2-table">
                <thead className="dt-style2-table-head">
                  <tr>
                    <th style={{ width: "8%" }}>名次</th>
                    <th style={{ width: "18%" }}>主播姓名</th>
                    <th style={{ width: "24%" }}>每日音浪</th>
                    <th style={{ width: "21%" }}>总音浪</th>
                    <th style={{ width: "12%" }}>等级</th>
                    <th style={{ width: "17%" }}>直播时长</th>
                  </tr>
                </thead>
                <tbody className="dt-style2-table-body">
                  {rows.map((row) => {
                    const topClass =
                      row.rank === 1 ? "dt-style2-top1" :
                      row.rank === 2 ? "dt-style2-top2" :
                      row.rank === 3 ? "dt-style2-top3" :
                      "";

                    const rankDisplay =
                      row.rank === 1 ? "🏆" :
                      row.rank === 2 ? "🥈" :
                      row.rank === 3 ? "🥉" :
                      String(row.rank).padStart(2, "0");

                    return (
                      <tr key={`${row.rank}-${row.name}`} className={`dt-style2-table-row ${topClass}`}>
                        <td>
                          <span className={`dt-style2-rank-icon ${row.rank <= 3 ? "dt-style2-icon-medal" : "dt-style2-icon-normal"}`}>
                            {rankDisplay}
                          </span>
                        </td>
                        <td className={`dt-style2-name-cell ${row.rank <= 3 ? "dt-style2-name-top" : ""}`}>{row.name}</td>
                        <td>
                          <div className="dt-style2-wave-text">{row.waveText}</div>
                          <div className="dt-style2-daily-progress">
                            <div className="dt-style2-daily-bar" style={{ width: `${Math.max(0, Math.min(100, row.waveRatio * 100))}%` }} />
                          </div>
                        </td>
                        <td><div className="dt-style2-total-wave">{row.totalWaveText}</div></td>
                        <td><span className={`dt-style2-level-badge tier-${(row.grade.charAt(0) || 'd').toLowerCase()}`}>{row.grade}</span></td>
                        <td className="dt-style2-duration-text">{row.durationText}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="dt-style2-footer-panel">
              <div className="dt-style2-footer-head">
                <div className="dt-style2-footer-title">未开播名单</div>
                <div className="dt-style2-footer-meta">{genderText}主播 · 共 {inactiveCount} 人</div>
              </div>
              <div className="dt-style2-name-chips">
                {(inactiveNames.length > 0 ? inactiveNames : ["暂无"]).map((name) => (
                  <span key={name} className="dt-style2-name-chip">{name}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DataTableStyle2Template;
