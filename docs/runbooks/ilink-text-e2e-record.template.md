# iLink 文本 E2E 演练记录（模板）

> 复制本文件后填写。**禁止**写入完整 token / 密钥；账号仅脱敏。  
> 主 runbook：`docs/runbooks/ilink-text-e2e.md`

---

## 元信息

| 字段 | 填写 |
| --- | --- |
| 日期 | YYYY-MM-DD |
| 操作人 | |
| 仓库分支 / commit | |
| 账号（脱敏） | 例：wxid_***a1 / account_key=e2e-* |
| env 模式 | `file`（仅 BOT_ILINK_ENABLED） / `db`（+ BOT_ILINK_DB_ENABLED） |
| 是否有真实 token | yes / no（no 则步骤 5 可 skip） |
| 工作区 `BOT_ILINK_WORKSPACE_ID` | |
| `BOT_ILINK_ACCOUNT_KEY`（脱敏） | |
| status 路径 | |
| `BOT_OWNER_ID` | |

---

## 主路径结果

| 步骤 | 结果 (pass/fail/skip) | 备注 |
| --- | --- | --- |
| 1 停桌面 runner | | |
| 2 migrate | | |
| 3 启动 bot:worker | | |
| 4 status：phase / transport / persistence | | 实测：phase=___ transport=___ persistence=___ |
| 5 私聊文本 → ack | | 发送内容摘要（可脱敏）： |
| 6 SQL 检查 | | |
| 7 SIGTERM | | |
| 8 回切桌面 | | |

### 关键观测值

| 字段 | 值 |
| --- | --- |
| inbox id | （`inbox_messages.id`，无则 n/a） |
| outbox id | |
| outbox status | prepared / sending / sent / retry_wait / unknown / dead_letter / … |
| outbox reconcile_status | |
| 是否收到 ack | yes / no / skip |
| fencing_token | |
| dbAccountId | |
| receivedCount / sentCount | |
| outboxSentCount / outboxPending | |

---

## 故障剧本（勾选已做）

| 场景 | 已做 | 结果 | 备注 |
| --- | --- | --- | --- |
| kill -9 中途 → reclaim → retry_wait | ☐ | pass/fail/skip | |
| 双 Worker 同 account 仅一方 lease | ☐ | pass/fail/skip | |
| 坏 token → session_expired / 可观察错误 | ☐ | pass/fail/skip | |
| unknown + resolveUnknown 三态 | ☐ | pass/fail/skip | 记录用了 sent / dead_letter / retry： |

---

## 异常与日志摘要

```
（粘贴关键 lastError / 日志行，已脱敏 Bearer / token）
```

---

## 结论

| 项 | 值 |
| --- | --- |
| 结论 | **pass** / **fail** / **partial** |
| 阻塞项 | |
| 下一步 | |

操作人签字 / 日期：________________
