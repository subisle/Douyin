export {};

export interface AnchorRow {
  id: number;
  name: string;
  gender: string;
  generation: number | null;
  masterId: number | null;
  masterName: string | null;
  hideInDailyReport: boolean;
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
  anchorId: string;
  accountCount: number;
  aliasIds: string[];
}

export interface DashboardSummary {
  totalAnchors: number;
  totalAccounts: number;
  notLiveCount: number;
  totalWave: number;
  totalDuration: number;
  avgWave: number;
  avgDuration: number;
  dataCount: number;
}

export interface StartupHealthCheck {
  key: string;
  label: string;
  status: "ok" | "warning" | "error";
  detail: string;
}

export interface StartupHealthResult {
  ok: boolean;
  status: "ok" | "warning" | "error";
  checks: StartupHealthCheck[];
  counts: {
    persons: number;
    accounts: number;
    waveSnapshots: number;
    durationSnapshots: number;
    importRecords: number;
  };
}

export interface AppInfo {
  name: string;
  version: string;
  productName: string;
  isPackaged: boolean;
  platform: string;
  arch: string;
  electron: string;
  updateProxy: string;
}

export interface LivePkMonitorStatus {
  status: "idle" | "connecting" | "running" | "closed" | "error";
  startedAt: string | null;
  lastError: string | null;
  lastRankAt: string | null;
  cachedUsers?: number;
  cachedDisplayNames?: number;
  cachedGifts?: number;
  roomId?: string;
  embedded?: boolean;
  liveRoomUrl?: string;
}

export interface LivePkEmbeddedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LivePkEmbeddedState {
  embedded: boolean;
  liveRoomUrl?: string;
  error?: string;
}

export interface LivePkCookieState {
  saved: boolean;
  cookie?: string;
  updatedAt?: string | null;
}

export interface LivePkRankItem {
  rank: number;
  anchorId?: string;
  anchorName?: string;
  nickname: string;
  displayName?: string;
  realName?: string;
  userId: string;
  secUid?: string;
  uniqueId?: string;
  hasStrongIdentity?: boolean;
  identitySource?: string;
  isMystery?: boolean;
  mysteryMan?: number;
  isAnonymous?: boolean;
  userLevel?: number;
  badgeLevel?: number;
  consumeLevel?: number;
  wealthLevel?: number;
  fansClubLevel?: number;
  honorLevel?: number;
  payScore?: number;
  totalRechargeDiamondCount?: number;
  fanTicketCount?: number;
  gender?: number;
  followStatus?: number;
  ipLocation?: string;
  followerCount?: number;
  cacheHit?: boolean;
  scoreText: string;
  score: number;
  scoreVersion?: number;
  scoreRelative?: boolean;
  multiPkTeamScore?: number;
  multiPkTeamScoreText?: string;
  rankDelta?: number;
  isHidden?: boolean;
  rankSource?: string;
}

export interface LivePkRankPayload {
  type: "rank";
  at: string;
  raw?: unknown;
  rawMethod?: string;
  interactionScoreStatus?: number;
  interactionScoreAction?: number;
  channelId?: string;
  battleId?: string;
  extra?: string;
  gameExtra?: string;
  rankSource?: string;
  total?: number;
  userCountText?: string;
  currency?: string;
  seats?: LivePkRankItem[];
  ranks: LivePkRankItem[];
}

