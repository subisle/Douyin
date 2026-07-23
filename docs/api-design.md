# 抖音数据管理 API 设计

> 版本：v0.1
> 日期：2026-07-06
> 用途：网页服务器版、后续 iOS App、后续桌面端统一对接。

> **【文档关系 · 2026-07-23】**
> 本文定义 **数据 REST**（`/api/v1/**`）与兼容 `POST /api/ipc`。
> Agent/Bot/RAG 接口（`/api/agent/**`、`/api/bot/**`、`/api/rag/**`）见 `docs/ai-agent-production-plan.md`，为 **增量扩展**，不取代本文数据路由。
> 跨模块运行契约与实施顺序以 `docs/adr/0001-agent-runtime-contract.md` 为准。

## 1. 基础信息

- Base URL：`https://your-domain.com/api/v1`
- 本地开发：`http://localhost:3000/api/v1`
- 数据库：服务端通过 `.env` 连接网站数据库，客户端不直连数据库。
- 访问控制：除 API 根信息与 `/health` 外，接口统一要求登录后的 HttpOnly 会话，或 `Authorization: Bearer <token>` / `x-api-token: <token>`；未配置可用认证凭据时保持拒绝访问。
- 响应格式：

```ts
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; detail?: unknown } };
```

## 2. 健康检查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | API 服务健康检查 |
| GET | `/startup-health` | 数据库和数据表启动检查 |

## 3. 主播接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/anchors` | 主播列表 |
| POST | `/anchors` | 新增主播 |
| PATCH | `/anchors/:personId` | 更新主播完整资料 |
| DELETE | `/anchors/:personId` | 删除主播 |
| PATCH | `/anchors/:personId/name` | 更新主播姓名 |
| PATCH | `/anchors/:personId/master` | 更新师傅关系 |
| POST | `/anchors/batch-import` | 批量导入主播 |
| POST | `/anchors/merge-accounts` | 合并账号 |
| GET | `/anchors/duplicates` | 查找重复主播 |
| GET | `/anchors/:anchorId/daily-snapshot?date=YYYY-MM-DD` | 某日快照 |
| PUT | `/anchors/:anchorId/daily-snapshot` | 保存某日快照 |
| GET | `/anchors/:anchorId/wave-trend` | 单主播音浪趋势 |
| GET | `/anchors-wave-trend?ids=a,b,c` | 多主播音浪趋势 |

## 4. 族谱接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/family-tree` | 族谱数据 |

## 5. 仪表盘接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dashboard/summary` | 概览统计 |
| GET | `/dashboard/wave-ranking?limit=10` | 音浪排行榜 |
| GET | `/dashboard/wave-trend-by-gender` | 男女音浪趋势 |
| GET | `/dashboard/wave-trend-total` | 总音浪趋势 |
| GET | `/dashboard/anchor-count-trend` | 主播数量趋势 |

## 6. 导入接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/imports/preview` | 导入预检 |
| POST | `/imports/wave` | 导入音浪 |
| POST | `/imports/duration` | 导入时长 |

### 6.1 导入音浪请求

```json
{
  "date": "2026-07-06",
  "rows": [
    { "anchorId": "123", "waveValue": 10000, "rank": 1 }
  ],
  "meta": {
    "fileHash": "md5hex",
    "dataHash": "sha256hex",
    "fileName": "wave.csv",
    "rowCount": 1
  }
}
```

### 6.2 导入时长请求

```json
{
  "date": "2026-07-06",
  "rows": [
    { "anchorId": "123", "totalMinutes": 180 }
  ],
  "meta": {
    "fileHash": "md5hex",
    "dataHash": "sha256hex",
    "fileName": "duration.csv",
    "rowCount": 1
  }
}
```

## 7. 导出接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/exports/wave?date=YYYY-MM-DD` | 导出音浪数据 |
| GET | `/exports/duration?date=YYYY-MM-DD` | 导出时长数据 |
| GET | `/exports/anchors` | 导出主播档案 |

当前返回 JSON 数组，前端负责下载 CSV。后续如 App 需要文件下载，可扩展为 `text/csv` 或生成文件 URL。

## 8. 报告接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/reports/daily-wave?date=YYYY-MM-DD&gender=all` | 每日音浪报告 |
| GET | `/reports/tier-rules` | 等级规则 |
| PUT | `/reports/tier-rules` | 保存等级规则 |

## 9. 流动红旗接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/flags/groups?period=YYYY-MM` | 小组成绩 |
| POST | `/flags/settle` | 结算流动红旗 |
| GET | `/flags/winner?period=YYYY-MM` | 月度得主 |
| GET | `/flags/person/:personId` | 某主播所属红旗信息 |

## 10. PK 与奖励接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/pk/roster?period=YYYY-MM&groupSize=8` | PK 名单 |
| GET | `/rewards/report?period=YYYY-MM` | 奖励报表 |

## 11. 兼容接口

当前同时保留：

- `POST /api/ipc`

该接口用于网页服务器版快速兼容现有桌面端方法名。后续 iOS App 和新版桌面端优先使用 `/api/v1/**` REST 接口。

## 12. 客户端对接建议

### 12.1 iOS App

- 只使用 `/api/v1/**`。
- Token 存 Keychain。
- 写请求统一加：`Authorization: Bearer <token>`。
- 列表、报表先按当前接口取全量；后续数据变大再加分页参数。

### 12.2 桌面端

- 后续新增 API Base URL 设置项。
- 配置后桌面端可直接连接网站 API，不再直连数据库。
- 未配置时仍可保留 Electron IPC 兼容模式。

## 13. 后续待补

- 登录接口：`/auth/login`、`/auth/logout`、`/auth/me`、`/auth/refresh`
- 用户/角色权限模型
- 审计日志
- 分页与筛选参数
- OpenAPI/Swagger 文档导出
