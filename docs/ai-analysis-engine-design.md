# AI 分析引擎设计规格

> 架构位置：数据层 → **AI 分析引擎** → 微信 Bot → 用户
> 创建：2026-08-10
> 状态：**设计稿，待执行**

---

## 1. 架构总览

```
主播数据 ▼
┌─────────────┐
│   数据层    │
│ MySQL/现有DB │
└──────┬──────┘
       ▼
┌─────────────────┐
│  AI 分析引擎    │
│                 │
│  · 日报生成     │
│  · 异常检测     │
│  · 主播诊断     │
│  · 排名分析     │
│  · 趋势分析     │
└──────┬──────────┘
       │
   ┌───┴───┐
   ▼       ▼
 Bot A   Bot B / 其他Bot
   │       │
   └───┬───┘
       ▼
    微信用户
```

**核心原则：**
- AI 分析引擎是**独立模块**，不耦合特定 Bot 通道
- 数据层只来自 MySQL（`electron/db.js` 现有接口），**禁止模型编造数字**
- 引擎产出结构化分析结果（JSON），由各 Bot 通道决定呈现方式（文字/图片/文件）
- 单 Agent + 多技能架构不变；分析引擎作为**新技能**注入 Agent，不新增 Agent

---

## 2. 模型选型与分工

### 2.1 可用模型池

| 模型 | 厂商 | 特点 | 引擎角色 |
|------|------|------|----------|
| `deepseek-ai/deepseek-v4-flash-0731` | DeepSeek | 快速(~1s)、推理强、中文好 | **主力分析模型**（日报/诊断/趋势） |
| `minimaxai/minimax-m3` | MiniMax | 极快(~0.5s)、中文好 | **异常检测 + 排名分析** |
| `nvidia/nemotron-mini-4b-instruct` | NVIDIA | 极快(~0.7s)、轻量 | 快速分类/意图判断 |
| `nvidia/nemotron-3-super-120b-a12b` | NVIDIA | 快速(~1s)、推理 | 备选分析 |
| `nvidia/nemotron-3-ultra-550b-a55b` | NVIDIA | 快速(~1.7s)、大模型 | 备选深度分析 |

> ⚠️ **实测不可用模型**（2026-08-10）：`z-ai/glm-5.2`、`openai/gpt-oss-120b` 在 192.168.5.12 节点 30s+ 超时，暂不使用。

### 2.2 分工策略

```
用户消息 ──► 意图分类（nvidia/nemotron-mini-4b，~0.7s）
              │
              ├─ 数据查询类 ──► 现有技能（search_anchors 等）
              ├─ 日报类 ──────► deepseek-v4-flash 生成日报文案
              ├─ 异常检测类 ──► minimax-m3 分析异常
              ├─ 诊断类 ──────► deepseek-v4-flash 深度诊断
              ├─ 趋势类 ──────► deepseek-v4-flash 趋势解读
              └─ 排名类 ──────► minimax-m3 排名分析
```

**选型理由（实测 2026-08-10）：**
- DeepSeek V4 Flash：延迟 ~1s，中文理解+推理+速度均衡，适合需要结合数据生成自然语言文案的场景
- MiniMax M3：延迟 ~0.5s 极快，中文原生优化，适合异常检测和排名分析等判断型任务
- Nemotron Mini 4B：延迟 ~0.7s，仅做意图分类，追求低延迟
- GLM-5.2 / GPT-OSS-120b：本节点实测 30s+ 超时，暂不使用
- 两个主力模型互补：DeepSeek 偏生成，MiniMax 偏判断

### 2.3 调用方式

所有模型通过 OpenAI-compatible `/v1/chat/completions` 接口调用：

```javascript
// electron/ai-engine/client.js
const AI_ENDPOINTS = {
  primary: process.env.AI_BASE_URL || "http://192.168.5.12/v1",
  apiKey: process.env.AI_API_KEY,
};

// 模型路由表
const MODEL_ROUTING = {
  intent_classify: "nvidia/nemotron-mini-4b-instruct",
  daily_report: "deepseek-ai/deepseek-v4-flash-0731",
  anomaly_detect: "minimaxai/minimax-m3",
  anchor_diagnosis: "deepseek-ai/deepseek-v4-flash-0731",
  trend_analysis: "deepseek-ai/deepseek-v4-flash-0731",
  rank_analysis: "minimaxai/minimax-m3",
  fallback: "deepseek-ai/deepseek-v4-flash-0731",
};
```

