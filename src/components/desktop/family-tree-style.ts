export const FAMILY_NODE_W = 128;
export const FAMILY_NODE_H = 58;
export const FAMILY_COL_GAP = 44;
export const FAMILY_ROW_GAP = 10;
export const FAMILY_PAD = 24;

const ROOT_PLACEHOLDER_NAME_RE = /^([\u4e00-\u9fa5A-Za-z])[0０]$/;

export function getFamilyDisplayName(node: { name: string; generation: number | null }, isRoot: boolean) {
  const raw = node.name.trim();
  if (!raw) return "未命名";

  const placeholder = raw.match(ROOT_PLACEHOLDER_NAME_RE);
  if (isRoot && node.generation === 0 && placeholder) {
    return `${placeholder[1]}系`;
  }

  return raw;
}

export function getFamilyGenerationText(node: { generation: number | null }) {
  if (node.generation == null) return "未定代";
  if (node.generation === 0) return "源头";
  return `第${node.generation}代`;
}
