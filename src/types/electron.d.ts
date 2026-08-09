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

export interface RosterEntry {
  id: number;
  name: string;
  gender: string;
  generation: number | null;
  masterName: string | null;
  anchorId: string;
  douyinId: string;
  nickname: string;
  accountCount: number;
  aliasIds: string[];
  dailyWave: number;
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
  /** 音浪/时长快照中最近的导入日（YYYY-MM-DD） */
  latestDataDate: string | null;
  /** 音浪快照最近导入日 */
  latestWaveDate: string | null;
  /** 时长快照最近导入日 */
  latestDurationDate: string | null;
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

export interface LivePkMultiRoomInput {
  liveRoomUrl?: string;
  url?: string;
  roomUrl?: string;
  anchorId?: string;
  personId?: string;
  id?: string;
  name?: string;
  anchorName?: string;
  douyinNo?: string;
}

export interface LivePkMultiScoreRow {
  rank: number;
  anchorId: string;
  name: string;
  uniqueId: string;
  score: number;
  scoreText: string;
}

export interface LivePkMultiRoomStatus {
  sessionId: string;
  anchorId: string;
  personId: string;
  name: string;
  douyinNo: string;
  liveRoomUrl: string;
  status: string;
  transport: string;
  source: string;
  roomId: string;
  title: string;
  ownerNickname: string;
  onlineText: string;
  fanTicket: number;
  giftEvents: number;
  chatEvents: number;
  memberEvents: number;
  eventCount: number;
  scores: LivePkMultiScoreRow[];
  startedAt: string | null;
  lastEventAt: string;
  lastMessage: string;
  lastError: string;
}

export interface LivePkMultiMonitorStatus {
  status: "idle" | "starting" | "running" | "partial" | "error";
  roomCount: number;
  runningCount: number;
  pendingCount: number;
  errorCount: number;
  maxRooms: number;
  captureConcurrency: number;
  preferProtocol: boolean;
  scoreOnly?: boolean;
  updatedAt: string;
  rooms: LivePkMultiRoomStatus[];
}

export type WeixinBotPhase =
  | "disconnected"
  | "connecting"
  | "awaiting_scan"
  | "scanned"
  | "running"
  | "stopped"
  | "session_expired"
  | "error";

export interface WeixinBotAccountSummary {
  accountId: string;
  userId: string | null;
  baseUrl: string;
  savedAt: string | null;
  phase: WeixinBotPhase;
  monitoring: boolean;
  lastPollAt: string | null;
  error: string | null;
  receivedCount: number;
  sentCount: number;
}

export interface WeixinBotStatus {
  available: boolean;
  phase: WeixinBotPhase;
  connected: boolean;
  monitoring: boolean;
  accountId: string | null;
  userId: string | null;
  baseUrl: string;
  savedAt: string | null;
  qrDataUrl: string | null;
  qrExpiresAt: string | null;
  statusText: string;
  lastPollAt: string | null;
  lastMessageAt: string | null;
  error: string | null;
  receivedCount: number;
  sentCount: number;
  accounts: WeixinBotAccountSummary[];
}

export interface WeixinBotMessage {
  id: string;
  accountId?: string;
  direction: "inbound" | "outbound";
  conversationId: string;
  userId: string;
  groupId: string | null;
  kind: "text" | "image" | "voice" | "file" | "video" | "unknown";
  content: string;
  createdAt: string;
  status: "received" | "sent" | "failed";
}

export type WeixinBotAccessMode = "open" | "allowlist";

export type WeixinBotCustomCommandAction =
  | "reply"
  | "daily_report"
  | "male_report"
  | "female_report"
  | "wave_file"
  | "help";

export interface WeixinBotCustomCommand {
  id: string;
  trigger: string;
  action: WeixinBotCustomCommandAction;
  replyText: string;
  enabled: boolean;
}

export interface WeixinBotContact {
  accountId: string;
  id: string;
  kind: "user" | "group";
  conversationId: string;
  groupId: string | null;
  lastContent: string;
  lastSeenAt: string;
  allowed: boolean;
  /** 是否已有可主动推送的会话上下文 */
  hasContext?: boolean;
}

export interface WeixinBotDailyReportPushSettings {
  enabled: boolean;
  adminUserIds: string[];
  recipientUserIds: string[];
  recipientGroupIds: string[];
  lastPush?: {
    date: string | null;
    at: string | null;
    ok: number;
    fail: number;
    skipped: string | null;
  } | null;
}

export interface WeixinBotAiSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxToolRounds: number;
  progressEnabled: boolean;
  hasApiKey: boolean;
}