---

## 3. 五大分析模块

### 3.1 日报生成（daily_report）

**输入：** 日期、性别（男团/女队/双团）
**数据源：** `db.getDailyWaveReport(date, gender)` + `db.getDashboardSummary()`
**模型：** `deepseek-ai/deepseek-v4-flash-0731`

**流程：**
1. 从 DB 获取当日报告数据（现有 `getDailyWaveReport` 已返回完整 rows）
2. 构造数据摘要 prompt（不含原始大表，只含 top/bottom/统计摘要）
3. 模型生成：
   - 当日整体概述（开播率、音浪总量、环比）
   - Top 3 表现亮点
   - Bottom 3 需关注主播
   - 与昨日对比

**Prompt 模板：**
```
你是抖音主播数据分析师。根据以下数据生成简洁日报摘要。

日期：{date}
团队：{team_label}
总人数：{total}
今日开播：{live_count}（开播率 {live_rate}%）
未播：{not_live_count}
日音浪合计：{daily_wave_total}
月累计音浪：{monthly_wave_total}

Top 5 主播：
{top5_list}

未播名单：{not_live_names}

请输出：
1. 今日概述（2-3句）
2. 亮点表现（3条）
3. 需关注（2-3条）
4. 与昨日对比（如有数据）

格式：简洁中文，每条不超过50字，总计不超过300字。
```

**输出：** 结构化 JSON + 自然语言文案

### 3.2 异常检测（anomaly_detect）

**输入：** 日期（可选，默认最新）、性别（可选）
**数据源：** `db.getDailyWaveReport` + `db.getAnchorWaveTrend`（7天/14天序列）
**模型：** `minimaxai/minimax-m3`（延迟 ~0.5s，极快）

**检测维度：**
1. **音浪骤降**：日音浪 < 7日均值 × 0.3
2. **音浪骤升**：日音浪 > 7日均值 × 2.0
3. **停播异常**：连续未播天数 ≥ 3 且之前稳定开播
4. **排名大幅下滑**：排名下降 ≥ 5 位
5. **时长不足**：日播时长 < 团队中位数的 50%

**Prompt 模板：**
```
你是数据异常检测专家。以下是主播{anchor_name}的近期数据：

7日音浪序列：{wave_7d}
7日时长序列：{duration_7d}
今日音浪：{today_wave}
今日时长：{today_duration}
7日均值：{avg_wave}
排名变化：{rank_delta}

请判断是否存在异常，输出 JSON：
{
  "anomalies": [
    {
      "type": "wave_drop|wave_spike|stop_broadcast|rank_drop|duration_short",
      "severity": "high|medium|low",
      "description": "异常描述",
      "suggestion": "建议关注/约谈/调整"
    }
  ],
  "overall_status": "normal|warning|critical"
}

只输出 JSON，不要额外文字。
```

**批量处理：** 对团队所有主播批量检测，汇总为异常报告

### 3.3 主播诊断（anchor_diagnosis）

**输入：** 主播名/ID、时间范围（默认30天）
**数据源：** `db.getAnchorFullProfile` + `db.getAnchorWaveTrend` + `db.getAnchorDurationTrend`
**模型：** `deepseek-ai/deepseek-v4-flash-0731`

**诊断维度：**
1. **活跃度**：开播天数/总天数、时长稳定性
2. **音浪表现**：均值/峰值/谷值、波动系数、环比趋势
3. **排名走势**：上升/下降/震荡
4. **团队对比**：在同性团队中的分位
5. **师徒对比**（如有师父）：与师父/同门对比
6. **综合评价 + 建议**

