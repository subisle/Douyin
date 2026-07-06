# 抖音数据管理：服务器端与 App 设计文档

> 版本：v0.1
> 日期：2026-07-06
> 范围：在现有桌面端「抖音数据管理」基础上，扩展为可运行在服务器上的 Web/API 服务，并支持 iOS App 使用。
> 当前项目识别：Next.js + React + Electron + MySQL，桌面端通过 `window.electronAPI` 调用 Electron IPC，再由 `electron/db.js` 访问 MySQL。
> 最新决策：从 2026-07-06 03:35 起开始做网页服务器版本；后续数据库使用网站服务器配置的数据库。

---

## 1. 背景与目标

当前系统是桌面端应用，核心能力包括：

- 主播档案管理：人员、账号、师徒关系、性别、代际等。
- 数据导入导出：音浪 CSV、直播时长 CSV、主播数据导入/导出。
- 数据分析：仪表盘、音浪趋势、时长趋势、排行榜、日 报。
- 运营工具：流动红旗、PK 名单、奖励机制。
- 可视化导出：日报图、族谱图、海报图等。
- 桌面端能力：Electron 窗口控制、自动更新、本地打包发布。

新目标是：

1. **服务器端化**：将业务逻辑和数据访问从 Electron IPC 中抽离成可部署的服务端 API。
2. **多端复用**：桌面端、Web 端、移动 App 共用同一套 API 和业务规则。
3. **App 支持**：为手机端提供轻量、稳定、安全的接口与页面/原生能力。
4. **权限与安全**：服务器上统一管理账号、权限、审计、导入记录和敏感配置。
5. **平滑迁移**：不一次性推倒桌面端，优先复用现有 Next.js UI 与 MySQL 表结构。
6. **网站数据库为准**：服务器/Web/iOS 后续统一使用网站服务器配置的数据库，桌面端逐步从本地 IPC 访问切换为 HTTP API 访问。

---

## 2. 总体原则

### 2.1 分层原则

将当前桌面端的 Electron IPC 架构：

```text
React UI -> window.electronAPI -> Electron ipcMain -> electron/db.js -> MySQL
```

升级为多端架构：

```text
桌面端 Electron
Web 浏览器
移动 App
   ↓
统一 API Client
   ↓
HTTP API / Server Actions / 后端服务
   ↓
业务 Service 层
   ↓
Repository / DAO
   ↓
MySQL / 对象存储 / 缓存
```

### 2.2 迁移原则

- **先抽象，再替换**：先建立 `DataClient` 接口，让页面不直接依赖 `window.electronAPI`。
- **先读后写**：优先迁移查询接口，如仪表盘、主播列表、族谱、排行榜；再迁移导入、修改、删除。
- **兼容桌面端**：桌面端短期仍可通过 Electron 使用，但逐步切到 HTTP API。
- **网站数据库优先**：服务器版本通过服务端 `.env` 连接网站数据库；浏览器和 iOS App 只调用 API，不直连数据库。
- **数据库不大改**：第一阶段尽量复用现有 MySQL 表，后续再补用户、权限、审计等表。
- **安全默认开启**：服务器端不暴露数据库账号，不信任客户端传入的身份与权限。

---

## 3. 目标产品形态

### 3.1 服务器端 Web 管理后台

运行在服务器上，可通过浏览器访问。

主要页面：

- 登录页
- 仪表盘
- 主播列表
- 主播详情
- 师徒/族谱
- 导入导出
- 每日报告
- 流动红旗
- PK 名单
- 奖励机制
- 系统设置
- 用户与权限管理

### 3.2 iOS App

面向 iPhone 日常查看和轻量操作，首版按原生 SwiftUI iOS App 设计。

建议 App 首版聚焦：

- 登录
- 今日数据概览
- 主播搜索
- 主播详情
- 排行榜
- 每日报告查看/分享
- PK 名单查看
- 流动红旗结果查看
- 奖励结果查看

不建议首版在 App 中做复杂 CSV 导入。CSV 导入保留给 Web/桌面端，App 后续可支持拍照/文件上传导入。

### 3.3 桌面端

保留现有桌面端作为高级管理工具。

迁移后桌面端职责：

- 复用 Web UI。
- 通过 HTTP API 访问服务器。
- 保留自动更新、窗口控制等桌面体验。
- 可作为离线/内网备用工具，但第一阶段不做复杂离线同步。

---

## 4. 推荐技术方案

### 4.1 后端方案

