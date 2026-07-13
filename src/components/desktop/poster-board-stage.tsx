"use client";

import { useEffect, type Ref } from "react";
import type { DailyReportRow } from "@/types/electron";
import type { PosterBoardTemplate } from "./poster-board-layout";
import {
  POSTER_BOARD_NAME_FONT_FAMILY,
  POSTER_BOARD_TOP_FONT_FAMILY,
  ensurePosterBoardFont,
} from "./poster-board-export";

function resolveAssetUrl(src: string): string {
  if (!src) return src;
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  const clean = src.replace(/^\.\//, "").replace(/^\//, "");
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    return `./${clean}`;
  }
  return `/${clean}`;
}

function displayName(kind: "top" | "name", rank: number, name: string): string {
  const clean = name.trim();
  if (!clean) return "";
  if (kind === "top") return `Top${rank}:${clean}`;
  return clean;
}

export type PosterBoardStageProps = {
  template: PosterBoardTemplate;
  rows: DailyReportRow[];
  avatarsByRank?: Record<number, string | undefined>;
  /** 预览缩放，仅影响外层显示，不影响导出节点真实尺寸 */
  previewScale?: number;
  stageRef?: Ref<HTMLDivElement>;
  className?: string;
};

/**
 * DOM 海报舞台：底板 + 透明头像 + SVG 文本。
 * 文本直接使用 PSD transform（tx/ty 是基线原点，sx/sy 是缩放），
 * 避免 HTML 盒模型 top/left 与 PS 基线坐标系不一致导致上下错位。
 */
export function PosterBoardStage({
  template,
  rows,
  avatarsByRank = {},
  previewScale = 1,
  stageRef,
  className,
}: PosterBoardStageProps) {
  useEffect(() => {
    void ensurePosterBoardFont();
  }, []);

  const nameByRank = new Map<number, string>();
  for (const row of rows) {
    if (row.rank >= template.rankStart && row.rank <= template.rankEnd) {
      nameByRank.set(row.rank, row.name || "");
    }
  }

  const plateUrl = resolveAssetUrl(template.image);

  return (
    <div
      className={className}
      style={{
        width: template.width * previewScale,
        height: template.height * previewScale,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        ref={stageRef}
        data-poster-stage={template.id}
        data-poster-export={previewScale === 1 ? "1" : "0"}
        style={{
          width: template.width,
          height: template.height,
          position: "relative",
          overflow: "hidden",
          background: "#000",
          transform: previewScale === 1 ? undefined : `scale(${previewScale})`,
          transformOrigin: "top left",
        }}
      >
        {/* 底板 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={plateUrl}
          alt={template.label}
          width={template.width}
          height={template.height}
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: template.width,
            height: template.height,
            objectFit: "fill",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />

        {/* Top 头像：透明 PNG */}
        {(template.avatarSlots || []).map((slot) => {
          const src = avatarsByRank[slot.rank];
          if (!src) return null;
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`avatar-${slot.rank}`}
              src={src}
              alt={`Top${slot.rank}`}
              draggable={false}
              style={{
                position: "absolute",
                left: slot.x,
                top: slot.y,
                width: slot.w,
                height: slot.h,
                objectFit: "cover",
                borderRadius: Math.min(18, slot.w * 0.08, slot.h * 0.08),
                zIndex: 5,
                pointerEvents: "none",
                userSelect: "none",
              }}
            />
          );
        })}

        {/* 文字层：整页 SVG，transform 与 PSD 一致 */}
        <svg
          width={template.width}
          height={template.height}
          viewBox={`0 0 ${template.width} ${template.height}`}
          style={{
            position: "absolute",
            inset: 0,
            width: template.width,
            height: template.height,
            overflow: "visible",
            zIndex: 12,
            pointerEvents: "none",
          }}
        >
          {template.slots.map((slot) => {
            const text = displayName(slot.kind, slot.rank, nameByRank.get(slot.rank) || "");
            if (!text) return null;
            const family =
              slot.kind === "top" ? POSTER_BOARD_TOP_FONT_FAMILY : POSTER_BOARD_NAME_FONT_FAMILY;
            // PSD: matrix(sx, 0, 0, sy, tx, ty) 作用在基线坐标系
            const transform = `matrix(${slot.sx} 0 0 ${slot.sy} ${slot.tx} ${slot.ty})`;
            return (
              <text
                key={`${slot.kind}-${slot.rank}`}
                transform={transform}
                fontSize={slot.baseFontSize}
                fontFamily={`"${family}", "Alibaba PuHuiTi 3.0", "PingFang SC", sans-serif`}
                fontWeight={400}
                fill="#FFFFFF"
                style={{
                  whiteSpace: "pre",
                  userSelect: "none",
                }}
              >
                {text}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
