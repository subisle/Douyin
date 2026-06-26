import { toPng } from "html-to-image";

/**
 * 将 DOM 元素导出为 PNG 图片并触发下载。
 * @param node 要截图的 DOM 元素
 * @param filename 下载文件名（含 .png 后缀）
 * @param options 可选：覆盖 width/height/style 等 html-to-image 选项
 */
export async function exportElementAsImage(
  node: HTMLElement,
  filename: string,
  options?: {
    width?: number;
    height?: number;
    style?: Partial<CSSStyleDeclaration>;
  }
) {
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: "#f5f3ee",
    ...options,
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