考虑当前项目已经使用 Next.js 15，推荐优先采用：

```text
Next.js App Router + Route Handlers + Service 层 + MySQL
```

原因：

- 迁移成本最低，现有页面和组件可继续复用。
- API 可直接放在 `src/app/api/**/route.ts`。
- 服务端部署简单，可用 Node.js 运行。
- 未来如后端复杂度升高，再拆成独立 NestJS/Fastify 服务。

### 4.2 iOS App 方案

用户明确 App 端优先为 **iOS App**。推荐两种路线：

**推荐首选：SwiftUI 原生 iOS App + 统一 HTTP API**

```text
iOS SwiftUI App -> HTTPS API -> Next.js/Node 服务端 -> MySQL
```

原因：

- iOS 体验最好，系统分享、相册、文件、通知、Keychain 等能力接入稳定。
- 适合长期维护和上架 App Store / TestFlight。
- 服务端 API 与 Web/桌面端完全复用，App 不直连数据库。
- 当前业务偏数据看板和报表，SwiftUI 实现效率足够高。

**备选：React Native / Expo + TypeScript**

适合希望最大化复用当前 React/TypeScript 前端经验，但 iOS 原生体验、长期系统能力接入不如 SwiftUI 直接。

本设计后续默认按 **SwiftUI 原生 iOS App** 展开。

### 4.3 数据库方案

继续使用 MySQL。

第一阶段复用现有核心表：

- `persons`
- `accounts`
- `wave_snapshots`
- `duration_snapshots`
- `flag_scores`
- `flag_winners`
- `tier_rules`
- `import_records`

新增服务器端表：

- `users`：用户账号
- `roles`：角色
- `user_roles`：用户角色关系
- `audit_logs`：操作审计
- `sessions` 或接入第三方认证会话
- `api_tokens`：可选，给脚本/自动化使用
- `files`：导入文件、导出文件、海报文件记录

---

## 5. 系统架构

### 5.1 逻辑架构

```text
┌─────────────────────────────────────────┐
│                客户端层                  │
│  Web 管理后台 / Electron 桌面端 / App    │
└─────────────────────┬───────────────────┘
                      │ HTTPS + JSON
┌─────────────────────▼───────────────────┐
│                API 接入层                │
│  Next.js Route Handlers / Middleware     │
│  登录校验 / 权限校验 / 参数校验 / 限流    │
└─────────────────────┬───────────────────┘
                      │
┌─────────────────────▼───────────────────┐
│                业务服务层                │
│ AnchorService / ImportService / Report   │
│ FlagService / PkService / RewardService  │
└─────────────────────┬───────────────────┘
                      │
┌─────────────────────▼───────────────────┐
│                数据访问层                │
│ Repository / SQL / Transaction           │
└─────────────────────┬───────────────────┘
                      │
┌─────────────────────▼───────────────────┐
│              基础设施层                  │
│ MySQL / Redis 可选 / 对象存储 / 日志      │
└─────────────────────────────────────────┘
```

### 5.2 代码结构建议

建议在当前项目中逐步调整为：

```text
src/
  app/
    api/
      auth/
      anchors/
      dashboard/
      imports/
      exports/
      reports/
      flags/
      pk/
      rewards/
      settings/
    page.tsx
  components/
    desktop/
    mobile-shared/          # 可复用组件，可选
    ui/
  client/
    data-client.ts          # 统一数据客户端接口
    electron-client.ts      # Electron IPC 实现
    http-client.ts          # HTTP API 实现
  server/
    db/
      pool.ts
      schema.ts
      repositories/
    services/
      anchor-service.ts
      dashboard-service.ts
      import-service.ts
      report-service.ts
      flag-service.ts
      pk-service.ts
      reward-service.ts
    auth/
      session.ts
      permission.ts
    validation/
    utils/
  shared/
    types/
    constants/
    format/
electron/
  main.js
  preload.js
  db.js                    # 过渡期保留，逐步瘦身
ios/
  DouyinApp/               # SwiftUI iOS App，可后续创建独立 Xcode project 或 Swift Package 结构
```

---

## 6. 服务端模块设计

### 6.1 AuthService：认证与会话

职责：

- 用户登录/退出。
- 密码哈希校验。
- 会话签发与续期。
- 当前用户查询。
- App Token 刷新。

首版建议：

- Web 使用 HttpOnly Cookie Session。
- App 使用 Access Token + Refresh Token。
- 密码使用 `bcrypt` 或 `argon2`。

