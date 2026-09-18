# 3328 后端设计文档

> 项目：抖音主播数据管理（星嗨艺创 男团 / 薇笑传媒 女队）
> 基线分支：`615`　｜　改造分支：`3328`
> 版本：v0.1（设计稿，未落代码）
> 日期：2026-09-18

---

## 0. 一句话结论（不想读全文的话）

**选 Go。** 不是因为 Go 在所有维度最好，而是因为在这个项目的**硬约束**（RK3318 arm64 盒子 / Docker / 长驻 bot 进程 / 单人到小团队维护 / 现有全是 TypeScript）下，Go 的综合总账最划算。Rust 是技术上的次优但工程上的次选，Java 直接出局。

导出图片这块唯一必须守住的底线是「视觉上与 615 一致」，这跟用什么语言写后端**没有绑定关系**——它对应的正解是「模板 + 主题常量 + 像素级回归测试」，不是一个语言特性。第 7 章细说。

---

## 1. 背景与目标

### 1.1 现状（615 分支）资产盘点

| 维度 | 615 现状 |
|---|---|
| 形态 | Next.js + Electron 一体化，业务逻辑大量写在 Electron 主进程（`electron/*.js`，约 1.5 万行） |
| 数据库 | 远程 MySQL（`mysql7.sqlpub.com:3312`，库 `douyinxs`） |
| 核心表 | `persons` / `accounts` / `wave_snapshots` / `duration_snapshots` / `tier_rules` / `flag_scores` / `flag_winners` / `import_records` |
| IM 通道 1 | 微信 iLink（`electron/weixin-bot.js` 2405 行 + `shared/ilink-adapter.js`） |
| IM 通道 2 | QQ 官方机器人（`electron/qq-bot.js` 856 行 + `shared/qqbot-adapter.js`，WS + OpenAPI） |
| 图片导出 | 两条链路：桌面端 `html-to-image` DOM→PNG；服务端（bot 用）手写 SVG 字符串 → `sharp` 转 PNG |
| 部署 | 本地 Electron 桌面为主 + 服务器 `bot-worker` |

### 1.2 615 的四个真问题

1. **没有后端。** Electron 主进程既是 UI 宿主又是服务端，bot 跑在客户端里——关掉窗口 bot 就停，OTA 更新会中断推送。这个 Product Hard Constraint（`CLAUDE.md`）已经写死了：桌面不该是唯一运行态。
2. **数据库是远程公共 MySQL。** 主数据在别人机器上，延迟不可控、无备份掌控权。
3. **导出样式散落在字符串拼接里。** `weixin-bot-report.js` 把配色、尺寸、文案、业务逻辑糊在一个函数里，改一个颜色要读 300 行。
4. **日/月/年指标全是每次查询时现场算的。** 目前报表能跑是因为数据小，但「月音浪 / 月直播时长 / 年度汇总」这三个用户明确要的一等公民指标没有物化，重跑和历史回溯全靠临时 SQL。

### 1.3 3328 目标

- **前后端分离**：后端是一套独立的、可部署的服务；前端（Web + Electron 壳）只通过 HTTP API 说话，不再直接摸数据库。
- **主播信息管理**：人→账号一对多，账号是抖音维度的采集单元。
- **四类指标成为一等公民**：日音浪 / 月音浪 / 月直播时长 / 年度汇总。
- **双 bot 系统**：微信 iLink + QQ 官方机器人，共用同一套 Agent 与技能。
- **导出图片样式与 615 完全一致**（这是验收红线，见第 7 章）。

### 1.4 非目标（本次不做）

- 不做多租户 / SaaS。
- 不做实时大盘 WebSocket 推送链路（保留接口，二期）。
- 不重写 `DouyinLang` 采集端协议（继续作为外部数据源，通过导入 API 喂数据）。

---

## 2. 技术选型：Go vs Java vs Rust

### 2.1 先把约束摆出来（这些约束决定答案，不是偏好）

| # | 约束 | 来源 | 权重 |
|---|---|---|---|
| C1 | 部署目标是 **RK3318 arm64 盒子**，Docker 运行，内存通常在 1–4GB | `skills/rk3318-docker-deploy` | 极高 |
| C2 | 服务要 7×24 长驻，跑两个 IM 长连接 + 多个定时器任务 | 业务本质 | 极高 |
| C3 | 维护者是个人/超小团队，现有代码栈全 TypeScript | 现实 | 高 |
| C4 | 数据规模极小：主播 <200 人，日快照 <200 行/天，年增量 <8 万行 | 业务 | 高（→性能不是选型理由） |
| C5 | 必须导出 PNG，且像素风格要对齐现有 SVG 模板 | 用户明确要求 | 高 |
| C6 | 开发机是 Windows，交付是 Linux arm64 | 现实 | 中 |

**C1 + C6 基本就把 Java 判了死刑，C3 基本把 Rust 打到第二位。**

### 2.2 逐项对比

#### ① 部署到 RK3318 arm64（权重最高）

| | Go | Java | Rust |
|---|---|---|---|
| 交叉编译 | `GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build`，一行命令，20 秒 | 需装 arm64 JDK/JRE，或用 buildx 多阶段包 JVM | 需 `cross`/musl target，`cargo build --target aarch64-unknown-linux-musl` + 配 linker，新环境常卡 1 小时以上 |
| 产出物 | 单个静态二进制 ~15MB | JAR 30MB **+ JRE 180MB** | 单个静态二进制 ~10MB |
| 镜像体积 | scratch/alpine，**~20MB** | eclipse-temurin，**~220MB** | scratch/alpine，**~15MB** |
| 常驻 RSS | **25–80MB** | 200–400MB（还没算 GC headroom） | 20–60MB |
| 冷启动 | <100ms | 3–8s（JVM 预热） | <100ms |

Go 和 Rust 打平且都极优。Java 在 1GB 内存的盒子上是**负资产**——光 JVM 就吃掉四分之一的内存，剩下给渲染 chromium + MySQL 连接池的空间会被挤压到触发 OOM。这个结论不需要讨论。

#### ② 业务适配度（两个长连接 + 一批定时器 + HTTP/JSON）

本项目的 bot 负载画像：WS 长连接保活、HTTP 轮询、每天定时任务、大量 JSON 解析、几乎零 CPU 密集计算。

- **Go**：`goroutine` + `select` + `context` + `time.Ticker` 是这套模式的母语。一个 bot = 一个 goroutine + 一个 context 树，取消/超时/重连写起来是直的。**天然对口。**
- **Rust**：tokio 能做到同样的事（甚至内存更省），但你要为每一个 API 响应手搓 `#[derive(Deserialize)]` struct，为每一处共享状态对付 `Arc<Mutex<T>>` 和生命周期。 **性能冗余换来的是开发时的净摩擦**——而本项目数据量是「每天 200 行」，这点性能根本兑现不成价值。
- **Java**：Spring WebFlux / Netty 能跑，但项目规模不需要企业级容器带来的那一整套，反而是负担。

