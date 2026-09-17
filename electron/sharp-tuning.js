"use strict";

/**
 * sharp/libvips 资源调优（针对 RK3318 这类低配 arm64 设备）。
 *
 * 默认行为在 4 核小盒子上偏浪费：
 * - 默认 libvips cache 会按内存上限缓存中间结果，出图时峰值明显抬高
 * - 默认 concurrency = CPU 核数，多张大图会同时占用多个线程缓冲
 *
 * 用环境变量可覆盖（不设则用下面的保守默认值）：
 *   SHARP_CACHE=0        关闭 cache（默认）
 *   SHARP_CONCURRENCY=2  并发线程数（默认 2）
 */

const DEFAULT_CONCURRENCY = 2;

function envFlag(value, fallback) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return fallback;
}

/**
 * 给 sharp 实例套上保守的缓存 / 并发设置，返回同一个实例方便链式调用。
 * @param {any} sharpInstance require("sharp") 的结果
 */
function tuneSharp(sharpInstance, env = process.env) {
  if (!sharpInstance) return sharpInstance;
  try {
    if (envFlag(env.SHARP_CACHE, false) === false && typeof sharpInstance.cache === "function") {
      sharpInstance.cache(false);
    }
  } catch {
    // 老版本 sharp 或不支持时忽略
  }
  try {
    const raw = Number(env.SHARP_CONCURRENCY);
    const concurrency = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CONCURRENCY;
    if (typeof sharpInstance.concurrency === "function") sharpInstance.concurrency(concurrency);
  } catch {
    // ignore
  }
  return sharpInstance;
}

/** 懒加载 + 调优：保持各模块原来的「用到才 require」行为 */
function loadSharp(env = process.env) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return tuneSharp(require("sharp"), env);
}

module.exports = {
  tuneSharp,
  loadSharp,
  envFlag,
  DEFAULT_CONCURRENCY,
};
