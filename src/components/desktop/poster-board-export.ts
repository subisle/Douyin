import type { DailyReportRow } from "@/types/electron";
import { exportElementAsImage } from "./export-image";
import type { PosterBoardTemplate } from "./poster-board-layout";

/**
 * 姓名位统一对齐 PSD 导出 SVG/CSS：
 *   font-family: "Alibaba PuHuiTi 3.0"
 *   font-size: 23.978px
 *   transform: matrix(1.25116804979353, 0, 0, 1.25116804979353, ...)
 *   fill/color: #FFFFFF
 */
export const POSTER_BOARD_TOP_FONT_FAMILY = "PosterPuHuiTi105Heavy";
export const POSTER_BOARD_NAME_FONT_FAMILY = "PosterPuHuiTi105Heavy";
export const POSTER_BOARD_FONT_FAMILY = POSTER_BOARD_NAME_FONT_FAMILY;
export const POSTER_BOARD_FONT_WEIGHT = "400";
export const POSTER_BOARD_TOP_FONT_WEIGHT = "400";
export const POSTER_BOARD_NAME_FONT_WEIGHT = "400";

export const POSTER_NAME_SVG_FONT_SIZE = 23.978;
export const POSTER_NAME_SVG_MATRIX_SCALE = 1.25116804979353;
export const POSTER_NAME_EFFECTIVE_FONT_SIZE =
  POSTER_NAME_SVG_FONT_SIZE * POSTER_NAME_SVG_MATRIX_SCALE;
export const POSTER_NAME_FILL = "#FFFFFF";

/**
 * 前三名 CSS：
 *   font-size: 17px
 *   font-family: "Alibaba PuHuiTi 3.0"
 *   color: #fff
 *   text-align: left
 *   transform: matrix(s,0,0,s,0,0)
 */
export const POSTER_TOP_SVG_FONT_SIZE = 17;
export const POSTER_TOP_MATRIX_SCALE: Record<number, number> = {
  1: 1.7601804382242288,
  2: 1.51304988549073,
  3: 1.51304988549073,
};

export function posterTopEffectiveFontSize(rank: number): number {
  const s = POSTER_TOP_MATRIX_SCALE[rank] ?? POSTER_TOP_MATRIX_SCALE[2];
  return POSTER_TOP_SVG_FONT_SIZE * s;
}

let posterFontReady: Promise<string> | null = null;

function fontUrl(file: string): string {
  const isFile = typeof window !== "undefined" && window.location.protocol === "file:";
  return isFile ? `./fonts/${file}` : `/fonts/${file}`;
}

async function loadPosterFontFace(family: string, file: string): Promise<boolean> {
  const fonts = document.fonts;
  if (!fonts) return false;

  const probe = `400 32px "${family}"`;
  try {
    if (fonts.check(probe)) return true;
  } catch {
    // ignore
  }

  const url = fontUrl(file);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const face = new FontFace(family, buf, {
      weight: "400",
      style: "normal",
      display: "block",
    });
    const loaded = await face.load();
    fonts.add(loaded);
    await fonts.load(probe);
    if (fonts.check(probe)) return true;
  } catch (err) {
    console.warn(`海报字体 arrayBuffer 加载失败: ${family}`, err);
  }

  try {
    const face = new FontFace(family, `url("${url}") format("truetype")`, {
      weight: "400",
      style: "normal",
      display: "block",
    });
    const loaded = await face.load();
    fonts.add(loaded);
    await fonts.load(probe);
    return fonts.check(probe);
  } catch (err) {
    console.warn(`海报字体 url 加载失败: ${family}`, err);
    return false;
  }
}

/** 强制加载 PSD 原字体 AlibabaPuHuiTi_3_105_Heavy */
export async function ensurePosterBoardFont(): Promise<string> {
  if (typeof document === "undefined") return POSTER_BOARD_FONT_FAMILY;

  if (!posterFontReady) {
    posterFontReady = (async () => {
      const ok = await loadPosterFontFace(
        POSTER_BOARD_FONT_FAMILY,
        "AlibabaPuHuiTi-3-105-Heavy.ttf"
      );
      try {
        await document.fonts?.ready;
      } catch {
        // ignore
      }
      if (!ok) {
        posterFontReady = null;
        console.warn("[poster-font] 未就绪");
      } else {
        console.info("[poster-font] ready (DOM)", POSTER_BOARD_FONT_FAMILY);
      }
      return POSTER_BOARD_FONT_FAMILY;
    })();
  }

  try {
    return await posterFontReady;
  } catch (err) {
    posterFontReady = null;
    console.warn("海报字体加载异常", err);
    return POSTER_BOARD_FONT_FAMILY;
  }
}

export type PosterBoardDrawOptions = {
  scale?: number;
  avatarsByRank?: Record<number, string | undefined>;
};

/**
 * DOM 导出：对 HTML/CSS 舞台截图（html-to-image），不再用 canvas 填字。
 * pixelRatio 默认 2，等价于以前 canvas scale=2。
 */
export async function exportPosterBoardFromStage(
  stage: HTMLElement,
  filename: string,
  options?: { pixelRatio?: number }
): Promise<void> {
  await ensurePosterBoardFont();
  await exportElementAsImage(stage, filename, {
    pixelRatio: options?.pixelRatio ?? 2,
    backgroundColor: "#000000",
    width: stage.offsetWidth || undefined,
    height: stage.offsetHeight || undefined,
  });
}

/** @deprecated 兼容旧调用名；请传入舞台 DOM */
export async function exportPosterBoardDirect(
  _template: PosterBoardTemplate,
  _rows: DailyReportRow[],
  filename: string,
  options?: PosterBoardDrawOptions & { stage?: HTMLElement | null }
): Promise<void> {
  const stage = options?.stage;
  if (!stage) {
    throw new Error("请传入 HTML 海报舞台节点（已改为 DOM 导出，不再使用 canvas 画字）");
  }
  await exportPosterBoardFromStage(stage, filename, { pixelRatio: options?.scale ?? 2 });
}
