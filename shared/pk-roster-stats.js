"use strict";

/**
 * 从「日期 → 当日音浪」映射取最新有数日。
 * @param {Map<string, number>|Record<string, number>|Iterable<[string, number]>} dayMap
 * @returns {{ latestWave: number, latestWaveDate: string|null }}
 */
function latestWaveFromDayMap(dayMap) {
  let entries;
  if (!dayMap) {
    return { latestWave: 0, latestWaveDate: null };
  }
  if (dayMap instanceof Map) {
    entries = [...dayMap.entries()];
  } else if (typeof dayMap[Symbol.iterator] === "function" && !Array.isArray(dayMap) && typeof dayMap !== "string") {
    try {
      entries = [...dayMap];
    } catch {
      entries = Object.entries(dayMap);
    }
  } else {
    entries = Object.entries(dayMap);
  }
  let bestDate = null;
  let bestWave = 0;
  for (const item of entries) {
    const dateStr = String(Array.isArray(item) ? item[0] : item?.date || "");
    const wave = Number(Array.isArray(item) ? item[1] : item?.wave) || 0;
    if (!dateStr) continue;
    if (!bestDate || dateStr > bestDate) {
      bestDate = dateStr;
      bestWave = wave;
    }
  }
  if (!bestDate) return { latestWave: 0, latestWaveDate: null };
  return { latestWave: bestWave, latestWaveDate: bestDate };
}

module.exports = {
  latestWaveFromDayMap,
};
