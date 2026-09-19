// 前端唯一的数据出口：只走 HTTP，不再有 Electron IPC。
// 后端是 Go，字段命名与 internal/domain 里的 json tag 一一对应。

const BASE = "/api/v1";

export type Gender = "male" | "female" | "unknown";

export interface Person {
  id: number;
  name: string;
  gender: Gender;
  masterId?: number | null;
  generation?: number | null;
  groupName?: string | null;
  avatarUrl?: string | null;
  hideInDailyReport: boolean;
  status: "active" | "left" | "paused";
  createdAt: string;
}

export interface Account {
  id: number;
  personId: number;
  anchorId: string;
  douyinNo: string;
  anchorName: string;
  isPrimary: boolean;
  status: string;
}

export interface DailyRow {
  personId: number;
  anchorId: string;
  bizDate: string;
  wave: number;
  cumulativeWave: number;
  waveSpan: number;
  waveReliable: boolean;
  minutes: number;
  isLive: boolean;
  tier?: string | null;
  name: string;
  gender: Gender;
  masterName?: string | null;
}

export interface MonthlyRow {
  personId: number;
  period: string;
  wave: number;
  minutes: number;
  formattedDuration: string;
  liveDays: number;
  absentDays: number;
  bestDayWave: number;
  avgWavePerLiveDay: number;
  tier?: string | null;
  unreliableDays: number;
  name: string;
  gender: Gender;
}

export interface YearlyRow {
  personId: number;
  year: number;
  wave: number;
  minutes: number;
  formattedDuration: string;
  liveDays: number;
  activeMonths: number;
  bestMonth?: string | null;
  bestMonthWave: number;
  bestDayWave: number;
  avgMonthWave: number;
  tier?: string | null;
  name: string;
  gender: Gender;
}

export interface ImportResult {
  batchId: number;
  imported: number;
  persons: number;
  skipped: string[];
}

export interface DayPoint {
  date: string;
  female: number;
  male: number;
  total: number;
}

export interface AbsentRow {
  personId: number;
  name: string;
  gender: string;
  days: number;
}

export interface TopRow {
  personId: number;
  name: string;
  gender: string;
  wave: number;
  minutes: number;
  tier?: string;
}

export interface Summary {
  date: string;
  totalWave: number;
  prevWave: number;
  liveCount: number;
  totalCount: number;
  monthWave: number;
  monthMinutes: number;
  monthProgress: number;
}

export interface Dashboard {
  summary: Summary;
  trend: DayPoint[];
  absent: AbsentRow[];
  top: TopRow[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new Error("连不上后端，确认 Go 服务已启动（默认 :8080）");
  }

  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { code: string; message: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `请求失败（${res.status}）`);
  }
  return json.data as T;
}

const qs = (params: Record<string, string | undefined>) => {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) usp.set(k, v);
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
};

export const api = {
  listPersons: (params: { gender?: string; status?: string; keyword?: string } = {}) =>
    request<Person[]>("/persons" + qs(params)),

  createPerson: (body: Partial<Person>) =>
    request<Person>("/persons", { method: "POST", body: JSON.stringify(body) }),

  updatePerson: (id: number, body: Partial<Person>) =>
    request<Person>(`/persons/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  deletePerson: (id: number) =>
    request<unknown>(`/persons/${id}`, { method: "DELETE" }),

  listAccounts: (personId: number) => request<Account[]>(`/persons/${personId}/accounts`),

  bindAccount: (personId: number, body: Partial<Account>) =>
    request<Account>(`/persons/${personId}/accounts`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  dashboard: (params: { date?: string; days?: string; top?: string } = {}) =>
    request<Dashboard>("/metrics/dashboard" + qs(params)),

  daily: (date: string, gender?: string) =>
    request<DailyRow[]>(`/metrics/daily${qs({ date, gender })}`),

  monthly: (period: string, gender?: string) =>
    request<MonthlyRow[]>(`/metrics/monthly${qs({ period, gender })}`),

  yearly: (year: string, gender?: string) =>
    request<YearlyRow[]>(`/metrics/yearly${qs({ year, gender })}`),

  importSnapshots: (body: unknown) =>
    request<ImportResult>("/imports/snapshots", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  recompute: (body: { from?: string; to?: string; personId?: number }) =>
    request<{ persons: number }>("/imports/recompute", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

// 音浪用千分位展示，避免大数字读错位数。
export const fmtWave = (n: number) => (n ?? 0).toLocaleString("zh-CN");

export const fmtMinutes = (m: number) => {
  if (!m) return "—";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h${String(mm).padStart(2, "0")}m` : `${h}h`;
};