**Prompt 模板：**
```
你是主播运营诊断顾问。请根据以下数据为主播{anchor_name}生成诊断报告。

【基本信息】
性别团队：{gender_team}
师父：{master_name}
抖音号：{douyin_no}

【音浪数据（{range}）】
记录天数：{wave_days}
最新音浪：{latest_wave}
峰值：{peak_wave}（{peak_date}）
7日均值：{avg_7d}
14日均值：{avg_14d}
30日合计：{sum_30d}
环比变化：{delta_pct}%

【时长数据】
最新累计时长：{latest_duration}
日均时长：{avg_daily_duration}

【排名】
最新排名：{latest_rank}（共{team_size}人）
7日前排名：{rank_7d_ago}
排名变化：{rank_delta}

请输出结构化诊断：
1. 活跃度评价（优/良/待改进 + 依据）
2. 音浪表现评价
3. 排名走势判断
4. 团队对比位置（前%/中%/后%）
5. 综合评级（S/A/B/C/D）
6. 具体建议（2-3条可执行动作）

每部分简洁，总字数不超过500字。
```

### 3.4 排名分析（rank_analysis）

**输入：** 日期（默认最新）、性别、范围（Top 10 / 全团 / 指定区间）
**数据源：** `db.getDailyWaveReport` 返回的 rows（已含 rank、previousRank、rankDelta）
**模型：** `minimaxai/minimax-m3`（延迟 ~0.5s）

**分析维度：**
1. **排名变动**：上升最多 / 下降最多 / 新进榜 / 跌出榜
2. **音浪分档**：S（前10%）、A（10-30%）、B（30-60%）、C（60-100%）
3. **梯队分析**：头部/腰部/尾部的音浪差距
4. **未播影响**：未播对排名的拖累程度

**Prompt 模板：**
```
以下是{date} {team_label} 排名数据（共{total}人）：

排名变动 Top 5（上升）：
{risers}

排名变动 Top 5（下降）：
{fallers}

当前 Top 10：
{top10}

未播人数：{not_live_count}

请分析：
1. 排名变动亮点（谁上升/下降最快，原因推测）
2. 梯队分布（头部/腰部/尾部人数与音浪差距）
3. 未播影响评估
4. 下一步关注建议

总字数不超过400字。
```

### 3.5 趋势分析（trend_analysis）

**输入：** 主播名/ID 或团队范围、时间范围（7d/14d/30d）
**数据源：** `db.getAnchorWaveTrend` + `db.getAnchorsWaveTrend`（批量）
**模型：** `deepseek-ai/deepseek-v4-flash-0731`

**分析维度：**
1. **个体趋势**：上升/下降/震荡/平稳
2. **团队趋势**：整体音浪走势、开播率变化
3. **环比/同比**：本周 vs 上周、本月 vs 上月
4. **预测提示**：按当前趋势线性外推（不使用复杂预测，仅提示方向）

**Prompt 模板：**
```
以下是{anchor_name}近{range}的音浪趋势：

日期-音浪序列：
{wave_series}

统计：
起始音浪：{start_wave}
结束音浪：{end_wave}
变化幅度：{change_pct}%
线性趋势斜率：{slope}
波动系数：{cv}

请分析：
1. 趋势方向判断（上升/下降/震荡/平稳）
2. 关键转折点（如有）
3. 波动性评估
4. 按当前趋势外推下周可能范围
5. 建议动作

总字数不超过300字。
```

---

## 4. 技术实现

### 4.1 文件结构

```
electron/
├── ai-engine/
│   ├── client.js           # AI 模型调用客户端（多模型路由）
│   ├── daily-report.js     # 日报生成
│   ├── anomaly-detect.js   # 异常检测
│   ├── anchor-diagnosis.js # 主播诊断
│   ├── rank-analysis.js    # 排名分析
│   ├── trend-analysis.js   # 趋势分析
│   ├── prompts.js          # 所有 prompt 模板
│   └── index.js            # 引擎入口 + 统一调度
├── weixin-bot-skills.js    # 新增 5 个分析技能定义
└── weixin-bot-agent.js     # 不改（已有 tool-call 机制）
```

### 4.2 AI 客户端（`ai-engine/client.js`）

