import type { TreeNode } from "./family-tree-page";
import { downloadCanvasAsPng } from "./export-image";
import {
  FAMILY_COL_GAP as COL_GAP,
  FAMILY_NODE_H as NODE_H,
  FAMILY_NODE_W as NODE_W,
  FAMILY_PAD as PAD,
  FAMILY_ROW_GAP as ROW_GAP,
  getFamilyDisplayName,
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

// 主题色 —— 与主仓库 DataTableStyle2Template 一致
const C = {
  cyan: "#00f5d4",
  blue: "#00b8ff",
  bg1: "#0a0f1c",
  bg2: "#020617",
  bg3: "#000000",
  panel: "rgba(10, 24, 37, 0.88)",
  panelBorder: "rgba(255, 255, 255, 0.08)",
  text: "#f8fafc",
  textMuted: "#94a3b8",
  textCyan: "#a5f3fc",
  white92: "rgba(255, 255, 255, 0.92)",
  white04: "rgba(255, 255, 255, 0.04)",
  pink: "#f472b6",
};

/** 将族谱导出为海报风格 PNG 并下载（#00b8ff 蓝色渐变主题） */
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

  // ---- 2. 海报尺寸 ----
  const posterSize = 1080; // 正方形海报，与主仓库 Style2 一致
  const headerH = 110;
  const footerH = 64;
  const treeOffsetX = (posterSize - treeW) / 2;
  const treeOffsetY = headerH + 16;

  // 如果族谱太高，动态扩展高度
  const neededH = headerH + treeH + footerH + 32;
  const posterW = posterSize;
  const posterH = Math.max(posterSize, neededH);

  // ---- 3. Canvas 初始化 ----
  const canvas = document.createElement("canvas");
  canvas.width = posterW * scale;
  canvas.height = posterH * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  // ---- 4. 背景：径向渐变 + 网格线 + 右上光效 ----
  // 主背景：radial-gradient(circle at 50% 18%, #0a0f1c 0%, #020617 62%, #000 100%)
  const bgGrad = ctx.createRadialGradient(
    posterW * 0.5, posterH * 0.18, 0,
    posterW * 0.5, posterH * 0.18, posterH * 0.85
  );
  bgGrad.addColorStop(0, C.bg1);
  bgGrad.addColorStop(0.62, C.bg2);
  bgGrad.addColorStop(1, C.bg3);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, posterW, posterH);

  // 右上角径向光效：radial-gradient(circle at top right, rgba(0,245,212,0.16), transparent 28%)
  const topRightGrad = ctx.createRadialGradient(
    posterW, 0, 0,
    posterW, 0, posterW * 0.4
  );
  topRightGrad.addColorStop(0, "rgba(0, 245, 212, 0.16)");
  topRightGrad.addColorStop(1, "transparent");
  ctx.fillStyle = topRightGrad;
  ctx.fillRect(0, 0, posterW, posterH);

  // 网格线：linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px) + 90deg
  ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
  ctx.lineWidth = 1;
  for (let gx = 0; gx < posterW; gx += 28) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, posterH);
    ctx.stroke();
  }
  for (let gy = 0; gy < posterH; gy += 28) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(posterW, gy);
    ctx.stroke();
  }

  // ---- 5. 外边框：渐变边框 ----
  const borderW = 6;
  // 外边框渐变：linear-gradient(90deg, #00f5d4, #00b8ff)
  const borderGrad = ctx.createLinearGradient(0, 0, posterW, 0);
  borderGrad.addColorStop(0, C.cyan);
  borderGrad.addColorStop(1, C.blue);
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = borderW;
  ctx.strokeRect(borderW / 2, borderW / 2, posterW - borderW, posterH - borderW);

  // 内边框 inset shadow
  ctx.strokeStyle = C.white04;
  ctx.lineWidth = 1;
  ctx.strokeRect(borderW + 1, borderW + 1, posterW - borderW * 2 - 2, posterH - borderW * 2 - 2);

  // ---- 6. 标题面板 ----
  const panelX = borderW + 18;
  const panelW = posterW - (borderW + 18) * 2;
  const panelY = borderW + 18;
  const panelH = 80;

  // 面板背景
  drawRoundRect(ctx, panelX, panelY, panelW, panelH, 24);
  ctx.fillStyle = C.panel;
  ctx.fill();
  drawRoundRect(ctx, panelX, panelY, panelW, panelH, 24);
  ctx.strokeStyle = C.panelBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 标题图标：圆角方块 "谱"
  const iconSize = 48;
  const iconX = panelX + 20;
  const iconY = panelY + (panelH - iconSize) / 2;
  drawRoundRect(ctx, iconX, iconY, iconSize, iconSize, 14);
  const iconGrad = ctx.createLinearGradient(iconX, iconY, iconX + iconSize, iconY + iconSize);
  iconGrad.addColorStop(0, "rgba(0, 245, 212, 0.18)");
  iconGrad.addColorStop(1, "rgba(0, 184, 255, 0.18)");
  ctx.fillStyle = iconGrad;
  ctx.fill();
  drawRoundRect(ctx, iconX, iconY, iconSize, iconSize, 14);
  ctx.strokeStyle = "rgba(0, 245, 212, 0.32)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = C.text;
  ctx.fillText("谱", iconX + iconSize / 2, iconY + iconSize / 2);

  // 标题文字
  const titleX = iconX + iconSize + 16;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // eyebrow 小标签
  ctx.font = "12px sans-serif";
  ctx.fillStyle = C.cyan;
  ctx.fillText("师徒传承 · 深色导出版", titleX, panelY + 14);

  // 主标题
  ctx.font = "bold 28px sans-serif";
  ctx.fillStyle = C.text;
  ctx.shadowColor = "rgba(0, 245, 212, 0.18)";
  ctx.shadowBlur = 24;
  ctx.fillText("族谱", titleX, panelY + 34);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  // 右侧日期卡片
  const dateCardW = 140;
  const dateCardH = 54;
  const dateCardX = panelX + panelW - dateCardW - 20;
  const dateCardY = panelY + (panelH - dateCardH) / 2;
  drawRoundRect(ctx, dateCardX, dateCardY, dateCardW, dateCardH, 16);
  ctx.fillStyle = "rgba(15, 37, 56, 0.82)";
  ctx.fill();
  drawRoundRect(ctx, dateCardX, dateCardY, dateCardW, dateCardH, 16);
  ctx.strokeStyle = "rgba(0, 245, 212, 0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "11px sans-serif";
  ctx.fillStyle = C.textMuted;
  ctx.fillText("人数", dateCardX + dateCardW / 2, dateCardY + 16);
  ctx.font = "bold 20px sans-serif";
  ctx.fillStyle = C.text;
  ctx.fillText(String(placed.length), dateCardX + dateCardW / 2, dateCardY + 38);

  // ---- 7. 绘制连接线 ----
  const lineGrad = ctx.createLinearGradient(0, 0, posterW, 0);
  lineGrad.addColorStop(0, "rgba(0, 245, 212, 0.45)");
  lineGrad.addColorStop(1, "rgba(0, 184, 255, 0.45)");
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 1.5;
  for (const e of edges) {
    const midX = e.px + COL_GAP / 2;
    ctx.beginPath();
    ctx.moveTo(treeOffsetX + e.px, treeOffsetY + e.py);
    ctx.lineTo(treeOffsetX + midX, treeOffsetY + e.py);
    ctx.lineTo(treeOffsetX + midX, treeOffsetY + e.cy);
    ctx.lineTo(treeOffsetX + e.cx, treeOffsetY + e.cy);
    ctx.stroke();
  }

  // ---- 8. 绘制节点 ----
  const rootSet = new Set(roots.map((r) => r.id));

  for (const p of placed) {
    const nx = treeOffsetX + p.x;
    const ny = treeOffsetY + p.y - NODE_H / 2;
    const isRoot = rootSet.has(p.node.id);
    const isFemale = p.node.gender === "female";

    // 节点背景
    drawRoundRect(ctx, nx, ny, NODE_W, NODE_H, 8);
    if (isRoot) {
      const nodeGrad = ctx.createLinearGradient(nx, ny, nx + NODE_W, ny);
      nodeGrad.addColorStop(0, "rgba(0, 245, 212, 0.15)");
      nodeGrad.addColorStop(1, "rgba(0, 184, 255, 0.10)");
      ctx.fillStyle = nodeGrad;
    } else if (isFemale) {
      ctx.fillStyle = "rgba(236, 72, 153, 0.08)";
    } else {
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    }
    ctx.fill();

    // 节点边框
    drawRoundRect(ctx, nx, ny, NODE_W, NODE_H, 8);
    if (isRoot) {
      ctx.strokeStyle = "rgba(0, 245, 212, 0.4)";
    } else if (isFemale) {
      ctx.strokeStyle = "rgba(236, 72, 153, 0.3)";
    } else {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    }
    ctx.lineWidth = 1;
    ctx.stroke();

    // 名字
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 15px sans-serif";
    if (isRoot) {
      ctx.fillStyle = C.cyan;
    } else if (isFemale) {
      ctx.fillStyle = C.pink;
    } else {
      ctx.fillStyle = C.white92;
    }

    const displayName = getFamilyDisplayName(p.node, isRoot);
    ctx.fillText(displayName, nx + NODE_W / 2, ny + 21);

    // 代数与徒弟数
    ctx.font = "10px sans-serif";
    ctx.fillStyle = isRoot ? "rgba(0, 245, 212, 0.72)" : C.textMuted;
    const relationText = p.node.children.length > 0 ? `${p.node.children.length}徒` : "成员";
    ctx.fillText(
      `${getFamilyGenerationText(p.node)} · ${relationText}`,
      nx + NODE_W / 2,
      ny + 40
    );
  }

  // ---- 9. 底部面板 ----
  const footerPanelY = posterH - borderW - 18 - 48;
  const footerPanelH = 48;
  drawRoundRect(ctx, panelX, footerPanelY, panelW, footerPanelH, 20);
  ctx.fillStyle = C.panel;
  ctx.fill();
  drawRoundRect(ctx, panelX, footerPanelY, panelW, footerPanelH, 20);
  ctx.strokeStyle = C.panelBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 底部圆点 + 标题
  const dotX = panelX + 20;
  const dotY = footerPanelY + footerPanelH / 2;
  const dotGrad = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, 5);
  dotGrad.addColorStop(0, C.cyan);
  dotGrad.addColorStop(1, C.blue);
  ctx.fillStyle = dotGrad;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
  ctx.fill();
  // 光晕
  ctx.shadowColor = "rgba(0, 245, 212, 0.48)";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = C.textCyan;
  ctx.fillText("族谱导出", dotX + 14, dotY);

  // 日期
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  ctx.textAlign = "right";
  ctx.font = "12px sans-serif";
  ctx.fillStyle = C.textMuted;
  ctx.fillText(`导出日期 ${dateStr}`, panelX + panelW - 20, dotY);

  // ---- 10. 导出下载 ----
  await downloadCanvasAsPng(canvas, filename);
}