#### ③ 图片导出 / SVG 渲染

这是唯一可能反转结论的一项，必须说清楚：

| 方案 | Go | Java | Rust |
|---|---|---|---|
| 纯 SVG 渲染器 | `librsvg` cgo 绑定 / 调外部 `resvg` 二进制；纯 Go 的 `svgo` 只生成不渲染 | Apache Batik（老，CSS3 支持残缺） | **resvg：事实标准，纯 Rust 无依赖，arm64 编译干净，保真度最高** |
| Headless 浏览器 | `chromedp` / `rod` 成熟 | Playwright / Selenium 成熟 | `chromiumoxide`、`headless_chrome`（可用但社区小） |
| 中文字体 + emoji 🥇🥈🥉 | 走浏览器方案无敌；纯 SVG 渲染需预装 Noto Color Emoji | 同 Go | resvg 依赖系统 fontconfig + 装对字体 |
| HTML/CSS 直接截图 | 支持 | 支持 | 勉强 |

**Rust 在这一项是唯一技术优势。** 但请注意两件事：

1. **这项优势可以画出来。** 无论后端用 Go 还是 Rust，都可以把渲染做成一个独立 sidecar 容器（`resvg-cli` / headless chromium），后端通过 HTTP 或 gRPC 调它。也就是说 resvg 的好处**不需要用 Rust 写后端也能拿到**。
2. **615 的模板里有 emoji 奖牌和中文字体**，浏览器渲染方案的保真度反而是最高的（见第 7 章结论：主路径走 headless chromium）。这进一步削弱了 Rust 的差异化。

#### ④ 团队与迭代成本

| | Go | Java | Rust |
|---|---|---|---|
| 从 TypeScript 转过来的学习曲线 | 低（1–2 周能写生产 code） | 中（语言简单，生态重） | **高（所有权/生命周期/异步心智，1–3 个月才不卡手）** |
| 编译反馈周期 | 秒级 | 慢（增量构建 + JVM 重启） | **分钟级**（冷构建 5–15 分钟） |
| 单人长期维护风险 | 低：语法收敛，5 年前的代码今天还能读 | 中：框架版本漂移 | 中：async 生态版本分裂 + 依赖树编译 |

对一个「主播数据 + bot 推送」的工具项目，**迭代速度的价值远大于运行时性能**。这是选型的核心经济学。

#### ⑤ 生态

| 需求 | Go | Java | Rust |
|---|---|---|---|
| MySQL 驱动 | 官方 `database/sql` + go-sql-driver，**成熟稳定** | JDBC，极致成熟 | `sqlx` / `diesel`，可用但 compile-time 宏较重 |
| WebSocket 客户端 | gorilla/websocket、nhooyr，成熟 | Netty，成熟 | tokio-tungstenite，成熟 |
| 定时任务 | robfig/cron，标准答案 | Quartz（过重） | tokio-cron-scheduler（小众） |
| 配置/日志/ORM | viper / zap / GORM 或 sqlc，**推荐 sqlc** | Spring 全家桶 | tracing / sea-orm（较新） |

Go 在这个需求集合上没有短板。

### 2.3 打分表

权重基于 2.1 的约束赋值，10 分制。

| 维度 | 权重 | Go | Java | Rust | 加权 Go | 加权 Java | 加权 Rust |
|---|---|---|---|---|---|---|---|
| arm64 部署成本 | 25% | 10 | 2 | 8 | 2.50 | 0.50 | 2.00 |
| 长驻服务适应性 | 15% | 10 | 7 | 9 | 1.50 | 1.05 | 1.35 |
| 团队迭代效率 | 25% | 9 | 6 | 4 | 2.25 | 1.50 | 1.00 |
| 图片渲染能力 | 15% | 7 | 6 | 10 | 1.05 | 0.90 | 1.50 |
| 生态/库完备度 | 10% | 9 | 10 | 7 | 0.90 | 1.00 | 0.70 |
| 长期维护风险 | 10% | 9 | 7 | 7 | 0.90 | 0.70 | 0.70 |
| **总分** | 100% | | | | **9.10** | **5.65** | **7.25** |

### 2.4 结论

**推荐 Go 1.24+（Go 语言写后端业务），理由排序：**

1. **部署约束是硬约束**：目标是 RK3318 arm64 盒子。Go 的「一个静态二进制扔进 scratch 镜像」在这个场景下没有对手。Java 直接出局。
2. **负载画像完美对口**：长连接 + 定时器 + JSON，没有 CPU 密集部分，Go 的并发模型就是为此设计的。
3. **团队转型成本最低**：现有栈 TypeScript → Go 的迁移成本远低于 → Rust。项目要的是可维护性，不是 benchmark 数字。
4. **导出图片这项最重的活不跟语言绑定**：用 sidecar 渲染解决，Go 调用即可。为了 resvg 而把整个后端写成 Rust，是典型的「用战术优势换战略劣势」。

**什么时候应该改选 Rust：** 如果未来导出图 QPS 高到成为瓶颈（例如要给几百个群同时出图），或者渲染必须纯内存无浏览器依赖地跑在 512MB 设备上——那才值得把 `render` 服务单独用 Rust + resvg 重写。**到时候它是个独立模块，换掉它不影响主服务。** 这也是本设计把它拆成 sidecar 的原因：保留这个后悔的机会，且成本很低。

**为什么不选 Java：** 没有一项是 Java 领先的，而在权重最高的部署维度它是灾难。不推荐。

---

## 3. 架构总览

### 3.1 前后端分离拓扑

```
┌──────────────────────────────────────────────────────────────┐
│ 客户端层                                                      │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────────┐   │
│  │  Web 前端   │  │ Electron壳 │  │ 移动端/浏览器         │   │
│  │ (Next.js)  │  │ (复用Electron │  │                      │   │
│  └─────┬──────┘  └──────┬─────┘  └──────────┬───────────┘   │
└────────┼─────────────────┼───────────────────┼───────────────┘
         └─────────────────┴───────────────────┘
                           │  HTTPS / JSON  (唯一通道)
┌──────────────────────────▼───────────────────────────────────┐
│ 后端服务  dy-manager-server  (Go, 单个二进制, ~15MB)          │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ interface/http    REST API (chi) + OpenAPI + JWT        │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ application      Service 层（用例编排，事务边界）        │ │
│ │   personSvc │ metricSvc │ reportSvc │ exportSvc │ botSvc│ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ domain          实体 + 领域规则（tier/未播/日差分）      │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ infra   mysql │ cache │ httpclient │ clock │ idgen      │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ bots   transport抽象 ├─ ilink(微信) ├─ qqbot(QQ)         │ │
│ │       intent parser │ skill registry │ scheduler         │ │
│ └─────────────────────────────────────────────────────────┘ │
└───────────┬──────────────────────┬──────────────────┬────────┘
            │                      │                  │
   ┌────────▼────────┐   ┌─────────▼────────┐  ┌──────▼───────┐
   │ MySQL 8         │   │ render-sidecar   │  │ 对象存储/本地 │
   │ (主数据源)      │   │ headless chromium│  │ artifact FS  │
   └─────────────────┘   └──────────────────┘  └──────────────┘
```