### 6.2 PermissionService：权限控制

建议角色：

| 角色 | 权限 |
| --- | --- |
| `admin` | 全部权限，包含用户、权限、删除、系统设置 |
| `operator` | 数据导入、主播维护、报告生成 |
| `viewer` | 只读查看仪表盘、榜单、报告 |
| `app_user` | App 基础查看权限 |

关键权限点：

- `anchor:read`
- `anchor:write`
- `anchor:delete`
- `data:import`
- `data:export`
- `report:read`
- `report:generate`
- `settings:write`
- `user:manage`

### 6.3 AnchorService：主播档案

对应当前能力：

- `getAnchors`
- `getFamilyTree`
- `addAnchor`
- `batchImportAnchors`
- `mergeAccounts`
- `deleteAnchors`
- `findDuplicateAnchors`
- `updateAnchorName`
- `updateAnchorInfo`
- `updateAnchorMaster`
- `getAnchorDailySnapshot`
- `saveAnchorDailySnapshot`
- `getAnchorWaveTrend`
- `getAnchorsWaveTrend`

### 6.4 DashboardService：仪表盘

对应当前能力：

- `getDashboardSummary`
- `getWaveRanking`
- `getWaveTrendByGender`
- `getWaveTrendTotal`
- `getAnchorCountTrend`

### 6.5 ImportService：导入与去重

对应当前能力：

- `getImportPreview`
- `importWave`
- `importDuration`
- `batchImportAnchors`

要求：

- 服务端统一校验 CSV 解析后的字段。
- 使用 `import_records` 防重复导入。
- 导入必须在事务中执行。
- 保存导入审计记录。
- 大文件导入后续可改为异步任务。

### 6.6 ExportService：导出

对应当前能力：

- `exportWave`
- `exportDuration`
- `exportAnchors`
- 图片/海报导出后续可接入对象存储。

### 6.7 ReportService：报告

对应当前能力：

- `getDailyWaveReport`
- `getTierRules`
- `saveTierRules`
- 日报图生成：首版可继续前端 Canvas 生成，后续服务端生成图片。

### 6.8 FlagService：流动红旗

对应当前能力：

- `getFlowingFlag`
- `getFlagGroups`
- `settleFlagScores`
- `getFlagWinner`

### 6.9 PkService：PK 名单

对应当前能力：

- `getPkRoster`

### 6.10 RewardService：奖励机制

对应当前能力：

- `getRewardReport`

---

## 7. API 设计

### 7.1 通用响应格式

```ts
export type ApiResponse<T> =
  | { success: true; data: T; requestId: string }
  | { success: false; error: { code: string; message: string; detail?: unknown }; requestId: string };
```

### 7.2 通用分页格式

```ts
export interface PageQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
```

### 7.3 认证 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/logout` | 退出 |
| `GET` | `/api/auth/me` | 当前用户 |
| `POST` | `/api/auth/refresh` | App 刷新 Token |

### 7.4 主播 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/anchors` | 主播列表 |
| `POST` | `/api/anchors` | 新增主播 |
| `GET` | `/api/anchors/:id` | 主播详情 |
| `PATCH` | `/api/anchors/:id` | 更新主播资料 |
| `DELETE` | `/api/anchors/:id` | 删除主播 |
| `POST` | `/api/anchors/batch-import` | 批量导入主播 |
| `POST` | `/api/anchors/merge-accounts` | 合并账号 |
| `GET` | `/api/anchors/duplicates` | 重复主播检查 |
| `GET` | `/api/anchors/:id/daily-snapshot` | 某日快照 |
| `PUT` | `/api/anchors/:id/daily-snapshot` | 保存某日快照 |
| `GET` | `/api/anchors/:id/wave-trend` | 主播音浪趋势 |

### 7.5 族谱 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/family-tree` | 获取族谱数据 |
| `PATCH` | `/api/anchors/:id/master` | 修改师父关系 |

### 7.6 仪表盘 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/dashboard/summary` | 概览统计 |
| `GET` | `/api/dashboard/wave-ranking?limit=10` | 音浪排行 |
| `GET` | `/api/dashboard/wave-trend-total` | 总音浪趋势 |
| `GET` | `/api/dashboard/wave-trend-by-gender` | 男女音浪趋势 |
| `GET` | `/api/dashboard/anchor-count-trend` | 主播数量趋势 |

