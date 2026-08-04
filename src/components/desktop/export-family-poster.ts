import type { TreeNode } from "./family-tree-page";
import { downloadCanvasAsPng } from "./export-image";
import {
  FAMILY_COL_GAP as COL_GAP,
  FAMILY_NODE_H as NODE_H,
  FAMILY_NODE_W as NODE_W,
  FAMILY_PAD as PAD,
  FAMILY_ROW_GAP as ROW_GAP,
  getFamilyDisplayName,
  getFamilyGenerationColor,
  getFamilyGenerationText,
} from "./family-tree-style";

interface Placed {
  node: TreeNode;
  x: number;
  y: number;
}
interface Edge {
  px: number;
  py: number;
  cx: number;
  cy: number;
}

/** 绘制圆角矩形路径 */
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// 样式二：Apple 浅色导出色彩
const C = {
  blue: "#007AFF",
  blueSoft: "#EAF3FF",
  blueBorder: "#D6E8FF",
  text: "#101828",
  textMuted: "#667085",
  border: "#EAECF0",
  rootBg: "#F0F7FF",
  rootBorder: "#84CAFF",
  maleBg: "#FFFFFF",
  femaleBg: "#FFF7FB",
  femaleBorder: "#F9C7DD",
  femaleText: "#C11574",
  shadow: "rgba(51, 65, 85, 0.08)",
};

function truncateCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let next = text;
  while (next.length > 1 && ctx.measureText(`${next}…`).width > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next}…`;
}

/** 将族谱导出为样式二浅色 PNG 并下载。 */
export async function exportFamilyPoster(
  roots: TreeNode[],
  filename = "族谱海报.png"
): Promise<void> {
  const scale = 2; // 高清倍率

  // ---- 1. 布局计算（与 family-tree-page.tsx layoutAll 一致） ----
  const placed: Placed[] = [];
  const edges: Edge[] = [];
  let cursorY = PAD;
  const visited = new Set<number>();

  const walk = (node: TreeNode, depth: number): number => {
    if (visited.has(node.id)) return cursorY;
    visited.add(node.id);
    const x = PAD + depth * (NODE_W + COL_GAP);
    let centerY: number;
    if (node.children.length === 0) {
      centerY = cursorY + NODE_H / 2;
      cursorY += NODE_H + ROW_GAP;
    } else {
      const cs = node.children.map((c) => walk(c, depth + 1));
      centerY = (cs[0] + cs[cs.length - 1]) / 2;
    }
    placed.push({ node, x, y: centerY });
    for (const c of node.children) {
      const cp = placed.find((p) => p.node === c);
      if (cp) edges.push({ px: x + NODE_W, py: centerY, cx: cp.x, cy: cp.y });
    }
    return centerY;
  };
  for (const root of roots) {
    walk(root, 0);
    cursorY += NODE_H;
  }
  const maxX = Math.max(...placed.map((p) => p.x + NODE_W));
  const maxY = Math.max(...placed.map((p) => p.y + NODE_H / 2));
  const treeW = maxX + PAD;
  const treeH = maxY + PAD;

  // ---- 2. 画布尺寸：只保留族谱图本身，避免标题/统计/底部留白 ----
  const outerPad = 44;
  const posterW = Math.max(720, Math.ceil(treeW + outerPad * 2));
  const posterH = Math.max(480, Math.ceil(treeH + outerPad * 2));
  const treeOffsetX = Math.round((posterW - treeW) / 2);
  const treeOffsetY = Math.round((posterH - treeH) / 2);

  // ---- 3. Canvas 初始化 ----
  const canvas = document.createElement("canvas");
  canvas.width = posterW * scale;
  canvas.height = posterH * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  // ---- 4. 背景：样式二浅色底，不放标题/统计/页脚 ----
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, posterW, posterH);

  const bgGlow = ctx.createRadialGradient(
    posterW * 0.5,
    posterH * 0.06,
    0,
    posterW * 0.5,
    posterH * 0.06,
    Math.max(posterW, posterH) * 0.75
  );
  bgGlow.addColorStop(0, "rgba(234, 243, 255, 0.88)");
  bgGlow.addColorStop(0.58, "rgba(255, 255, 255, 0.92)");
  bgGlow.addColorStop(1, "#FFFFFF");
  ctx.fillStyle = bgGlow;
  ctx.fillRect(0, 0, posterW, posterH);

  ctx.strokeStyle = "rgba(234, 236, 240, 0.55)";
  ctx.lineWidth = 1;
  for (let gx = 0; gx < posterW; gx += 32) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, posterH);
    ctx.stroke();
  }
  for (let gy = 0; gy < posterH; gy += 32) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(posterW, gy);
    ctx.stroke();
  }

  // ---- 5. 绘制连接线 ----
  ctx.strokeStyle = "#98A2B3";
  ctx.lineWidth = 1.35;
  for (const e of edges) {
    const midX = e.px + COL_GAP / 2;
    ctx.beginPath();
    ctx.moveTo(treeOffsetX + e.px, treeOffsetY + e.py);
    ctx.lineTo(treeOffsetX + midX, treeOffsetY + e.py);
    ctx.lineTo(treeOffsetX + midX, treeOffsetY + e.cy);
    ctx.lineTo(treeOffsetX + e.cx, treeOffsetY + e.cy);
    ctx.stroke();
  }

  // ---- 6. 绘制节点 ----
  const rootSet = new Set(roots.map((r) => r.id));

  for (const p of placed) {
    const nx = treeOffsetX + p.x;
    const ny = treeOffsetY + p.y - NODE_H / 2;
    const isRoot = rootSet.has(p.node.id);
    const isFemale = p.node.gender === "female";
    const generationColor = getFamilyGenerationColor(p.node);
    const hasColoredGeneration = p.node.generation === 1 || p.node.generation === 2 || p.node.generation === 3;

    // 节点背景
    drawRoundRect(ctx, nx, ny, NODE_W, NODE_H, 8);
    if (hasColoredGeneration) {
      ctx.fillStyle = generationColor.nodeBg;
    } else if (isRoot) {
      ctx.fillStyle = C.rootBg;
    } else if (isFemale) {
      ctx.fillStyle = C.femaleBg;
    } else {
      ctx.fillStyle = C.maleBg;
    }
    ctx.shadowColor = C.shadow;
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // 节点边框
    drawRoundRect(ctx, nx, ny, NODE_W, NODE_H, 8);
    if (hasColoredGeneration) {
      ctx.strokeStyle = generationColor.nodeBorder;
    } else if (isRoot) {
      ctx.strokeStyle = C.rootBorder;
    } else if (isFemale) {
      ctx.strokeStyle = C.femaleBorder;
    } else {
      ctx.strokeStyle = C.border;
    }
    ctx.lineWidth = 1;
    ctx.stroke();

    // 代级色条
    drawRoundRect(ctx, nx, ny, 3, NODE_H, 1.5);
    ctx.fillStyle = hasColoredGeneration
      ? generationColor.bar
      : isRoot
        ? C.blue
        : isFemale
          ? "#F472B6"
          : "#38BDF8";
    ctx.fill();

    // 名字
    ctx.textBaseline = "middle";
    ctx.font = "bold 13px sans-serif";
    if (isRoot) {
      ctx.fillStyle = C.blue;
    } else if (isFemale) {
      ctx.fillStyle = C.femaleText;
    } else {
      ctx.fillStyle = C.text;
    }

    const displayName = getFamilyDisplayName(p.node, isRoot);
    const nameMaxW = NODE_W - 16;
    ctx.textAlign = "left";
    ctx.fillText(
      truncateCanvasText(ctx, displayName, nameMaxW),
      nx + 9,
      ny + 17
    );

    // 代数：0 代不显示文字，1/2/3 代用不同颜色。
    const generationText = getFamilyGenerationText(p.node);
    if (generationText) {
      const chipX = nx + 9;
      const chipY = ny + 29;
      const chipW = Math.min(38, Math.ceil(ctx.measureText(generationText).width) + 12);
      const chipH = 13;
      drawRoundRect(ctx, chipX, chipY, chipW, chipH, 6.5);
      ctx.fillStyle = generationColor.chipBg;
      ctx.fill();
      ctx.strokeStyle = generationColor.chipBorder;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = "9px sans-serif";
      ctx.fillStyle = generationColor.text;
      ctx.textAlign = "center";
      ctx.fillText(generationText, chipX + chipW / 2, chipY + chipH / 2 + 0.5);
    }

    if (p.node.children.length > 0) {
      ctx.font = "9px sans-serif";
      ctx.fillStyle = C.textMuted;
      ctx.textAlign = "right";
      ctx.fillText(`${p.node.children.length}徒`, nx + NODE_W - 9, ny + 34);
    }
  }

  // ---- 7. 导出下载 ----
  await downloadCanvasAsPng(canvas, filename);
}
