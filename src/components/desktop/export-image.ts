import { toPng } from "html-to-image";

/**
 * 将 DOM 元素导出为 PNG 图片并触发下载。
 * @param node 要截图的 DOM 元素
 * @param filename 下载文件名（含 .png 后缀）
 * @param options 可选：覆盖 width/height/style/pixelRatio/backgroundColor 等 html-to-image 选项
 */
export async function exportElementAsImage(
  node: HTMLElement,
  filename: string,
  options?: {
    width?: number;
    height?: number;
    pixelRatio?: number;
    style?: Partial<CSSStyleDeclaration>;
    backgroundColor?: string;
  }
) {
  const { pixelRatio, backgroundColor, ...rest } = options ?? {};
  const dataUrl = await toPng(node, {
    pixelRatio: pixelRatio ?? 2,
    backgroundColor: backgroundColor ?? "#f5f3ee",
    // 跳过字体加载——跨域 stylesheet 的 cssRules 不可读，会导致 SecurityError
    skipFonts: true,
    // 过滤掉跨域 <link rel="stylesheet"> 节点，避免读取 cssRules 抛错
    filter: (domNode) => {
      if (domNode.nodeType === 1) {
        const el = domNode as HTMLElement;
        if (el.tagName === "LINK" && el.getAttribute("rel") === "stylesheet") {
          return false;
        }
        // 过滤掉 <style> 标签中 @import 跨域字体的标签
        if (el.tagName === "STYLE") {
          const text = el.textContent || "";
          if (text.includes("@import")) return false;
        }
      }
      return true;
    },
    ...rest,
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
