export {};

export interface AnchorRow {
  id: number;
  name: string;
  gender: string;
  generation: number | null;
  masterId: number | null;
  anchorId: string;
  anchorName: string;
  douyinNo: string;
  accountCount: number;
  aliasIds: string[];
  createdAt: string | null;
}

export interface FamilyNode {
  id: number;
  name: string;
  gender: string;
  generation: number | null;
  masterId: number | null;
  masterName: string | null;
}

export interface DashboardSummary {
  totalAnchors: number;
  totalAccounts: number;
  totalWave: number;
  totalDuration: number;
  avgWave: number;
  avgDuration: number;
  dataCount: number;
}

export interface WaveRankRow {
  rank: number;
  name: string;
  anchorId: string;
  family: string;
  wave: number;
  duration: number;
  trend: "up" | "down" | "flat";
}

export interface TrendPoint {
  date: string;
  total: number;
}

export interface WaveTrendByGender {
  male: TrendPoint[];
  female: TrendPoint[];
}

export interface ImportResult {
  inserted: number;
}

export type IpcResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface FlagGroup {
  masterId: number;
  masterName: string;
  memberCount: number;
  score: number;
  avgWave: number;
  avgDuration: number;
  isWinner: boolean;
}

export interface FlagSettleResult {
  period: string;
  groups: number;
  winner: {
    masterId: number;
    masterName: string;
    score: number;
  } | null;
}

export interface TierRule {
  id: number;
  label: string;
  minWave: number;
  sortOrder: number;
}

export interface DailyReportRow {
  rank: number;
  name: string;
  anchorId: string;
  dailyWave: number;
  totalWave: number;
  dailyDuration: number;
  totalDuration: number;
  tier: string;
  isLive: boolean;
}

export interface DailyReportData {
  date: string;
  gender: string;
  rows: DailyReportRow[];
  summary: {
    total: number;
    notLiveCount: number;
    notLiveNames: string[];
  };
}

export interface PkMember {
  personId: number;
  name: string;
  gender: string;
  anchorId: string;
  wave: number;        // 总音浪（展示用）
  trimmedAvg: number;  // 去最高后日均（分组用）
  maxWave: number;     // 本月最高单日音浪
  minWave: number;     // 本月最低单日音浪
  waveDays: number;    // 有数据的天数
  duration: number;
  rank: number;
}

export interface PkRosterData {
  period: string;
  males: PkMember[];   // 男主播列表（按总音浪降序）
  females: PkMember[]; // 女主播列表（按总音浪降序）
}

export interface DuplicateAnchorPerson {
  id: number;
  name: string;
  gender: string;
  generation: number | null;
  masterId: number | null;
  createdAt: string | null;
  anchorId: string;
  douyinNo: string;
  accountCount: number;
}

export interface DuplicateAnchorGroup {
  name: string;
  count: number;
  persons: DuplicateAnchorPerson[];
}

declare global {
  interface ElectronAPI {
    windowMinimize: () => Promise<void>;
    windowMaximize: () => Promise<boolean>;
    windowClose: () => Promise<void>;
    windowIsMaximized: () => Promise<boolean>;
    onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
    getAnchors: () => Promise<IpcResult<AnchorRow[]>>;
    getFamilyTree: () => Promise<IpcResult<FamilyNode[]>>;
    getDashboardSummary: () => Promise<IpcResult<DashboardSummary>>;
    getWaveRanking: (limit?: number) => Promise<IpcResult<WaveRankRow[]>>;
    getWaveTrendByGender: () => Promise<IpcResult<WaveTrendByGender>>;
    importWave: (
      date: string,
      rows: { anchorId: string; waveValue: number; rank: number }[]
    ) => Promise<IpcResult<ImportResult>>;
    importDuration: (
      date: string,
      rows: { anchorId: string; totalMinutes: number }[]
    ) => Promise<IpcResult<ImportResult>>;
    exportWave: (
      date?: string
    ) => Promise<IpcResult<Record<string, string | number>[]>>;
    exportDuration: (
      date?: string
    ) => Promise<IpcResult<Record<string, string | number>[]>>;
    exportAnchors: () => Promise<IpcResult<Record<string, string | number>[]>>;
    addAnchor: (payload: {
      name: string;
      gender: string;
      anchorId: string;
      anchorName?: string;
      douyinNo?: string;
    }) => Promise<IpcResult<{ id: number }>>;
    batchImportAnchors: (
      rows: { anchorId: string; name: string; douyinNo: string; gender: string }[]
    ) => Promise<IpcResult<{ created: number; skipped: number }>>;
    mergeAccounts: (payload: {
      primaryPersonId: number;
      secondaryPersonId: number;
    }) => Promise<IpcResult<{ moved: number }>>;
    deleteAnchors: (
      personIds: number[]
    ) => Promise<IpcResult<{ deleted: number }>>;
    findDuplicateAnchors: () => Promise<IpcResult<DuplicateAnchorGroup[]>>;
    getWaveTrendTotal: () => Promise<IpcResult<TrendPoint[]>>;
    getAnchorCountTrend: () => Promise<IpcResult<TrendPoint[]>>;
    updateAnchorName: (payload: {
      personId: number;
      name: string;
    }) => Promise<IpcResult<{ ok: boolean }>>;
    getAnchorWaveTrend: (
      anchorId: string
    ) => Promise<IpcResult<{ date: string; total: number; rank: number }[]>>;
    getAnchorsWaveTrend: (
      anchorIds: string[]
    ) => Promise<
      IpcResult<
        {
          anchorId: string;
          name: string;
          data: { date: string; total: number; rank: number }[];
        }[]
      >
    >;
    getFlowingFlag: (
      personId: number
    ) => Promise<
      IpcResult<{
        master: { id: number; name: string } | null;
        members: {
          id: number;
          name: string;
          gender: string;
          anchorId: string;
          wave: number;
          duration: number;
        }[];
        avgWave: number;
        avgDuration: number;
        count: number;
      }>
    >;
    getFlagGroups: (period: string) => Promise<IpcResult<FlagGroup[]>>;
    settleFlagScores: (period: string) => Promise<IpcResult<FlagSettleResult>>;
    getTierRules: () => Promise<IpcResult<TierRule[]>>;
    saveTierRules: (
      rules: { label: string; minWave: number }[]
    ) => Promise<IpcResult<{ saved: number }>>;
    getDailyWaveReport: (
      date: string,
      gender: string
    ) => Promise<IpcResult<DailyReportData>>;
    getPkRoster: (  getFlagWinner(period: string): Promise<IpcResult<FlagWinnerData | null>>;

      period?: string,
      groupSize?: number
    ) => Promise<IpcResult<PkRosterData>>;
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }
}
