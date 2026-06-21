/** 音浪/数值格式化 */
export function formatWave(value: number): string {
  if (!value) return "0";
  if (value >= 1_0000_0000) return `${(value / 1_0000_0000).toFixed(2)} 亿`;
  if (value >= 1_0000) return `${(value / 1_0000).toFixed(1)} 万`;
  return value.toLocaleString("zh-CN");
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
