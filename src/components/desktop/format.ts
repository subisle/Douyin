/** 音浪/数值格式化：统一「万」为单位，精确到 0.1 万（千），不显示千后零碎。 */
export function formatWave(value: number): string {
  const n = Number(value) || 0;
  if (n <= 0) return "0";
  if (n >= 1_0000_0000) {
    const yi = n / 1_0000_0000;
    const r = Math.round(yi * 10) / 10;
    return Number.isInteger(r) ? `${r} 亿` : `${r.toFixed(1)} 亿`;
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