```javascript
"use strict";

const DEFAULT_BASE_URL = "http://192.168.5.12/v1";
const ALLOWED_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "192.168.5.12", "162.243.93.40"]);

const MODEL_ROUTING = {
  intent_classify: "nvidia/nemotron-mini-4b-instruct",
  daily_report: "deepseek-ai/deepseek-v4-flash-0731",
  anomaly_detect: "minimaxai/minimax-m3",
  anchor_diagnosis: "deepseek-ai/deepseek-v4-flash-0731",
  trend_analysis: "deepseek-ai/deepseek-v4-flash-0731",
  rank_analysis: "minimaxai/minimax-m3",
  fallback: "deepseek-ai/deepseek-v4-flash-0731",
};

async function chatCompletion({ model, messages, temperature = 0.3, maxTokens = 2000, timeoutMs = 60000 }) {
  const baseUrl = process.env.AI_BASE_URL || DEFAULT_BASE_URL;
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY 未配置");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`AI HTTP ${response.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    return data?.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

async function callAnalysis(task, messages, options = {}) {
  const model = MODEL_ROUTING[task] || MODEL_ROUTING.fallback;
  return chatCompletion({
    model,
    messages,
    temperature: options.temperature ?? 0.3,
    maxTokens: options.maxTokens ?? 2000,
    timeoutMs: options.timeoutMs ?? 60000,
  });
}

module.exports = { callAnalysis, chatCompletion, MODEL_ROUTING };
```

### 4.3 统一引擎入口（`ai-engine/index.js`）

```javascript
"use strict";

const { callAnalysis } = require("./client");
const { createDailyReport } = require("./daily-report");
const { detectAnomalies } = require("./anomaly-detect");
const { diagnoseAnchor } = require("./anchor-diagnosis");
const { analyzeRank } = require("./rank-analysis");
const { analyzeTrend } = require("./trend-analysis");

function createAiEngine({ db }) {
  if (!db) throw new Error("AI 引擎缺少数据库");

  return {
    dailyReport: (args) => createDailyReport({ db, callAnalysis }, args),
    detectAnomalies: (args) => detectAnomalies({ db, callAnalysis }, args),
    diagnoseAnchor: (args) => diagnoseAnchor({ db, callAnalysis }, args),
    analyzeRank: (args) => analyzeRank({ db, callAnalysis }, args),
    analyzeTrend: (args) => analyzeTrend({ db, callAnalysis }, args),
  };
}

module.exports = { createAiEngine };
```

### 4.4 新增技能定义（注入 `weixin-bot-skills.js`）

在现有 `tools` 数组追加 5 个新技能：

```javascript
// ── AI 分析引擎技能 ──
{
  type: "function",
  function: {
    name: "ai_daily_report",
    description: "AI 生成日报摘要：当日概述、亮点、需关注、环比",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD，默认最新" },
        gender: { type: "string", enum: ["male", "female", "both"] },
      },
    },
  },
  execute: aiEngine.dailyReport,
},
{
  type: "function",
  function: {
    name: "ai_anomaly_detect",
    description: "AI 异常检测：音浪骤降/骤升、停播异常、排名下滑、时长不足",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string" },
        gender: { type: "string", enum: ["male", "female", "both"] },
      },
    },
  },
  execute: aiEngine.detectAnomalies,
},
{
  type: "function",
  function: {
    name: "ai_anchor_diagnosis",
    description: "AI 主播深度诊断：活跃度、音浪表现、排名走势、团队对比、综合评级",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "主播姓名/抖音号/ID" },
        range: { type: "string", enum: ["7d", "14d", "30d"], description: "默认30d" },
      },
      required: ["query"],
    },
  },
  execute: aiEngine.diagnoseAnchor,
},
{
  type: "function",
  function: {
    name: "ai_rank_analysis",
    description: "AI 排名分析：排名变动、音浪分档、梯队分析、未播影响",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string" },
        gender: { type: "string", enum: ["male", "female", "both"] },
      },
    },
  },
  execute: aiEngine.analyzeRank,
},
{
  type: "function",
  function: {
    name: "ai_trend_analysis",
    description: "AI 趋势分析：个体或团队趋势方向、转折点、波动性、外推预测",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "主播名，留空则分析全团" },
        range: { type: "string", enum: ["7d", "14d", "30d"] },
        gender: { type: "string", enum: ["male", "female"] },
      },
    },
  },
  execute: aiEngine.analyzeTrend,
},
```

### 4.5 System Prompt 扩展

在 `weixin-bot-agent.js` 的 `SYSTEM_PERSONA` 追加：

```
【AI 分析能力】
除数据查询外，你还可以调用 AI 分析引擎：
1) ai_daily_report — 生成日报摘要（概述/亮点/关注/环比）
2) ai_anomaly_detect — 异常检测（骤降/骤升/停播/排名下滑）
3) ai_anchor_diagnosis — 主播深度诊断（评级 S-D + 建议）
4) ai_rank_analysis — 排名分析（变动/梯队/未播影响）
5) ai_trend_analysis — 趋势分析（方向/转折/外推）

