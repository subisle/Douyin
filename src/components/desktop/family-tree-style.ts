export const FAMILY_NODE_W = 112;
export const FAMILY_NODE_H = 48;
export const FAMILY_COL_GAP = 34;
export const FAMILY_ROW_GAP = 7;
export const FAMILY_PAD = 18;
export const FAMILY_TREE_PS = "PS：未开播不显示徒弟姓名，开播没显示的联系鹏仔第二帅：帅帅";

const ROOT_PLACEHOLDER_NAME_RE = /^([\u4e00-\u9fa5A-Za-z])[0０]$/;

export const FAMILY_GENERATION_COLORS = {
  1: {
    bar: "#007AFF",
    chipBg: "rgba(0, 122, 255, 0.12)",
    chipBorder: "rgba(0, 122, 255, 0.24)",
    text: "#175CD3",
    nodeBg: "#F0F7FF",
    nodeBorder: "#84CAFF",
  },
  2: {
    bar: "#34C759",
    chipBg: "rgba(52, 199, 89, 0.12)",
    chipBorder: "rgba(52, 199, 89, 0.24)",
    text: "#067647",
    nodeBg: "#F0FDF4",
    nodeBorder: "#86EFAC",
  },
  3: {
    bar: "#FF9500",
    chipBg: "rgba(255, 149, 0, 0.14)",
    chipBorder: "rgba(255, 149, 0, 0.25)",
    text: "#B54708",
    nodeBg: "#FFF7ED",
    nodeBorder: "#FDBA74",
  },
} as const;

export const FAMILY_DEFAULT_GENERATION_COLOR = {
  bar: "#8E8E93",
  chipBg: "rgba(142, 142, 147, 0.12)",
  chipBorder: "rgba(142, 142, 147, 0.22)",
  text: "#667085",
  nodeBg: "#FFFFFF",
  nodeBorder: "#EAECF0",
};

export function getFamilyDisplayName(node: { name: string; generation: number | null }, isRoot: boolean) {
  const raw = node.name.trim();
  if (!raw) return "未命名";

  const placeholder = raw.match(ROOT_PLACEHOLDER_NAME_RE);
  if (isRoot && node.generation === 0 && placeholder) {
    return `${placeholder[1]}字辈`;
  }

  return raw;
}

export function getFamilyGenerationText(node: { generation: number | null }) {
  if (node.generation == null) return "未定代";
  if (node.generation === 0) return "";
  return `第${node.generation}代`;
}

export function getFamilyGenerationColor(node: { generation: number | null }) {
  if (node.generation === 1) return FAMILY_GENERATION_COLORS[1];
  if (node.generation === 2) return FAMILY_GENERATION_COLORS[2];
  if (node.generation === 3) return FAMILY_GENERATION_COLORS[3];
  return FAMILY_DEFAULT_GENERATION_COLOR;
}