### 7.7 导入 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/imports/preview` | 导入预检 |
| `POST` | `/api/imports/wave` | 导入音浪 |
| `POST` | `/api/imports/duration` | 导入时长 |
| `GET` | `/api/imports/records` | 导入记录 |

### 7.8 导出 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/exports/wave?date=YYYY-MM-DD` | 导出音浪 CSV |
| `GET` | `/api/exports/duration?date=YYYY-MM-DD` | 导出时长 CSV |
| `GET` | `/api/exports/anchors` | 导出主播 CSV |

### 7.9 报告 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/reports/daily-wave?date=YYYY-MM-DD&gender=all` | 每日音浪报告 |
| `GET` | `/api/reports/tier-rules` | 等级规则 |
| `PUT` | `/api/reports/tier-rules` | 保存等级规则 |

### 7.10 流动红旗 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/flags/groups?period=YYYY-MM` | 小组成绩 |
| `POST` | `/api/flags/settle` | 结算流动红旗 |
| `GET` | `/api/flags/winner?period=YYYY-MM` | 月度得主 |
| `GET` | `/api/flags/person/:personId` | 主播所属红旗信息 |

### 7.11 PK 与奖励 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/pk/roster?period=YYYY-MM&groupSize=8` | PK 名单 |
| `GET` | `/api/rewards/report?period=YYYY-MM` | 奖励报表 |

---

## 8. 统一 DataClient 设计

为避免页面直接依赖 Electron，建议新增统一接口：

```ts
export interface DataClient {
  getAnchors(): Promise<IpcResult<AnchorRow[]>>;
  getFamilyTree(): Promise<IpcResult<FamilyNode[]>>;
  getDashboardSummary(): Promise<IpcResult<DashboardSummary>>;
  getWaveRanking(limit?: number): Promise<IpcResult<WaveRankRow[]>>;
  importWave(date: string, rows: unknown[], meta?: ImportMeta): Promise<IpcResult<ImportResult>>;
  importDuration(date: string, rows: unknown[], meta?: ImportMeta): Promise<IpcResult<ImportResult>>;
  // 继续补齐当前 electronAPI 已有方法
}
```

实现两个适配器：

```text
ElectronDataClient：内部调用 window.electronAPI
HttpDataClient：内部调用 fetch('/api/**')
```

页面只使用：

```ts
const client = useDataClient();
const anchors = await client.getAnchors();
```

这样后续桌面端、Web、App 都能复用业务接口定义。

---

## 9. iOS App 设计

### 9.1 iOS App 首版功能

建议首版只做高频查看，不做复杂管理。

底部 Tab：

1. **首页**
   - 今日/最新数据日期
   - 总主播数
   - 总音浪
   - 总时长
   - 未开播数量
   - Top 10 排行

2. **主播**
   - 搜索主播
   - 按性别/师门/等级筛选
   - 主播详情
   - 音浪趋势
   - 时长趋势

3. **报告**
   - 每日报告
   - 流动红旗
   - PK 名单
   - 奖励报表

4. **我的**
   - 当前账号
   - 权限说明
   - 退出登录
   - 版本信息

### 9.2 iOS App 信息架构

```text
Login
  └── MainTabs
      ├── Home
      ├── Anchors
      │   └── AnchorDetail
      ├── Reports
      │   ├── DailyReport
      │   ├── FlagReport
      │   ├── PkRoster
      │   └── RewardReport
      └── Me
```

### 9.3 iOS App API 使用策略

- iOS App 只调用 HTTPS API，不直连数据库。
- Access Token / Refresh Token 存储在 Keychain。
- 列表接口必须分页。
- 报表接口支持按月份/日期懒加载。
- 图片分享优先使用服务端生成图片 URL，iOS 端通过系统 Share Sheet 分享。
- 网络层使用 `URLSession` + `async/await`，统一封装 `ApiClient`。
- 状态管理首版使用 SwiftUI `ObservableObject` / `@Observable`，复杂后再引入更完整架构。

---

## 10. 安全设计

### 10.1 服务器安全

- `.env` 只保存在服务器，不进入客户端包。
- MySQL 账号只允许服务器连接，禁止 App/浏览器直连。
- 所有写接口必须校验登录和权限。
- 所有导入接口必须限制文件大小和行数。
- 所有查询接口做分页和限流。
- 错误响应不返回 SQL、堆栈和数据库连接信息。

### 10.2 权限校验

建议每个 API 路由使用统一包装：