export interface LivePkGiftPayload {
  type: "gift";
  at: string;
  raw?: unknown;
  rawMethod?: string;
  nickname: string;
  displayName?: string;
  realName?: string;
  userId: string;
  secUid?: string;
  uniqueId?: string;
  hasStrongIdentity?: boolean;
  identitySource?: string;
  isMystery?: boolean;
  mysteryMan?: number;
  isAnonymous?: boolean;
  userLevel?: number;
  badgeLevel?: number;
  consumeLevel?: number;
  wealthLevel?: number;
  fansClubLevel?: number;
  honorLevel?: number;
  payScore?: number;
  totalRechargeDiamondCount?: number;
  fanTicketCount?: number;
  gender?: number;
  followStatus?: number;
  ipLocation?: string;
  followerCount?: number;
  cacheHit?: boolean;
  giftId?: string;
  giftName: string;
  giftKind?: "paid" | "free-cell" | "doodle" | "free" | string;
  giftType?: number;
  giftScene?: number;
  giftDescribe?: string;
  diamondCount?: number;
  count: number;
  comboCount?: number;
  repeatCount?: number;
  groupCount?: number;
  totalCount?: number;
  baseScore?: number;
  bonusScore?: number;
  bonusRate?: number;
  fanTicket: number;
  roomFanTicketCount?: number;
  repeatEnd?: number;
  groupId?: string;
  logId?: string;
  traceId?: string;
  sendType?: number;
  sendTime?: string;
  clientGiftSource?: number;
  multiSendEffectLevel?: number;
  useRoomMessage?: boolean;
  compose?: string;
  trayText?: string;
  freeCell?: Record<string, unknown>;
}

export interface LivePkMemberPayload {
  type: "member";
  at: string;
  raw?: unknown;
  rawMethod?: string;
  nickname: string;
  displayName?: string;
  realName?: string;
  userId: string;
  secUid?: string;
  uniqueId?: string;
  hasStrongIdentity?: boolean;
  identitySource?: string;
  isMystery?: boolean;
  mysteryMan?: number;
  isAnonymous?: boolean;
  userLevel?: number;
  badgeLevel?: number;
  consumeLevel?: number;
  wealthLevel?: number;
  fansClubLevel?: number;
  honorLevel?: number;
  payScore?: number;
  totalRechargeDiamondCount?: number;
  fanTicketCount?: number;
  gender?: number;
  followStatus?: number;
  ipLocation?: string;
  followerCount?: number;
  cacheHit?: boolean;
  memberCount: number;
}

export interface LivePkChatPayload {
  type: "chat";
  at: string;
  raw?: unknown;
  rawMethod?: string;
  nickname: string;
  displayName?: string;
  realName?: string;
  userId: string;
  secUid?: string;
  uniqueId?: string;
  hasStrongIdentity?: boolean;
  identitySource?: string;
  isMystery?: boolean;
  mysteryMan?: number;
  isAnonymous?: boolean;
  userLevel?: number;
  badgeLevel?: number;
  consumeLevel?: number;
  wealthLevel?: number;
  fansClubLevel?: number;
  honorLevel?: number;
  payScore?: number;
  totalRechargeDiamondCount?: number;
  fanTicketCount?: number;
  gender?: number;
  followStatus?: number;
  ipLocation?: string;
  followerCount?: number;
  cacheHit?: boolean;
  content: string;
  eventTime?: string;
  chatBy?: string;
  priorityLevel?: number;
  modelInfo?: Record<string, string>;
}

