# iOS App 设计与对接说明

> 日期：2026-07-06

> **【文档关系 · 2026-07-23】**
> 本文为 iOS App 方向稿。iLink 是唯一最终用户 Agent 通道；App 只作为受保护的数据与管理客户端，实施顺序以 Agent 生产计划和运行契约 ADR 为准。

## 1. 定位

iOS App 是抖音数据管理系统的移动端客户端，只通过网站服务器 API 访问数据，不直连 MySQL。

```text
iOS App
  -> HTTPS
  -> 网站服务器 /api/v1/**
  -> 网站数据库 MySQL
```

## 2. 登录与鉴权

- 网站浏览器后台：使用账号密码登录。
- iOS App：不使用网站账号密码，使用 API Token。
- API Token 由网站服务器 `.env` 配置：

```env
API_TOKENS=ios_token_1,ios_token_2
```

App 请求统一携带：

```http
Authorization: Bearer ios_token_1
```

Token 在 App 内保存到 Keychain。

## 3. 当前 iOS 代码位置

```text
ios/DouyinApp/
  Package.swift
  Sources/DouyinApp/
    DouyinApp.swift
    Core/
      APIClient.swift
      AppState.swift
      TokenStore.swift
    Models/
      APIModels.swift
    Views/
      ConfigView.swift
      DashboardView.swift
      AnchorsView.swift
      RankingView.swift
      DailyReportView.swift
      SettingsView.swift
```

## 4. 当前页面

- 连接配置页
  - API Base URL
  - API Token
  - 保存到 Keychain
- 仪表盘
  - 主播数
  - 账号数
  - 总音浪
  - 总时长
- 主播列表
  - 搜索主播名、抖音 ID、师傅
- 音浪排行
- 日报
  - 日期
  - 性别筛选
- 设置
  - 测试连接
  - 重新配置

## 5. 已对接接口

| 页面 | 接口 |
| --- | --- |
| 连接配置 | `GET /api/v1/health`、`GET /api/v1/dashboard/summary` |
| 仪表盘 | `GET /api/v1/dashboard/summary` |
| 主播列表 | `GET /api/v1/anchors` |
| 音浪排行 | `GET /api/v1/dashboard/wave-ranking?limit=50` |
| 日报 | `GET /api/v1/reports/daily-wave?date=YYYY-MM-DD&gender=all` |
| 设置 | `GET /api/v1/health` |

## 6. 本地验证

当前机器只有 Command Line Tools，没有完整 Xcode，因此先用 Swift Package 验证语法：

```bash
cd ios/DouyinApp
swift build
```

验证结果：已通过。

## 7. 下一步

- 安装完整 Xcode 后生成/打开 iOS App 工程。
- 补充 App 图标、Bundle ID、签名配置。
- 增加新增/编辑主播、导入数据、奖励报表等写操作页面。
- 增加错误重试、空状态、加载骨架屏。