```ts
withApiHandler({
  permission: 'anchor:write',
  schema: UpdateAnchorSchema,
  handler: async ({ user, input }) => { ... }
})
```

### 10.3 审计日志

记录关键操作：

- 登录/退出
- 新增/修改/删除主播
- 合并账号
- 导入音浪/时长
- 保存等级规则
- 流动红旗结算
- 奖励结算导出
- 用户和权限变更

审计字段：

```text
id, user_id, action, resource_type, resource_id, payload_json, ip, user_agent, created_at
```

---

## 11. 部署设计

### 11.1 单机部署

适合第一阶段。

```text
Nginx
  ↓
Next.js Node Server
  ↓
MySQL
```

部署方式：

- Node.js 22 LTS
- `npm ci`
- `npm run build`
- `npm run start`
- PM2 或 systemd 保活
- Nginx 反向代理 + HTTPS

### 11.2 Docker 部署

适合后续标准化。

```text
docker-compose
  ├── app: Next.js
  ├── mysql: 可选，若使用外部 MySQL 可不启
  └── redis: 可选，用于缓存/队列
```

### 11.3 环境变量

```env
NODE_ENV=production
APP_URL=https://your-domain.com

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=douyin_app
DB_PASSWORD=***
DB_NAME=douyin

SESSION_SECRET=***
JWT_SECRET=***
UPLOAD_MAX_MB=20
```

---

## 12. 数据迁移设计

### 12.1 保留现有表

第一阶段不重建核心业务表，降低风险。

### 12.2 补充迁移脚本

建议新增：

```text
migrations/
  001_create_auth_tables.sql
  002_create_audit_logs.sql
  003_create_files.sql
  004_add_indexes.sql
```

### 12.3 索引建议

重点索引：

```sql
CREATE INDEX idx_accounts_person_id ON accounts(person_id);
CREATE INDEX idx_wave_date ON wave_snapshots(import_date);
CREATE INDEX idx_wave_anchor_date ON wave_snapshots(anchor_id, import_date);
CREATE INDEX idx_duration_date ON duration_snapshots(import_date);
CREATE INDEX idx_duration_anchor_date ON duration_snapshots(anchor_id, import_date);
CREATE INDEX idx_persons_master_id ON persons(master_id);
CREATE INDEX idx_import_records_kind_date ON import_records(kind, import_date);
```

---

## 13. 迁移路线图

### 阶段 0：设计与盘点

产物：

- 本设计文档。
- 当前 Electron API 清单。
- 当前 MySQL 表结构清单。
- 页面与 API 映射表。

### 阶段 1：抽离服务层

目标：不改变页面体验，先把 `electron/db.js` 中的业务逻辑搬到 `src/server/services`。

任务：

1. 新建 `src/server/db/pool.ts`。
2. 新建 `src/server/services/*`。
3. Electron `db.js` 改为调用服务层。
4. 保持桌面端功能不变。

验收：

- `npm run lint` 通过。
- 桌面端现有页面可正常加载。
- 导入、导出、报告核心流程可用。

### 阶段 2：建立 HTTP API

目标：让浏览器可在无 Electron 环境下使用。

任务：

1. 新建 `/api/dashboard/**`。
2. 新建 `/api/anchors/**`。
3. 新建 `/api/family-tree`。
4. 新建 `/api/reports/**`。
5. 建立统一响应格式和错误处理。

验收：

- `npm run build` 通过。
- 浏览器访问 Web 页面不再显示 Electron 不可用。
- 主要查询页可通过 HTTP API 获取数据。

### 阶段 3：统一 DataClient

目标：页面不再直接调用 `window.electronAPI`。

任务：

1. 新建 `DataClient` 接口。
2. 实现 `ElectronDataClient`。
3. 实现 `HttpDataClient`。
4. 修改 `useElectronData` 为 `useDataClientQuery` 或兼容包装。
5. 逐页替换直接调用。

验收：

- 桌面端和 Web 端共用同一页面。
- 无 Electron 环境下页面可用。

### 阶段 4：登录、权限、审计

目标：服务器正式可对外部署。

任务：

1. 新增用户表和角色表。
2. 实现登录/退出。
3. API 加权限校验。
4. 写操作加审计日志。
5. Nginx + HTTPS 部署。

验收：

- 未登录不能访问后台数据。
- viewer 不能导入/删除。
- admin 可以管理用户和权限。

### 阶段 5：iOS App 首版

目标：可在 iPhone 查看核心数据。