export interface LivePkEventPayload {
  type: "event";
  eventType: string;
  at: string;
  method?: string;
  raw?: unknown;
  rawMethod?: string;
  nickname?: string;
  displayName?: string;
  realName?: string;
  userId?: string;
  secUid?: string;
  uniqueId?: string;
  hasStrongIdentity?: boolean;
  identitySource?: string;
  isMystery?: boolean;
  mysteryMan?: number;
  isAnonymous?: boolean;
  userLevel?: number;
  badgeLevel?: number;
  consumeLevel?: number;
  wealthLevel?: number;
  fansClubLevel?: number;
  honorLevel?: number;
  payScore?: number;
  totalRechargeDiamondCount?: number;
  fanTicketCount?: number;
  gender?: number;
  followStatus?: number;
  ipLocation?: string;
  followerCount?: number;
  cacheHit?: boolean;
  content?: string;
  count?: number;
  total?: number;
  displayShort?: string;
  displayMiddle?: string;
  displayLong?: string;
  displayValue?: number;
  totalUser?: number;
  totalUserText?: string;
  popularity?: number;
  popularityText?: string;
  ranks?: LivePkRankItem[];
  seats?: LivePkRankItem[];
  [key: string]: unknown;
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

export interface ImportMeta {
  fileHash: string;
  dataHash: string;
  fileName: string;
  rowCount: number;
}

export interface ImportPreviewResult {
  existing: {
    anchorId: string;
    value: number;
    rank: number;
  }[];
  duplicateFile: {
    fileName: string;
    rowCount: number;
    createdAt: string | null;
  } | null;
  duplicateData: {
    fileName: string;
    rowCount: number;
    createdAt: string | null;
  } | null;
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
  previousRank: number | null;
  rankDelta: number | null;
  name: string;
  anchorId: string;
  dailyWave: number;
  totalWave: number;
  dailyDuration: number;
  totalDuration: number;
  notLiveDays: number;
  tier: string;
  isLive: boolean;
  masterName: string | null;
}

export interface DailyReportData {
  date: string;
  gender: string;
  rows: DailyReportRow[];
  summary: {
    total: number;
    notLiveCount: number;
    notLiveDays: number;
    notLiveNames: string[];
    previousDate?: string | null;
  };
}

// ── 自动更新相关类型 ──
export interface UpdateStatus {
  status: "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  info: {
    version: string;
    releaseDate: string;
    releaseNotes: string | unknown;
  } | null;
  progress: {
    percent: number;
    transferred: number;
    total: number;
    bytesPerSecond: number;
  } | null;
  error: string | null;
  feed?: string | null;
  checkedAt?: string | null;
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

export interface StarBattleScore {
  period: string;
  roundKey: string;
  groupKey: string;
  personId: number;
  score: number;
  updatedAt: string | null;
}

export interface SaveStarBattleScorePayload {
  period: string;
  roundKey: string;
  groupKey: string;
  personId: number;
  score: number | string | null;
}

export interface FlagWinnerData {
  period: string;
  masterId: number;
  masterName: string;
  score: number;
  avgWave: number;
  avgDuration: number;
  memberCount: number;
  settledAt: string | null;
}

export interface RewardRule {
  label: string;
  minWave: number;
  maxWave: number | null;
  amount: number;
}

export interface RewardRow {
  personId: number;
  name: string;
  gender: string;
  anchorId: string;
  wave: number;
  duration: number;
  waveReward: number;
  waveRewardLabel: string;
  durationReward: number;
  totalReward: number;
  waveRank: number;
  durationRank: number;
}

export interface RewardReportData {
  period: string;
  rows: RewardRow[];
  waveRules: RewardRule[];
  durationRule: {
    thresholdMinutes: number;
    firstPrize: number;
    qualified: boolean;
    winnerPersonId: number | null;
  };
  summary: {
    totalPeople: number;
    waveWinners: number;
    durationQualified: boolean;
    totalBonus: number;
  };
}

export interface RewardConfig {
  waveRules: RewardRule[];
  durationRule: {
    thresholdMinutes: number;
    firstPrize: number;
  };
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
    getAppInfo: () => Promise<AppInfo>;
    startLivePkMonitor: (
      payload: { websocketUrl: string; cookie: string; includeRaw?: boolean }
    ) => Promise<IpcResult<LivePkMonitorStatus>>;
    openLivePkEmbeddedMonitor: (
      payload: {
        liveRoomUrl: string;
        cookie?: string;
        bounds: LivePkEmbeddedBounds;
        includeRaw?: boolean;
      }
    ) => Promise<IpcResult<LivePkMonitorStatus>>;
    setLivePkEmbeddedBounds: (
      bounds: LivePkEmbeddedBounds
    ) => Promise<IpcResult<{ embedded: boolean; liveRoomUrl: string }>>;
    closeLivePkEmbeddedMonitor: (
      payload?: { stopMonitor?: boolean }
    ) => Promise<IpcResult<LivePkMonitorStatus>>;
    reloadLivePkEmbeddedView: () => Promise<IpcResult<{ embedded: boolean; liveRoomUrl: string }>>;
    setLivePkEmbeddedMuted: (muted: boolean) => Promise<IpcResult<{ muted: boolean }>>;
    onLivePkEmbeddedState: (callback: (payload: LivePkEmbeddedState) => void) => () => void;
    startLivePkMonitorFromUrl: (
      payload: { liveRoomUrl: string; cookie?: string; includeRaw?: boolean }
    ) => Promise<IpcResult<LivePkMonitorStatus>>;
    stopLivePkMonitor: () => Promise<IpcResult<LivePkMonitorStatus>>;
    getLivePkMonitorStatus: () => Promise<IpcResult<LivePkMonitorStatus>>;
    saveLivePkCookie: (cookie: string) => Promise<IpcResult<{ saved: boolean; updatedAt: string }>>;
    readLivePkCookie: () => Promise<IpcResult<LivePkCookieState>>;
    clearLivePkCookie: () => Promise<IpcResult<{ saved: boolean }>>;
    onLivePkStatus: (callback: (status: LivePkMonitorStatus) => void) => () => void;
    onLivePkRank: (callback: (payload: LivePkRankPayload) => void) => () => void;
    onLivePkGift: (callback: (payload: LivePkGiftPayload) => void) => () => void;
    onLivePkMember: (callback: (payload: LivePkMemberPayload) => void) => () => void;
    onLivePkChat: (callback: (payload: LivePkChatPayload) => void) => () => void;
    onLivePkEvent: (callback: (payload: LivePkEventPayload) => void) => () => void;
    onLivePkError: (callback: (message: string) => void) => () => void;
    onLivePkCaptureStatus: (callback: (message: string) => void) => () => void;
    getAnchors: () => Promise<IpcResult<AnchorRow[]>>;
    getFamilyTree: () => Promise<IpcResult<FamilyNode[]>>;
    getDashboardSummary: () => Promise<IpcResult<DashboardSummary>>;
    getStartupHealth: () => Promise<IpcResult<StartupHealthResult>>;
    getWaveRanking: (limit?: number) => Promise<IpcResult<WaveRankRow[]>>;
    getWaveTrendByGender: () => Promise<IpcResult<WaveTrendByGender>>;
    importWave: (
      date: string,
      rows: { anchorId: string; waveValue: number; rank: number }[],
      meta?: ImportMeta
    ) => Promise<IpcResult<ImportResult>>;
    importDuration: (
      date: string,
      rows: { anchorId: string; totalMinutes: number }[],
      meta?: ImportMeta
    ) => Promise<IpcResult<ImportResult>>;
    getImportPreview: (
      kind: "wave" | "duration",
      date: string,
      anchorIds: string[],
      meta?: ImportMeta
    ) => Promise<IpcResult<ImportPreviewResult>>;
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
    updateAnchorInfo: (payload: {
      personId: number;
      name: string;
      gender: string;
      anchorId: string;
      douyinNo?: string;
      hideInDailyReport?: boolean;
    }) => Promise<IpcResult<{ ok: boolean }>>;
    updateAnchorMaster: (payload: {
      personId: number;
      masterId: number | null;
    }) => Promise<IpcResult<{ ok: boolean }>>;
    getAnchorDailySnapshot: (
      anchorId: string,
      date: string
    ) => Promise<
      IpcResult<{
        anchorId: string;
        date: string;
        waveValue: number | null;
        rank: number | null;
        totalMinutes: number | null;
      }>
    >;
    saveAnchorDailySnapshot: (payload: {
      anchorId: string;
      date: string;
      waveValue?: number | string | null;
      rank?: number | string | null;
      totalMinutes?: number | string | null;
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
    getPkRoster: (
      period?: string,
      groupSize?: number
    ) => Promise<IpcResult<PkRosterData>>;
    getStarBattleScores: (period: string) => Promise<IpcResult<StarBattleScore[]>>;
    saveStarBattleScore: (
      payload: SaveStarBattleScorePayload
    ) => Promise<IpcResult<{ saved: boolean; deleted: boolean }>>;
    getFlagWinner: (period: string) => Promise<IpcResult<FlagWinnerData | null>>;
    getRewardReport: (period: string, config?: RewardConfig) => Promise<IpcResult<RewardReportData>>;

    // ── 自动更新 API ──
    checkForUpdates: () => Promise<IpcResult<{ status: string }>>;
    downloadUpdate: () => Promise<IpcResult<{ status: string }>>;
    installUpdate: () => Promise<IpcResult<{ status: string }>>;
    getUpdateStatus: () => Promise<IpcResult<UpdateStatus>>;
    onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }
}