export interface WeixinBotSettings {
  accountId: string | null;
  autoReplyEnabled: boolean;
  autoReplyText: string;
  accessMode: WeixinBotAccessMode;
  allowUserIds: string[];
  allowGroupIds: string[];
  customCommands: WeixinBotCustomCommand[];
  ai: WeixinBotAiSettings;
  contacts: WeixinBotContact[];
  dailyReportPush: WeixinBotDailyReportPushSettings;
}

/** 写入设置的载荷：字段均可选；AI Key 只写不读 */
export interface WeixinBotSettingsSavePayload {
  accountId?: string;
  autoReplyEnabled?: boolean;
  autoReplyText?: string;
  accessMode?: WeixinBotAccessMode;
  allowUserIds?: string[];
  allowGroupIds?: string[];
  customCommands?: WeixinBotCustomCommand[];
  dailyReportPush?: Partial<WeixinBotDailyReportPushSettings>;
  ai?: {
    enabled?: boolean;
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
    maxToolRounds?: number;
    progressEnabled?: boolean;
    apiKey?: string;
    clearApiKey?: boolean;
  };
}

export type QqBotPhase = "idle" | "connecting" | "ready" | "reconnecting" | "error";

export interface QqBotStatus {
  channel: "qqbot";
  phase: QqBotPhase;
  connected: boolean;
  error?: string | null;
  appId?: string;
  hasCredentials: boolean;
  startedAt?: string | null;
  messageCount: number;
  sessionId?: string | null;
  tokenExpiresAt?: number | null;
}

export interface QqBotMessage {
  id: string;
  direction: "in" | "out";
  chatType?: "group" | "c2c" | string;
  conversationId?: string;
  fromUserId?: string;
  groupId?: string | null;
  text?: string;
  at?: string;
}

export type QqBotAccessMode = "open" | "allowlist";

export interface QqBotSettings {
  appId: string;
  clientSecret: string;
  apiBase: string;
  intents: number;
  autoConnect: boolean;
  autoReplyEnabled: boolean;
  autoReplyText: string;
  accessMode: QqBotAccessMode;
  allowUserIds: string[];
  allowGroupIds: string[];
}