用户用自然语言提问即可，如：
- "今天日报分析一下"
- "最近有谁数据异常吗"
- "诊断一下XXX"
- "排名分析"
- "XXX最近趋势怎么样"
```

---

## 5. 数据流与安全

### 5.1 数据流约束

```
DB 查询（结构化数据）
    │
    ▼
数据摘要构造（精简，避免全表传入模型）
    │
    ▼
AI 模型调用（prompt 含数据摘要 + 分析指令）
    │
    ▼
结构化输出解析（JSON 校验 + 降级处理）
    │
    ▼
技能返回（文本 + 可选图片附件）
    │
    ▼
Agent 回复用户
```

**硬规则：**
- 传入模型的数据摘要控制在 **2000 字以内**，避免全表数据灌入
- 每次模型调用超时 60s，重试 0 次（失败降级为规则化文案）
- 所有数字来自 DB 查询结果，模型只负责**解读和生成文案**，不允许编造数字
- 输出 JSON 解析失败时，降级为规则化模板文案

### 5.2 Token 成本控制

| 分析类型 | 输入 token（估） | 输出 token（估） | 单次成本（估） |
|----------|-----------------|-----------------|---------------|
| 日报生成 | ~800 | ~400 | 低 |
| 异常检测（单主播） | ~400 | ~200 | 极低 |
| 异常检测（全团批量） | ~2000 | ~800 | 中 |
| 主播诊断 | ~1000 | ~500 | 低 |
| 排名分析 | ~800 | ~400 | 低 |
| 趋势分析 | ~600 | ~300 | 极低 |

全团日报+异常检测+排名分析每日自动跑一次，预估日消耗 < 10K tokens。

### 5.3 降级策略

```
模型调用失败
    │
    ├─ 超时 ──► 返回规则化文案（基于 DB 数据的模板拼接）
    ├─ HTTP 5xx ──► 降级到 fallback 模型重试一次
    ├─ JSON 解析失败 ──► 返回原始文本（截断 2000 字）
    └─ 全部失败 ──► 返回 { ok: false, error: "分析引擎暂不可用" }
```

---

## 6. 多 Bot 通道支持

### 6.1 引擎与通道解耦

AI 分析引擎产出**标准结构化结果**，各 Bot 通道自行决定呈现：

```javascript
// 引擎返回统一格式
{
  ok: true,
  task: "daily_report",
  asOfDate: "2026-08-09",
  text: "今日男团整体音浪...",          // 自然语言文案
  data: {                              // 结构化数据（供图片渲染等）
    summary: { liveRate: 0.85, ... },
    highlights: [...],
    concerns: [...],
  },
  artifact: null,                       // 可选图片附件
}
```

### 6.2 Bot A / Bot B 接入

```javascript
// 各 Bot 只需调用引擎，不需要知道模型细节
const aiEngine = createAiEngine({ db });

// Bot A（微信 iLink）
const result = await aiEngine.dailyReport({ date, gender: "male" });
if (result.text) await replyText(result.text);
if (result.artifact) await replyImage(result.artifact);