任务：

1. 创建 SwiftUI iOS 项目。
2. 封装 `ApiClient`、Token 刷新和 Keychain 存储。
3. 接入登录。
4. 首页、主播列表、主播详情。
5. 每日报告、PK、流动红旗、奖励报表。
6. 通过 TestFlight 或本地签名打包测试版。

验收：

- 手机可登录。
- 数据与 Web/桌面端一致。
- 弱网下有加载、错误、重试体验。

### 阶段 6：增强能力

可选增强：

- 服务端图片生成。
- 异步导入任务队列。
- Redis 缓存热门报表。
- App 推送通知。
- 多租户/多团队。
- 自动备份和恢复。

---

## 14. 风险与应对

| 风险 | 表现 | 应对 |
| --- | --- | --- |
| Electron 逻辑过重 | `electron/db.js` 体积大，迁移容易漏 | 先写 API 清单和测试用例，按模块搬迁 |
| 页面强依赖 `window.electronAPI` | Web 环境报不可用 | 引入 `DataClient` 适配层 |
| 导入逻辑破坏数据 | 重复导入、错误覆盖 | 事务 + 预检 + import_records + 审计 |
| 权限缺失 | App/Web 暴露敏感操作 | 默认登录、默认最小权限 |
| SQL 性能问题 | 排行榜/报表慢 | 补索引、分页、必要时缓存 |
| App 功能膨胀 | 首版周期过长 | 首版只做查看，不做复杂导入 |
| 多端结果不一致 | 桌面/Web/App 算法不同 | 所有计算收敛到服务端 Service |

---

## 15. 首批开发任务清单

建议从下面任务开始：

1. **建立文档目录**
   - `docs/server-and-app-design.md`
   - `docs/api-design.md`
   - `docs/migration-plan.md`

2. **生成 Electron API 清单**
   - 从 `electron/preload.js` 和 `electron/main.js` 提取当前所有接口。
   - 标注查询/写入/导入/导出/桌面专用。

3. **建立服务端基础设施**
   - `src/server/db/pool.ts`
   - `src/server/api/response.ts`
   - `src/server/api/errors.ts`
   - `src/server/services/dashboard-service.ts`

4. **优先迁移查询接口**
   - `getDashboardSummary`
   - `getWaveRanking`
   - `getWaveTrendTotal`
   - `getAnchors`
   - `getFamilyTree`

5. **新增 HTTP API**
   - `/api/dashboard/summary`
   - `/api/dashboard/wave-ranking`
   - `/api/anchors`
   - `/api/family-tree`

6. **改造前端数据调用**
   - 新增 `DataClient`。
   - `useElectronData` 改为兼容 `DataClient`。
   - 先改仪表盘，再改主播列表。

---

## 16. 建议的验收标准

服务器端第一版完成时，应满足：

- 可以通过浏览器访问部署在服务器上的后台。
- 登录后可查看仪表盘、主播列表、族谱、日报、PK、奖励报表。
- 主要查询接口响应时间在可接受范围内。
- 桌面端原有能力不被破坏。
- `.env` 敏感信息不进入前端 bundle。
- 写操作有权限校验和审计日志。
- 至少有一份部署说明和回滚说明。

App 第一版完成时，应满足：

- 可登录/退出。
- 可查看首页概览、主播搜索、主播详情。
- 可查看每日报告、PK 名单、流动红旗、奖励报表。
- API 失败有明确提示和重试。
- Token 过期可刷新或重新登录。

---

## 17. 当前项目改造建议结论

推荐路线：

```text
先在当前 Next.js 项目内服务端化
→ 抽离 Service 层
→ 提供 HTTP API
→ Web 端跑起来
→ 桌面端切换到 HTTP API
→ 创建 SwiftUI iOS App
```

不建议一开始就新建完全独立后端并重写所有页面，因为当前项目已有 Next.js 和大量 React 业务页面，直接服务端化迁移成本更低、风险更小。

下一步最适合做的是：

1. 提取 `electron/preload.js` 的接口清单，生成 `docs/electron-api-inventory.md`。
2. 创建服务器版本的 API 入口和 HTTP 数据适配器。
3. 优先复用现有 `electron/db.js` 作为过渡服务层，快速跑通网页服务器版本。
4. 让仪表盘在无 Electron 环境下也能读取服务器数据。
5. 后续再把 `electron/db.js` 中的业务逻辑逐步迁移到 `src/server/services/*`。