export interface QqBotSettingsSavePayload {
  appId?: string;
  clientSecret?: string;
  apiBase?: string;
  intents?: number;
  autoConnect?: boolean;
  autoReplyEnabled?: boolean;
  autoReplyText?: string;
  accessMode?: QqBotAccessMode;
  allowUserIds?: string[];
  allowGroupIds?: string[];
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
  webcastUid?: string;
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
  webcastUid?: string;
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
  webcastUid?: string;
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
  memberAction?: number;
  memberActionText?: string;
  actionDescription?: string;
  enterType?: number;
  rankScore?: number;
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
  webcastUid?: string;
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
  webcastUid?: string;
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

export interface MonthlyReportData {
  month: string;
  gender: string;
  rows: DailyReportRow[];
  summary: {
    total: number;
    notLiveCount: number;
    notLiveDays: number;
    notLiveNames: string[];
    daysInMonth: number;
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
  anchorIds: string[];
  douyinNos: string[];
  wave: number;        // 总音浪（展示用）
  trimmedAvg: number;  // 去最高后日均（分组用）
  maxWave: number;     // 本月最高单日音浪
  minWave: number;     // 本月最低单日音浪
  waveDays: number;    // 有数据的天数
  latestWave: number;  // 周期内最近有数据日的当日音浪
  latestWaveDate?: string | null;
  duration: number;
  rank: number;
}

export interface PkRosterData {
  period: string;
  males: PkMember[];   // 男主播列表（按总音浪降序）
  females: PkMember[]; // 女主播列表（按总音浪降序）
}

export type PkGroupMode = "high_to_low" | "balanced" | "score_capable" | "preset";
export type PkScoreField = "wave" | "latestWave";

export interface BuildPkGroupsPayload {
  members: Array<{
    personId?: number;
    name: string;
    wave?: number;
    latestWave?: number;
    trimmedAvg?: number;
    gender?: string;
    anchorId?: string;
  }>;
  mode?: PkGroupMode | string;
  groupSize?: number;
  minGap?: number;
  scoreField?: PkScoreField | string;
  firstStart?: string;
  stepMinutes?: number;
  gapPairs?: Array<{ a: string; b: string; minGap?: number } | [string, string] | [string, string, number]>;
}

export interface BuildPkGroupsMember {
  index: number;
  name: string;
  personId: number | null;
  wave: number;
  latestWave?: number;
  trimmedAvg: number;
  strength: number;
}

export interface BuildPkGroupsGroup {
  label: string;
  order: number;
  startTime?: string;
  scheduleLabel?: string;
  count: number;
  top4: number;
  average: number;
  members: BuildPkGroupsMember[];
}

export interface BuildPkGroupsResult {
  ok: boolean;
  error?: string;
  warning?: string;
  mode: string;
  modeLabel: string;
  total?: number;
  groupCount?: number;
  sizes?: number[];
  minGap?: number;
  scoreField?: string;
  strongestSlot?: number;
  strongestGroup?: number;
  constraints?: string[];
  groups: BuildPkGroupsGroup[];
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
    startLivePkMultiMonitor: (payload: {
      rooms: LivePkMultiRoomInput[];
      cookie?: string;
      captureConcurrency?: number;
      preferProtocol?: boolean;
      /** 默认 true：只监控音浪，不采礼物/弹幕/进场 */
      scoreOnly?: boolean;
    }) => Promise<IpcResult<LivePkMultiMonitorStatus>>;
    stopLivePkMultiMonitor: (payload?: {
      sessionId?: string;
    }) => Promise<IpcResult<LivePkMultiMonitorStatus>>;
    getLivePkMultiMonitorStatus: () => Promise<IpcResult<LivePkMultiMonitorStatus>>;
    onLivePkMultiStatus: (callback: (status: LivePkMultiMonitorStatus) => void) => () => void;
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
    // ── 微信 iLink Bot ──
    getWeixinBotStatus: () => Promise<IpcResult<WeixinBotStatus>>;
    getWeixinBotMessages: () => Promise<IpcResult<WeixinBotMessage[]>>;
    getWeixinBotSettings: (accountId?: string) => Promise<IpcResult<WeixinBotSettings>>;
    startWeixinBotLogin: () => Promise<IpcResult<WeixinBotStatus>>;
    cancelWeixinBotLogin: () => Promise<IpcResult<WeixinBotStatus>>;
    startWeixinBot: (accountId?: string) => Promise<IpcResult<WeixinBotStatus>>;
    stopWeixinBot: (accountId?: string) => Promise<IpcResult<WeixinBotStatus>>;
    disconnectWeixinBot: (accountId?: string) => Promise<IpcResult<WeixinBotStatus>>;
    setActiveWeixinBotAccount: (accountId: string) => Promise<IpcResult<WeixinBotStatus>>;
    sendWeixinBotMessage: (payload: {
      accountId?: string;
      conversationId: string;
      text: string;
    }) => Promise<IpcResult<WeixinBotMessage>>;
    saveWeixinBotSettings: (
      payload: WeixinBotSettingsSavePayload
    ) => Promise<IpcResult<WeixinBotSettings>>;
    clearWeixinBotMessages: () => Promise<IpcResult<{ cleared: boolean }>>;
    onWeixinBotStatus: (callback: (status: WeixinBotStatus) => void) => () => void;
    onWeixinBotMessage: (callback: (message: WeixinBotMessage) => void) => () => void;
    onWeixinBotMessagesCleared: (callback: () => void) => () => void;
    getQqBotStatus: () => Promise<IpcResult<QqBotStatus>>;
    getQqBotMessages: () => Promise<IpcResult<QqBotMessage[]>>;
    getQqBotSettings: () => Promise<IpcResult<QqBotSettings>>;
    saveQqBotSettings: (payload: QqBotSettingsSavePayload) => Promise<IpcResult<QqBotSettings>>;
    connectQqBot: () => Promise<IpcResult<QqBotStatus>>;
    disconnectQqBot: () => Promise<IpcResult<QqBotStatus>>;
    clearQqBotMessages: () => Promise<IpcResult<{ cleared: boolean }>>;
    onQqBotStatus: (callback: (status: QqBotStatus) => void) => () => void;
    onQqBotMessage: (callback: (message: QqBotMessage) => void) => () => void;
    onQqBotMessagesCleared: (callback: () => void) => () => void;
    getAnchors: () => Promise<IpcResult<AnchorRow[]>>;
    getFamilyTree: () => Promise<IpcResult<FamilyNode[]>>;
    getRosterBySurname: (surname: string) => Promise<IpcResult<RosterEntry[]>>;
    exportFamilyRoster: () => Promise<IpcResult<Record<string, string | number>[]>>;
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
      mergeDuration?: boolean;
    }) => Promise<IpcResult<{ moved: number; mergeDuration: boolean }>>;
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
    getMonthlyReport: (
      month: string,
      gender: string
    ) => Promise<IpcResult<MonthlyReportData>>;
    getPkRoster: (
      period?: string,
      groupSize?: number
    ) => Promise<IpcResult<PkRosterData>>;
    buildPkGroups: (
      payload: BuildPkGroupsPayload
    ) => Promise<IpcResult<BuildPkGroupsResult>>;
    getStarBattleScores: (period: string) => Promise<IpcResult<StarBattleScore[]>>;
    saveStarBattleScore: (
      payload: SaveStarBattleScorePayload
    ) => Promise<IpcResult<{ saved: boolean; deleted: boolean }>>;
    getFlagWinner: (period: string) => Promise<IpcResult<FlagWinnerData | null>>;
    getRewardReport: (period: string, config?: RewardConfig) => Promise<IpcResult<RewardReportData>>;

    // ── 应用密码锁 ──
    verifyAppPassword: (password: string) => Promise<IpcResult<{ ok: boolean; role: "admin" | "guest"; reason?: string }>>;
    hasAppPassword: () => Promise<IpcResult<{ hasPassword: boolean }>>;

    // ── 自动更新 API ──
    checkForUpdates: () => Promise<IpcResult<{ status: string }>>;
    downloadUpdate: () => Promise<IpcResult<{ status: string }>>;
    installUpdate: () => Promise<IpcResult<{ status: string }>>;
    getUpdateStatus: () => Promise<IpcResult<UpdateStatus>>;
    onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  }

  interface Window {
    electronAPI?: ElectronAPI;
    __renderDailyReportPng?: (report: {
      date: string;
      gender: "male" | "female";
      rows: DailyReportRow[];
      summary?: Record<string, unknown>;
    }) => Promise<Array<{ dataUrl: string; pageIndex: number; pageCount: number; fileNameSuffix: string }>>;
  }
}