// Bot B（QQ 或其他）
const result = await aiEngine.diagnoseAnchor({ query: "XXX" });
// Bot B 自行格式化输出
```

### 6.3 现有 Agent 集成

现有 `WeixinBotAgent` 的 `handleMessage` 已支持 tool-call 循环。新增 5 个技能后：
- 用户说 "分析一下今天日报" → Agent 调 `ai_daily_report`
- 用户说 "XXX最近怎么样" → Agent 调 `ai_anchor_diagnosis` 或 `ai_trend_analysis`
- 用户说 "有没有异常" → Agent 调 `ai_anomaly_detect`

**无需修改 Agent 核心**，只需在 `createWeixinBotSkills` 中注入引擎。

---

## 7. 实施计划

### Phase 1：引擎骨架（1-2天）

- [ ] 创建 `electron/ai-engine/` 目录结构
- [ ] 实现 `client.js`（多模型路由 + 调用）
- [ ] 实现 `prompts.js`（所有 prompt 模板）
- [ ] 实现 `index.js`（引擎入口）
- [ ] 单元测试：mock 模型调用验证路由

### Phase 2：五大分析模块（3-4天）

- [ ] `daily-report.js` — 日报生成
- [ ] `anomaly-detect.js` — 异常检测（含批量）
- [ ] `anchor-diagnosis.js` — 主播诊断
- [ ] `rank-analysis.js` — 排名分析
- [ ] `trend-analysis.js` — 趋势分析
- [ ] 每模块独立测试（mock DB + mock 模型）

### Phase 3：技能注入 + Agent 集成（1天）

- [ ] `weixin-bot-skills.js` 追加 5 个技能定义
- [ ] `weixin-bot-agent.js` 扩展 SYSTEM_PERSONA
- [ ] Agent tool-call 回归测试

### Phase 4：日报自动推送增强（1天）

- [ ] `weixin-bot-daily-push.js` 增加可选 AI 文案模式
- [ ] 推送时先跑 AI 日报生成，再发报告图 + AI 文案
- [ ] AI 失败时降级为现有规则化文案

### Phase 5：测试与验收（1-2天）

- [ ] 端到端测试：微信发 "日报分析" → 收到 AI 文案 + 报告图
- [ ] 端到端测试：微信发 "诊断XXX" → 收到诊断报告
- [ ] 端到端测试：微信发 "异常检测" → 收到异常列表
- [ ] 降级测试：模型不可用时返回规则化文案
- [ ] 性能测试：单次分析 < 15s

---

## 8. 验收标准

| 项 | 标准 |
|----|------|
| 日报生成 | 给定日期+性别，15s 内返回 AI 文案，内容含概述/亮点/关注/环比 |
| 异常检测 | 全团批量 30s 内完成，准确识别音浪骤降(>70%跌幅)和连续停播(≥3天) |
| 主播诊断 | 给定主播，15s 内返回 S-D 评级 + 依据 + 建议 |
| 排名分析 | 给定日期，15s 内返回排名变动分析 + 梯队分布 |
| 趋势分析 | 给定主播+范围，10s 内返回趋势判断 + 方向 |
| 降级 | 模型超时/不可用时，3s 内返回规则化模板文案 |
| 数据安全 | 模型 prompt 中不包含 API Key/密码/路径；数字全部来自 DB |
| Agent 集成 | 5 个新技能在微信 Agent 中可通过自然语言触发 |

---

## 9. 配置扩展

`.env.example` 追加：

```env
# AI 分析引擎（可选；不配则用默认值）
AI_ENGINE_ENABLED=1
# 主力分析模型（留空则用默认路由）
AI_MODEL_DAILY_REPORT=deepseek-ai/deepseek-v4-flash-0731
AI_MODEL_ANOMALY=minimaxai/minimax-m3
AI_MODEL_DIAGNOSIS=deepseek-ai/deepseek-v4-flash-0731
AI_MODEL_TREND=deepseek-ai/deepseek-v4-flash-0731
AI_MODEL_RANK=minimaxai/minimax-m3
# 分析超时（毫秒）
AI_ANALYSIS_TIMEOUT_MS=60000
```

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 模型幻觉编造数字 | prompt 强约束 + 输出校验数字与 DB 比对 |
| 模型延迟过高 | 60s 超时 + 降级文案 |
| Token 成本失控 | 数据摘要精简 + 单次 maxTokens 限制 |
| 多模型路由出错 | 统一 fallback 到 deepseek-v4-flash |
| 批量异常检测慢 | 并发调用（Promise.all，限 5 并发）|
| 现有功能受影响 | 新增模块独立，不修改现有技能逻辑 |