### 3.2 单一二进制内分层（不拆微服务，理由见下）

**决策：不做微服务。** 单机 ARM 盒子上拆服务只会徒增运维和内存开销。采用「**一个二进制 + 清晰的内部分层 + 可独立启停的模块开关**」：

| 模块 | 开关 | 说明 |
|---|---|---|
| `api` | 常开 | HTTP REST |
| `bot:weixin` | 可关 | 微信 iLink bot |
| `bot:qq` | 可关 | QQ 官方 bot |
| `scheduler` | 可关 | 定时推送/结算 |
| `worker:import` | 常开 | 导入与聚合（也可独立进程 `PROJECT_BOTS=0` 模式跑） |

这直接对应 615 里 `PROJECT_BOTS=0` 的用法习惯，团队不用改心智。

### 3.3 依赖清单（Go）

| 用途 | 选库 | 理由 |
|---|---|---|
| HTTP 路由 | `go-chi/chi/v5` | 轻量，标准 `http.Handler` 兼容，不做重型框架 |
| SQL 访问 | **`sqlc` 生成代码 + `database/sql`** | **不用 GORM**。sqlc 编译期生成类型安全代码，无反射，arm64 上零开销，且 SQL 完全可控（后面很多聚合 SQL 要靠写，ORM 反而碍事） |
| MySQL 驱动 | `go-sql-driver/mysql` | 事实标准 |
| 迁移 | `golang-migrate/migrate` | 版本号管理的 SQL 迁移文件，和 `migrations/001~004` 习惯一致 |
| 配置 | `caarlos0/env` + 可选 `viper` | 环境变量优先，Docker 友好 |
| 日志 | `log/slog`（标准库，Go 1.21+） | 不再引入第三方 |
| 定时 | `robfig/cron/v3` | 标准答案 |
| WS 客户端 | `gorilla/websocket` | QQ bot 用 |
| HTTP 客户端 | `net/http` + 自封装重试/限流 | iLink 轮询用 |
| 图片渲染 | `chromedp`（主）/ 外部 `resvg`（备选） | 见第 7 章 |
| 图片后处理 | **`bimg`（libvips binding）** | 对齐 615 用的 sharp——sharp 底层就是 libvips，**这是保证像素管线一致的关键** |
| 校验 | `go-playground/validator/v10` | API 入参校验 |
| 测试 | 标准库 + `testcontainers-go` | 集成测试用真 MySQL |

> ⚠️ **`bimg`/`chromedp` 需要 CGO 或外部依赖。** 若选用 headless chromium sidecar（推荐主路径），后端本体可保持 `CGO_ENABLED=0` 的纯静态二进制——这对 arm64 部署非常重要。第 7 章详述。

---

## 4. 数据模型设计

### 4.1 设计原则

1. **原始快照 = 事实来源（不可变）**。采集到的值永远不被覆盖改写，只增。
2. **派生指标 = 物化（可重算）**。日/月/年三层全部物化，但同时保留「按主播+月份全量重算」的能力，保证物化表永远不会脏到无法修复。
3. **所有指标冗余 `person_id`**。因为 `person → account` 是一对多，主播可能换号；按人聚合才是业务口径，按账号聚合只是采集口径。
4. **每个批次有 `batch_id`**，用于幂等与追溯。

### 4.2 ER 概览

```
person ─1:N─> account ─1:N─> wave_snapshot    (原始：累计音浪)
                      └─1:N─> duration_snapshot(原始：累计时长)
                              │
                    【差分物化】│
                              ▼
                      daily_metric           (日音浪/日时长/昨日快照/是否开播)
                              │ 按月聚合
                              ▼
                      monthly_metric         (月音浪/月时长/开播天数)
                              │ 按年聚合
                              ▼
                      yearly_metric          (年度汇总)
```

### 4.3 表定义

#### `person` — 人（业务主体）

改造自 615 的 `persons`，补齐软删除与状态。

