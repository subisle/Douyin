/** 音浪格式化：低于 1 万直接显示数字；≥1 万用「万」精确到 0.1；≥1 亿用「亿」。 */
export function formatWave(value: number): string {
  const n = Number(value) || 0;
  if (n <= 0) return "0";
  if (n >= 1_0000_0000) {
    const yi = n / 1_0000_0000;
    const r = Math.round(yi * 10) / 10;
    return Number.isInteger(r) ? `${r} 亿` : `${r.toFixed(1)} 亿`;
  }
  // 低于一万：直接显示整数（千分位）
  if (n < 1_0000) {
    return Math.round(n).toLocaleString("zh-CN");
  }
  const wan = n / 1_0000;
  const r = Math.round(wan * 10) / 10; // 精确到千
  if (r <= 0) return "0";
  return Number.isInteger(r) ? `${r} 万` : `${r.toFixed(1)} 万`;
}

/** 分钟 → x小时y分 */
export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h > 0) return `${h}小时${rest}分`;
  return `${rest}分钟`;
}

export function formatNumber(value: number): string {
  return (value || 0).toLocaleString("zh-CN");
}
