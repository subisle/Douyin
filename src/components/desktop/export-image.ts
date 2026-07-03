import { toPng } from "html-to-image";

type ExportImageOptions = {
  width?: number;
  height?: number;
  pixelRatio?: number;
  style?: Partial<CSSStyleDeclaration>;
  backgroundColor?: string;
};

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function waitForFonts() {
  const fonts = document.fonts;
  if (!fonts) return;

  try {
    await fonts.ready;
  } catch {
    // 字体失败不阻塞导出，html-to-image 会回退到可用字体。
  }
}

async function waitForImages(node: HTMLElement) {
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      if (img.complete && img.naturalWidth > 0) return;
      try {
        if (typeof img.decode === "function") {
          await img.decode();
          return;
        }
      } catch {
        // decode 失败时继续走 load/error 兜底。
      }
      await new Promise<void>((resolve) => {
        let timer = 0;
        const cleanup = () => {
          window.clearTimeout(timer);
          img.removeEventListener("load", cleanup);
          img.removeEventListener("error", cleanup);
          resolve();
        };
        timer = window.setTimeout(cleanup, 3000);
        img.addEventListener("load", cleanup, { once: true });
        img.addEventListener("error", cleanup, { once: true });
      });
    })
  );
}

async function waitForExportAssets(node?: HTMLElement) {
  await waitForFonts();
  if (node) await waitForImages(node);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export async function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    triggerDownload(url, filename);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function downloadDataUrlAsFile(dataUrl: string, filename: string) {
  const res = await fetch(dataUrl);
  await downloadBlob(await res.blob(), filename);
}

export async function downloadCanvasAsPng(
  canvas: HTMLCanvasElement,
  filename: string,
  redraw?: () => void
) {
  await waitForExportAssets();
  redraw?.();
  if (redraw) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });

  if (!blob) {
    await downloadDataUrlAsFile(canvas.toDataURL("image/png"), filename);
    return;
  }

  await downloadBlob(blob, filename);
}

export async function elementToPngDataUrl(
  node: HTMLElement,
  options?: ExportImageOptions
) {
  await waitForExportAssets(node);

  const { pixelRatio, backgroundColor, ...rest } = options ?? {};
  return toPng(node, {
    pixelRatio: pixelRatio ?? 3,
    backgroundColor: backgroundColor ?? "#f5f3ee",
    cacheBust: true,
    // 跳过字体内联——跨域 stylesheet 的 cssRules 不可读，会导致 SecurityError。
    // 上面的 document.fonts.ready 仍会等待本地已加载字体，保证导出时机稳定。
    skipFonts: true,
    // 过滤掉跨域 <link rel="stylesheet"> 节点，避免读取 cssRules 抛错。
    filter: (domNode) => {
      if (domNode.nodeType === 1) {
        const el = domNode as HTMLElement;
        if (el.tagName === "LINK" && el.getAttribute("rel") === "stylesheet") {
          return false;
        }
        // 过滤掉 <style> 标签中 @import 跨域字体的标签。
        if (el.tagName === "STYLE") {
          const text = el.textContent || "";
          if (text.includes("@import")) return false;
        }
      }
      return true;
    },
    ...rest,
  });
}

/**
 * 将 DOM 元素导出为 PNG 图片并触发下载。
 * @param node 要截图的 DOM 元素
 * @param filename 下载文件名（含 .png 后缀）
 * @param options 可选：覆盖 width/height/style/pixelRatio/backgroundColor 等 html-to-image 选项
 */
export async function exportElementAsImage(
  node: HTMLElement,
  filename: string,
  options?: ExportImageOptions
) {
  const dataUrl = await elementToPngDataUrl(node, options);
  await downloadDataUrlAsFile(dataUrl, filename);
}