```sql
CREATE TABLE person (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name                 VARCHAR(64)  NOT NULL DEFAULT '',
  gender               ENUM('male','female','unknown') NOT NULL DEFAULT 'unknown',
  master_id            BIGINT UNSIGNED NULL COMMENT '所属师傅（自引用）',
  generation           INT NULL COMMENT '第几代徒弟',
  group_name           VARCHAR(64) NULL COMMENT '所属团队/分组',
  avatar_url           VARCHAR(512) NULL COMMENT '头像（每日之星图要用）',
  hide_in_daily_report TINYINT(1) NOT NULL DEFAULT 0,
  status               ENUM('active','left','paused') NOT NULL DEFAULT 'active',
  joined_at            DATE NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at           DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_master (master_id),
  KEY idx_status_gender (status, gender)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> 变化点：增加 `avatar_url`（615 的每日之星图要画头像，之前靠临时 URL，现在要固化）、`group_name`、`status`、软删除。`gender` 从 varchar 改成 enum。**注意：性别是导出的分流开关**（详见 7.2 样式路由规则），必须干净。

#### `account` — 抖音账号（采集单元）

```sql
CREATE TABLE account (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  person_id    BIGINT UNSIGNED NOT NULL,
  anchor_id    VARCHAR(64)  NOT NULL COMMENT '抖音采集 ID（唯一键）',
  douyin_no    VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '抖音号（展示用）',
  anchor_name  VARCHAR(128) NOT NULL DEFAULT '',
  is_primary   TINYINT(1)   NOT NULL DEFAULT 0,
  status       ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_anchor (anchor_id),
  KEY idx_person (person_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### `import_batch` — 导入批次（幂等基石）

```sql
CREATE TABLE import_batch (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_date      DATE NOT NULL COMMENT '数据归属日期',
  source        ENUM('douyinlang','manual','backfill','api') NOT NULL,
  status        ENUM('running','succeeded','failed') NOT NULL DEFAULT 'running',
  row_count     INT NOT NULL DEFAULT 0,
  operator      VARCHAR(64) NOT NULL DEFAULT '',
  error_text    TEXT NULL,
  started_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at   DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_date_status (biz_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### `wave_snapshot` / `duration_snapshot` — 原始快照（不可变）

```sql
CREATE TABLE wave_snapshot (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  anchor_id   VARCHAR(64) NOT NULL,
  person_id   BIGINT UNSIGNED NOT NULL,
  biz_date    DATE NOT NULL,
  wave_value  BIGINT NOT NULL DEFAULT 0 COMMENT '平台累计总音浪（快照值）',
  rank_in_guild INT NULL COMMENT '榜内排名（615 的 rank 字段）',
  batch_id    BIGINT UNSIGNED NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_wave (anchor_id, biz_date),
  KEY idx_person_date (person_id, biz_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE duration_snapshot (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  anchor_id         VARCHAR(64) NOT NULL,
  person_id         BIGINT UNSIGNED NOT NULL,
  biz_date          DATE NOT NULL,
  cumulative_minutes INT NOT NULL DEFAULT 0 COMMENT '平台累计直播分钟数（快照值）',
  batch_id          BIGINT UNSIGNED NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_dur (anchor_id, biz_date),
  KEY idx_person_date (person_id, biz_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### ⭐ `daily_metric` — 日粒度物化（核心新增）

```sql
CREATE TABLE daily_metric (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  person_id     BIGINT UNSIGNED NOT NULL,
  anchor_id     VARCHAR(64) NOT NULL,
  biz_date      DATE NOT NULL,

  wave            BIGINT NOT NULL DEFAULT 0 COMMENT '日音浪 = 当前累计 - 上次累计',
  cumulative_wave BIGINT NOT NULL DEFAULT 0 COMMENT '当天累计总音浪（快照原值）',
  prev_snapshot_date DATE NULL COMMENT '上一次快照日期，用于判定差分跨度',
  wave_span       SMALLINT NOT NULL DEFAULT 1 COMMENT '差分跨越天数；>1 表示中间漏采',
  wave_reliable   TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0=漏采导致日音浪不可信',

  minutes           INT NOT NULL DEFAULT 0 COMMENT '当日直播分钟数（差分）',
  cumulative_minutes INT NOT NULL DEFAULT 0,
  minutes_span      SMALLINT NOT NULL DEFAULT 1,
  minutes_reliable  TINYINT(1) NOT NULL DEFAULT 1,

  is_live       TINYINT(1) NOT NULL DEFAULT 0 COMMENT '当日是否开播',
  tier          CHAR(1) NULL COMMENT '当日等级快照，导出直接读，不再算',
  source_batch_id BIGINT UNSIGNED NULL,
  recomputed_at DATETIME(3) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_person_date (person_id, biz_date),
  KEY idx_date (biz_date),
  KEY idx_date_wave (biz_date, wave DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**这张表是本次改造的核心。** 615 每次导出都要现场 JOIN 两天的快照算差值，这里一次性算完落表，导出只读单表。

#### ⭐ `monthly_metric` — 月粒度物化（用户明确要求：月音浪 + 月直播时长）

```sql
CREATE TABLE monthly_metric (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  person_id     BIGINT UNSIGNED NOT NULL,
  period        CHAR(7) NOT NULL COMMENT 'YYYY-MM',

  wave          BIGINT NOT NULL DEFAULT 0 COMMENT '月音浪',
  minutes       INT    NOT NULL DEFAULT 0 COMMENT '月直播时长（分钟）',
  formatted_duration VARCHAR(16) NOT NULL DEFAULT '' COMMENT '如 "128h30m"，导出直接渲染',

  live_days     SMALLINT NOT NULL DEFAULT 0 COMMENT '当月开播天数',
  absent_days   SMALLINT NOT NULL DEFAULT 0 COMMENT '当月未开播天数',
  best_day_wave BIGINT NOT NULL DEFAULT 0,
  best_day_date DATE NULL,
  avg_wave_per_live_day BIGINT NOT NULL DEFAULT 0,
  tier          CHAR(1) NULL COMMENT '月等级（按月音浪套 tier_rule）',
  unreliable_days SMALLINT NOT NULL DEFAULT 0 COMMENT '因漏采不可信的天数',

  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_person_period (person_id, period),
  KEY idx_period_wave (period, wave DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### ⭐ `yearly_metric` — 年度汇总（用户明确要求）

```sql
CREATE TABLE yearly_metric (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  person_id      BIGINT UNSIGNED NOT NULL,
  year           SMALLINT NOT NULL,

  wave           BIGINT NOT NULL DEFAULT 0 COMMENT '全年总音浪',
  minutes        INT    NOT NULL DEFAULT 0 COMMENT '全年总时长（分钟）',
  formatted_duration VARCHAR(16) NOT NULL DEFAULT '',

  live_days      SMALLINT NOT NULL DEFAULT 0,
  active_months  SMALLINT NOT NULL DEFAULT 0 COMMENT '有开播记录的月数',
  best_month     CHAR(7) NULL,
  best_month_wave BIGINT NOT NULL DEFAULT 0,
  best_day_wave  BIGINT NOT NULL DEFAULT 0,
  best_day_date  DATE NULL,
  avg_month_wave BIGINT NOT NULL DEFAULT 0,
  tier           CHAR(1) NULL COMMENT '年度等级',
  year_rank      INT NULL COMMENT '年度榜排名（任务刷新）',

  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_person_year (person_id, year),
  KEY idx_year_wave (year, wave DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### 其余表

- `tier_rule`（沿用 615 的 `tier_rules`：label / min_wave / sort_order，默认 A50万 / B20万 / C5万 / D0）——**并新增 `scope` 字段**，因为日/月/年三个粒度可能要不同阈值。
- `flag_score` / `flag_winner`（流动红旗，沿用）
- `pk_group` / `pk_group_member`（PK 分组，615 里分组结果存快照，这里正规化）
- bot 侧：`ilink_account` / `ilink_cursor` / `bot_lease` / `inbox_message` / `outbox_message` / `artifact`

### 4.4 ⚠️ 差分计算的坑与规则（必须写进实现）

**坑的根源**：平台给的是**累计值**，日音浪要靠差分。一旦漏采一天，差分就会把两天的量算到一天头上，月榜立刻失真。

规则（写进 `metricSvc.rebuildDaily`）：

| 情况 | `prev_snapshot_date` | `wave_span` | `wave_reliable` | `wave` 取值 |
|---|---|---|---|---|
| 首条快照（无历史） | NULL | 1 | 1 | 0（不把累计值当单日） |
| 连续（gap = 1 天） | 前一天 | 1 | 1 | `cur.cum - prev.cum` |
| 漏采（gap = N > 1 天） | 上一次日期 | N | **0** | `cur.cum - prev.cum`，标记为区间增量 |
| 出现负增量（平台回退/换号） | 上一次日期 | N | **0** | 0，并写入 `data_anomaly` 待人工处理 |

**月/年聚合时的处理**：
- `monthly_metric.wave` = `SUM(daily.wave) WHERE reliable=1`　**加**　不可信天的 `SUM(wave)`（量必须加回去，否则月音浪会少）
- 同时把 `unreliable_days` 计数写到表上，导出时可在页脚标注「含 N 天补采数据」
- **`is_live` 判定**：`daily.minutes > 0` 且 `daily.wave >= 0`；与 615 的 `notLiveDays` 口径保持一致（连续未开播天数要能累加）

**重算 API**：`POST /internal/recompute {scope: person|all, period}`。因为单人单月只有 31 行，全量重算成本 < 5ms×31，完全可以接受。**物化表脏了随时重建，这是本设计敢物化的底气。**

### 4.5 MySQL vs 本地库

| 选项 | 结论 |
|---|---|
| 沿用远程 MySQL | ❌ 不推荐作为主库：延迟不可控、无备份掌控权、bot 长连接会频繁打远程库 |
| **PostgreSQL 本地容器** | ⚠️ 技术上更优（窗口函数写 `# 日主管部门// shift-3 snap_diff` 一行搞定：`LAG(cum) OVER (PARTITION BY anchor ORDER BY date)`），但要在 RK3318 上多养一个 ~200MB 的进程 |
| **MySQL 8 本地容器** | ✅ **推荐**：与现有 schema/SQL 习惯、迁移脚本完全兼容，迁移成本最低；MySQL 8.0 也支持窗口函数，4.4 的差分同样可以一条 SQL 写完 |

**决策：MySQL 8，容器化部署在盒子上，从远端库一次性导入历史数据。** 保留 PDO 风格的连接池配置，便于日后切回托管 RDS。

> **并且**：差分逻辑虽然能用窗口函数，但**推荐在 Go 里实现**，理由是可测试、可埋点异常、方便 repaire 流程。SQL 只做批量读取。

---

## 5. API 设计

### 5.1 约定

- 前缀 `/api/v1`，JSON，UTF-8
- 时间一律 ISO-8601 字符串（避免时区踩坑）；日期用 `YYYY-MM-DD`
- **金额/音浪统一传 `int64` 的字符串形式返回**（`"1280000"`），避免 JS `number` 精度丢失——615 的 TS 前端踩过这类坑
- 分页：`cursor` + `limit`（不用 offset，数据会变）
- 鉴权：管理端 JWT；bot 回调走 HMAC 签名校验
- 错误体统一：`{ "error": { "code": "TIER_NOT_FOUND", "message": "...", "trace_id": "..." } }`

### 5.2 端点清单

**主播/账号**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/persons` | 列表，支持 `?gender=&status=&master_id=&hide=` |
| POST | `/api/v1/persons` | 新建主播 |
| GET | `/api/v1/persons/{id}` | 详情（含账号、当月/当年汇总） |
| PATCH | `/api/v1/persons/{id}` | 改资料 |
| DELETE | `/api/v1/persons/{id}` | 软删除 |
| GET/POST/PATCH/DELETE | `/api/v1/persons/{id}/accounts` | 绑定账号 |
| POST | `/api/v1/persons/{id}/merge` | 合并主播（并号，触发全量重算） |

**指标查询**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/metrics/daily?date=2026-09-18&gender=male` | 日榜（导出日报的数据源） |
| GET | `/api/v1/metrics/monthly?period=2026-09` | 月榜（月音浪 + 月时长） |
| GET | `/api/v1/metrics/yearly?year=2026` | 年度汇总 |
| GET | `/api/v1/persons/{id}/metrics?from=&to=` | 单人时间序列 |
| GET | `/api/v1/metrics/summary?date=` | 全团汇总（人数/未播人数/未播天数/总音浪） |

**数据导入**

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/imports/snapshots` | 批量提交快照（幂等：`anchor_id+biz_date` upsert），返回 `batch_id` |
| GET | `/api/v1/imports/{batch_id}` | 批次状态 |
| POST | `/api/v1/imports/{batch_id}/recompute` | 按批次触发受影响人/月的重算 |

**报表与导出**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/reports/daily?date=&style=&page=` | 结构化报表数据（不渲染图片，前端自己也能画） |
| GET | `/api/v1/reports/monthly?period=` | 月报表数据 |
| GET | `/api/v1/reports/yearly?year=` | 年度报表数据 |
| **POST** | **`/api/v1/exports/image`** | **渲染导出图，返回 PNG** ⭐核心 |
| POST | `/api/v1/exports/image/async` | 大图异步渲染，返回 task id |
| GET | `/api/v1/exports/tasks/{id}` | 异步状态与结果 URL |

**导出请求体（关键）**

```jsonc
{
  "template": "daily_rank",          // daily_rank | monthly_rank | yearly_summary | daily_star | pk_group
  "style": "auto",                   // auto | classic | apple  —— 详见 7.2 路由规则
  "date": "2026-09-18",              // daily_rank/daily_star 用
  "period": "2026-09",               // monthly_rank 用
  "year": 2026,                      // yearly_summary 用
  "gender": "male",                  // male | female | all
  "groupId": 12,                     // pk_group 用
  "page": 1, "pageSize": 30,         // 分页
  "options": {
    "title": "",                     // 留空则用默认标题
    "showDuration": false,           // 是否显示当月时长列
    "showInactiveFooter": null,      // 默认：单页或末页才显示
    "watermark": true,
    "format": "png",                 // png | jpeg
    "pixelDensity": 2                // 对应 615 的 scale=2
  }
}
```

**bot 管理**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/bots/status` | 双通道健康状态 |
| POST | `/api/v1/bots/{weixin\|qq}/start\|stop\|restart` | 控制开关 |
| GET/POST | `/api/v1/bots/skills` | 技能注册表的开关与配置 |
| POST | `/api/v1/bots/weixin/login/qrcode` | iLink 扫码登录（沿用现有 QR 流程） |
| GET | `/api/v1/bots/messages` | 收发历史（对应 `inbox/outbox_message`） |

**系统**

`GET /healthz`、`GET /readyz`、`GET /metrics`（Prometheus）、`GET /openapi.json`

---

## 6. Bot 系统设计

### 6.1 核心抽象：一个 Agent，多种 Transport

沿用 615 里 `project-bots.js` 已被验证的思路，但正规化：

```go
type Transport interface {
    Name() string                                  // "weixin-ilink" | "qq-official"
    Start(ctx context.Context) error
    Send(ctx context.Context, msg OutboundMessage) error
    Receive() <-chan InboundMessage
    Close() error
}

type OutboundMessage struct {
    ConversationID string
    Text           string
    ImageBytes     []byte   // bot 回复主要靠图
    ReplyTo        string
}

type InboundMessage struct {
    ConversationID string
    SenderID       string
    Text           string
    AtMe           bool
    ReceivedAt     time.Time
}
```

微信 iLink 与 QQ 官方 bot **各自实现 `Transport`，共享同一个 `Agent`**（意图解析 + 技能路由）。这样「群组 bersamaan 两端发指令拿到同样结果」是结构性保证，而不是靠两份雷同代码。

### 6.2 意图解析（⭐必须完整迁移 615 的日期规则）

615 的 `weixin-bot-commands.js` 里那套中文自然语言日期解析（第 40–100 行）是**业务资产，不是垃圾代码**，必须 1:1 迁移。它支持的输入形式：

| 输入 | 解析结果 | 备注 |
|---|---|---|
| `2026年9月18日` / `2026-09-18` / `20260918` | 精确日期 | |
| `9月18日` / `9.18` | 月-日（补当年） | |
| `2026年9月` / `2026-09` | 月份 | |
| `9月` | 当年该月 | |
| `2026年` | 年度 | |
| `艺名 9月` | { query:"艺名", dateSpec:"month-only" } | 名字 + 尾部日期拆分 |

**迁移格式建议**：把这套规则抽成一个独立的纯函数包 `internal/dateparse`，配上**表驱动单元测试**，把 615 里所有历史表达方式写成 case。**这一步是「导出/查询不出错」的地基，测试覆盖率要求 ≥ 95%。**

### 6.3 技能注册表

| 技能 | 触发词 | 产出 |
|---|---|---|
| `daily_rank` | 日报 / 今日榜单 / 昨天 | `daily_rank` 图 |
| `monthly_rank` | 月报 / X月 | `monthly_rank` 图 |
| `yearly_summary` | 年报 / X年汇总 | `yearly_summary` 图 |
| `daily_star` | 每日之星 | `daily_star` 图（含头像、金银铜） |
| `pk_group` | 9.1分组 / 第1组 / 分组 | `pk_group` 图 |
| `person_query` | 「艺名」/「艺名 9月」 | 单人数据卡片 |
| `tier_query` | 等级 / 评级 | 文本或图 |

### 6.4 多实例互斥：lease

615 已有 `bot_runner_leases`（`bot-runner-lock.js`），继续保留：
- 拿不到 lease 的实例只跑 API，**不启动 bots**
- lease 靠 MySQL 行 + 定期 `heartbeat_at` 续约，TTL 90s
- 这样桌面端和服务器可以同时开着，但只有一个会发消息——**彻底解决「关掉窗口 bot 就停」和「两边重复推送」这对矛盾**

---

## 7. ⭐ 图片导出：615 样式一致性方案

**这是本次改造的验收红线。** 「保持一致」不能靠肉眼，要靠工程手段。

### 7.1 渲染链路决策

| 方案 | 保真度 | 内存 | arm64 可行性 | 结论 |
|---|---|---|---|---|
| **A. headless chromium (chromedp) + HTML/CSS 模板** | **极高**（emoji/中文字体/水印旋转/渐变/box-shadow 全支持） | 主进程外 ~150–300MB | ✅ 用 `--no-sandbox --disable-dev-shm-usage --single-process` 跑得动 | **主方案** |
| B. 复用 615 的 SVG 字符串 → `resvg`/`librsvg` → PNG | 中（emoji、`<foreignObject>`、部分 CSS 会崩） | ~20MB | ✅ | **备选**，需回归测试兜住差异 |
| C. 纯 Go 矢量库（`fogleman/gg`）手绘 | 低（要重画一遍，保真全靠人力对齐） | 极低 | ✅ | ❌ 不推荐，等于重写一遍样式 |

**选 A。** 理由很直接：615 的模板里有 **emoji 奖牌 🥇🥈🥉**、**旋转 -18° 的半透明水印**、**中文字体栈**、**圆角 pill + 边框**——这些只有在真实浏览器渲染管线下才能 1:1。用 resvg 去碰 emoji 是给自己找麻烦。

**架构上把渲染做成独立 sidecar 容器 `render`（跑 chromium），Go 主服务通过 HTTP 调它。** 三个好处：
1. Go 主程序保持 `CGO_ENABLED=0` 的纯静态二进制，arm64 部署极简
2. chromium 崩了不影响主服务
3. 将来若要把 sidecar 换成 Rust+resvg（内存优化），主服务一行代码不用改 ← **保留了 Rust 方案的后悔权**

**模板形态**：把 615 的两套 SVG 模板**逐行翻译为 HTML+CSS**（而不是继续拼 SVG 字符串）。理由：SVG 里的坐标计算（列宽归一化、多行文本换行 `wrapText 58 字符`）在 CSS 里由浏览器自动完成，代码量暴降，且不会因为换行策略不同导致像素错位。

### 7.2 ⭐ 样式规格：615 复刻清单（这是给实现的验收表）

两套模板，**按性别自动路由**（沿用 615 `resolveReportStyle`）：

> `女 → classic（样式一）`，`男 → apple（样式二）`；显式传 `style` 可覆盖。

#### 通用

| 项 | 值 |
|---|---|
| 画布宽度 `width` | **1440** |
| 缩放 `scale` / pixelRatio | **2**（即 logicalW = 720，输出 1440px 宽 PNG） |
| 列宽归一化 | 先把各列原始权重求和，再按 `(w / total) * tableWidth` 铺满 |
| 中文字体栈 | `font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` |
| 等宽（音浪数字）字体栈 | `"SF Mono", Menlo, Consolas, monospace` |
| 排名数字字体栈 | classic：`Georgia, "Times New Roman", serif`；apple：等宽字体栈 |
| 默认标题 | 男/apple → **星嗨艺创主播数据统计**；女/classic → **薇笑传媒主播数据统计** |
| 未播天数列标签 | 动态：当月 `${M}月未播天数` |
| 日音浪列标签 | 动态：`${M}月${D}日音浪` |
| 图片隐私 | 不得包含收益折算金额 |

#### classic（女队默认）

| 元素 | 规格 |
|---|---|
| 画布背景 | `#F8FAFC` |
| 标题栏高度 | 54，**`#1E293B`**；文字 `#F8FAFC`，22px，700，居中 |
| 表头高度 | 32，**`#E2E8F0`**；文字 `#475569`，13px，700，居中 |
| 行高 | 38 |
| 表格左右 padding | 20（tableWidth = 720 − 40 = 680） |
| 分隔线 | `#E2E8F0`，0.5px（未播行 `#FECACA`） |
| 行底色 | 未播 `#FEF2F2`｜rank1 `#FEF3C7`｜rank2 `#F8FAFC`｜rank3 `#FFEDD5`｜其余交替 `#FFFFFF` / `#F8FAFC` |
| 未播行左侧竖条 | **宽 4，高 = 行高，`#DC2626`** |
| 排名 TOP3 | emoji 🥇🥈🥉，20px；其余：两位补零 `01`，15px，700，`#334155`（未播 `#B91C1C`），Georgia serif |
| 主播姓名 | 15px，500，`#0F172A`（未播 700 / `#991B1B`），截断 12 字符 |
| 未播天数 | 13px，700；`>0` → `#B91C1C`，`=0` → `#15803D` |
| 日音浪进度条 | 高 22，`rx = 11`（半高）；轨道 `#DBEAFE`，填充 `#60A5FA`；左右 padding 8；**最小可视填充 = 22**（填充 < 22 时也画 22） |
| 日音浪-未播态 | 轨道 `#FEE2E2`，居中文字「**未开播**」，13px，700，`#DC2626` |
| 日音浪数字 | 13px，700，等宽字体，居中于进度条；**当 `fillW / barW > 0.52` 时文字转 `#FFFFFF`，否则 `#1E3A8A`** |
| 累计总音浪 | 14px，500，`#475569`，等宽字体，右对齐，距右 12 |
| 等级 pill | 宽 ≤66，高 20，`rx 8`；底 `#E0F2FE`，字 `#0369A1`，11px，700（未播：底 `#FEE2E2` / 字 `#B91C1C`） |
| 页脚 | 底 `#E2E8F0`；高度 = 有未播名单时 `max(118, 86 + 行数×18)`，否则 64 |
| 页脚摘要文案 | 18px，700，`#334155`；多页时「本页 N 人 · 共 M 人」，单页时「女主播 M 人」；后缀「 · 未开播人数 X 人 · 未开播天数 Y 天」 |
| 页脚日期 | 12px，500，`#64748B`，「数据日期 YYYY年M月D日」 |
| 未播名单块 | `rx 8`，底 `#FEF2F2`，描边 `#FECACA`；文案按**师傅分组**，每行 **58 字符**，行高 18 |

**列权重（权重和 = 920，渲染时铺满 680）**

| 列 | 权重 | 对齐 | 备注 |
|---|---|---|---|
| 排名 | 70 | center | |
| 主播姓名 | 180 | left | |
| 未播天数 | 110 | center | 标签随月份动态 |
| 日音浪 | 280 | center(条内) | 含进度条 |
| 累计总音浪 | 180 | right | |
| 等级 | 100 | center | |
| *当月时长（可选）* | — | — | `showDuration=true` 时插入，需重算权重 |

#### apple（男团默认）

| 元素 | 规格 |
|---|---|
| 画布背景 | `#FFFFFF` |
| **水印** | 文本「**内部数据 · 请勿外传**」；18px，900，`rgba(51,65,85,0.055)`；**网格间距 x=180 / y=76，整体旋转 -18°**，从 `-40` 起铺到画布外 |
| 标题区高度 | 86；主标题 25px，700，`#101828`，居中于 y+22；副标题（日期）13px，500，`#475467`，居中于 y+50 |
| 表头高度 | 34，`#F2F4F7`；文字 `#667085`，12px，700，居中 |
| 行高 | 48；**行间距 rowGap = 6**（表头与首行之间也有 6） |
| 行样式 | 底 `#FFFFFF`（未播 `#FFF7F7`），描边 `#EAECF0`（未播 `#FEE4E2`），1px |
| 未播行左侧标记 | x=0，y=行顶+8，宽 4，高 = 行高−16，`rx 2`，`#F04438` |
| 排名 chip | 40×24，`rx = 12`；rank1 底 `#FFFAEB`/边 `#FEDF89`/字 `#B54708`｜rank2 `#F9FAFB`/`#D0D5DD`/`#475467`｜rank3 `#FFF6ED`/`#FED7AA`/`#C4320A`｜其余 `#F2F4F7`/`#EAECF0`/`#475467`｜未播 `#FFF1F2`/`#FFE4E6`/`#B42318`；文字两位补零，12px，700，等宽 |
| 主播姓名 | 14px，**700**，`#101828`（未播 `#B42318`） |
| 未播天数 | 13px，700；`>0` `#B42318`，`=0` `#027A48` |
| 日音浪进度条 | 同 classic 几何，轨道 `#EAF3FF`；未播轨道 `#FEE4E2`；文字色 `#1D4ED8` / `#FFFFFF`（切换阈值同为 0.52） |
| 等级 pill | 高 24，`rx 12`，宽度 `min(列宽−18, max(42, len×12+20))`；配色函数： |
| | **A** `#FFF7E6` / `#FDBA74` / `#9A3412`　**B** `#EAF3FF` / `#60A5FA` / `#1D4ED8`　**C** `#ECFDF3` / `#34D399` / `#047857`　**D** `#F5F3FF` / `#A78BFA` / `#6D28D9`　**默认** `#F2F4F7` / `#EAECF0` / `#667085` |
| 页脚 | 文本区 gap 8、高 18；未播警示块高 42、上间距 20（底 `#FEF2F2` / 边 `#FECACA` / `rx 8`） |

#### 其余模板（同样要复刻）

| 模板 | 关键规格 |
|---|---|
| `daily_star` | 前三名 NO.1–3；金 `#F5D76E` / 银 `#D7DEE8` / 铜 `#E8B48A`；头像 `<image>` 92×92 + clipPath 圆形；日期「YYYY年M月D日」；分队配色：女-薇笑传媒 `#EC4899`、男-星嗨艺创 `#F59E0B` |
| `pk_group` | 8 色调色板（首组 `#FF2D95` / `#FFE4F3` / `#BE185D`）；背景四段渐变 `#FFF7FB → #F5F0FF → #ECFEFF → #FFF7ED`；标题渐变 `#FF2D95 → #A855F7 → #6366F1 → #06B6D4`；卡片 `rx` 20/26，pad 40，cardW 380/292；boardW `max(980, …)`；页脚「**星嗨艺创 · PK GROUP**」 |

### 7.3 一致性验证：像素级回归测试（不可省略）

没有这一步，「与 615 一致」就是空话。落地方式：

1. **基准图抓取**：在 615 分支跑一批固定输入的导出（男女各一、多页、含未播、TOP3、等级齐全、月/年/PK/每日之星），把 PNG 存进 `testdata/golden/615/`，文件名编码输入参数。
2. **新渲染比对**：3328 用同样参数渲染，与基准做 **SSIM（结构相似度）比对 + 关键区域像素 diff**。
3. **阈值**：整体 **SSIM ≥ 0.98**；文字区域允许 ±1px 抗锯齿漂移；**配色（取表头/行底/pill 三个采样点）必须 `#HEX` 完全相同**。
4. **CI 门禁**：回归不通过不许合并。
5. **容器字体**：镜像里必须装 `Noto Sans SC` + `Noto Sans Color Emoji` 并执行 `fc-cache`，且在测试里断言 `fc-list | grep -c Emoji > 0`。**缺 emoji 字体是最常见的坑。**

### 7.4 AST 端 otp “深色科技风” 海报

615 桌面端的 `export-daily-report.ts`（1080px 宽、深蓝 `#0a0f1c`/`#020617`/`#00b8ff`/`#00f5d4`、**scale=2**）属于**桌面端专属样式**，不在 bot 导出的对等范围。

**决策**：3328 保留这套深蓝海报样式，作为 `style: "tech"` 的**第三个可选样式**（默认不启用），模板同样迁移。这样既不丢资产，也不污染 bot 的默认输出口径。

---

## 8. 部署方案（RK3318 arm64）

```
docker-compose.yml
├─ server   dy-manager-server  (Go 静态二进制, scratch,      ~20MB, RSS ~40MB)
├─ render   chromium sidecar   (浏览器渲染导出图,            RSS ~150-300MB)
├─ mysql    8.0 (arm64, volume 持久化, ~250MB)
└─ caddy    反代 + 自动 HTTPS（可选）
```

- **交叉编译**：`GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o server ./cmd/server` → 约 **15MB**
- **多阶段 Docker**：`golang:1.24-alpine` 编译 → `scratch` 运行（拷贝 CA 证书 + 迁移 SQL + 模板文件）
- **内存预算**：server 40MB + render 250MB + mysql 250MB ≈ **550MB**，在 1GB 盒子上能跑；**2GB 更稳**
- **render 容器 chromium 参数**：`--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars --font-render-hinting=none --disable-lcd-text`
- **健康检查**：`/healthz` 返回 200，`/readyz` 检查 DB 连通 + render sidecar 连通
- **备份**：每日 `mysqldump` + bot artifacts 目录 rsync

---

## 9. 迁移策略（615 → 3328）

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 | 建立 Go 骨架 + 迁移工具；从远端库全量导入 `persons/accounts/wave_snapshots/duration_snapshots` | 行数一致，抽样 checksum 一致 |
| M1 | 跑差分引擎，重算 `daily/monthly/yearly_metric` | 与 615 现场 SQL 的结果做全量对比，**差异必须为 0**（漏采日期要能解释） |
| M2 | 迁移日期/意图解析器 + 单测 | 615 的历史指令样本 100% 命中 |
| M3 | 迁移两套模板 + 建立 golden baseline + SSIM 回归 | 见 7.3 阈值 |
| M4 | 微信 iLink transport 上线（先只读/只回应，不主动推送） | 群内问答结果与 615 一致 |
| M5 | QQ transport 上线 + lease 互斥 | 两端同时在线不重复推送 |
| M6 | 定时任务（每日推送/月结算）迁移；桌面端改为纯 API 客户端 | 关掉桌面端窗口，推送照常 |

**双跑期**：M4–M6 期间 615 与 3328 可并存（靠 lease 保证只有一个发消息），出现问题时一键切回。

---

## 10. 分支与仓库纪律

- `615`：**冻结为只读基线**，不再合入新功能，仅用于 golden 图抓取和对照
- `3328`：本次改造主分支
- 提交粒度：一个窄主题一个 commit（`feat:` / `fix:` / `refactor:` / `chore:`），沿用现有习惯
- 老 Electron 主进程代码：`electron/*.js` 在 M6 完成前保留；**不在本次删除**，待 3328 全量验证后再开 issue 处理

---

## 11. 风险与开放问题

| # | 风险 | 等级 | 应对 |
|---|---|---|---|
| R1 | chromium 在 RK3318 上内存超限/崩溃 | **高** | 容器 `memory: 512m` 硬限制 + 自动重启；render 做请求串行化（一次只渲一张）；备选回退到 resvg 路径（此时 SSIM 阈值降到 0.95 并人工复核） |
| R2 | emoji / 中文字体缺失导致渲染错乱 | **高** | 镜像内置字体 + 启动自检 + CI 断言，见 7.3.5 |
| R3 | 历史数据存在大量漏采 → 日音浪失真 | 中 | 差分引擎标记 `reliable=0`，先出「数据健康度报告」，修复策略由业务确认后再批量回补 |
| R4 | MySQL 8 窗口函数团队不熟悉 | 中 | 差分逻辑写在 Go 而非 SQL（4.5 已决策），降低 SQL 依赖 |
| R5 | 「615 导出样式」是否还另有所指 | 中 | 已确认 615 = 当前 Git 分支；若另有所指，需在动工前对齐具体产物 |
| Q1 | 待确认：`group_name` 与现有 PK 分组是否同一实体？ | — | 待业务确认后再正规化 `pk_group` 表 |
| Q2 | 待确认：月直播时长是否需要区分「有效时长」（去除挂播）？ | — | 平台给的是累计总时长，暂不区分 |

---

## 12. 里程碑（建议）

| 里程碑 | 交付物 | 依赖 |
|---|---|---|
| P0 | 技术选型定稿（本文档评审通过） | — |
| P1 | 数据层：迁移 + 差分引擎 + 三层物化 + 重算 API | P0 |
| P2 | 指标 API + OpenAPI 文档 | P1 |
| P3 | 渲染服务 + golden baseline + SSIM CI | P1 |
| P4 | 导出五个模板（daily/monthly/yearly/star/pk） | P3 |
| P5 | Bot 框架 + iLink transport + 技能 | P2, P4 |
| P6 | QQ transport + lease | P5 |
| P7 | arm64 Docker 部署 + 双跑切换 | P6 |

---

## 附录 A：615 → 3328 映射速查

| 615 | 3328 |
|---|---|
| `electron/weixin-bot-report.js` `renderClassicSvg` | `internal/render/template/daily_rank_classic.html` + `theme.Classic` |
| `electron/weixin-bot-report.js` `renderAppleSvg` | `internal/render/template/daily_rank_apple.html` + `theme.Apple` |
| `appleTierColor()` | `internal/render/theme/tier.go` |
| `groupInactiveStreamers()` / `wrapText(58)` | CSS 自动换行（去掉手工折行） |
| `electron/pk-group-image.js` `ACCENTS[8]` | `internal/render/theme/palette.go` |
| `electron/weixin-bot-daily-star.js` | `daily_star.html` |
| `shared/ilink-adapter.js` | `internal/bot/transport/ilink/` |
| `shared/qqbot-adapter.js` | `internal/bot/transport/qq/` |
| `electron/weixin-bot-commands.js` 日期正则 | `internal/dateparse/`（抽成纯函数 + 表驱动测试） |
| `init-db.js` / `migrations/00X` | `db/migrations/*.sql`（golang-migrate） |
| 现场 JOIN 算日差分 | `internal/metric/diff.go` + 三层物化表 |
