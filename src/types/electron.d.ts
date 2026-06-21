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
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }
}
