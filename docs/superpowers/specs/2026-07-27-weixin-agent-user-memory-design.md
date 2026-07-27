# 微信 Agent 每用户记忆与习惯 · 设计规格

| 项 | 内容 |
| --- | --- |
| 版本 | v1.0.0 |
| 日期 | 2026-07-27 |
| 状态 | Accepted（用户确认一期：习惯画像 + 加强对话；习惯仅自动学习；开始实现） |
| 范围 | 桌面 `WeixinBotAgent` 每用户对话落盘加长 + 业务习惯画像自动学习与注入 |
| 非范围 | 显式「记住」口令、向量记忆、多 Agent 人设、跨账号全局画像、服务器 worker 生产记忆 |
| 相关 | `2026-07-24-weixin-single-agent-skills-design.md`、进度回执规格 |

> 冲突时：本规格 + 实现代码 > 过时文档。仍遵守：单 Agent、数字只出技能、iLink 唯一用户通道。

---

## 1. 问题

1. 对话线程仅内存、约 8 轮 / 30min，重启即丢，跨句指代弱。  
2. 无每用户业务习惯，每次都从零猜常查主播与偏好。

## 2. 目标（一期）

1. **加强对话**：落盘、加长、更长 TTL；「清空对话」只清线程。  
2. **习惯画像**：仅从成功技能调用自动学习；注入极短摘要到 system。  
3. 账号/用户/群隔离，不串会话。  
4. 习惯与数字分离：习惯只影响理解与默认偏好，不冒充库内数字。

## 3. 方案

**采用：每用户 Profile JSON + 线程落盘加长。**

不采用：仅内存加长；全量 SQLite 用户模型。

## 4. 会话键

与现有 `threadKeyFromContext` 对齐：

- 私聊：`a:{accountId}|u:{userId}`  
- 群聊：`a:{accountId}|g:{groupId}|u:{userId}`  

画像键与线程键相同，避免串号。

## 5. 对话记忆

| 项 | 值 |
| --- | --- |
| 存储 | 运行时目录下用户记忆文件（见 §7） |
| 每线程最大轮次（user+assistant 对） | 20（消息条数约 40） |
| 单条 content 截断 | 2000 字（保持现状量级） |
| 线程总字符软顶 | 24_000 |
| 无活动 TTL | 24h |
| 最大线程数 | 200（超限按最旧淘汰） |
| 清空对话 | 删除该键线程；**不**删习惯画像 |
| 进程重启 | 从落盘恢复 |

Agent 启动/每次 handleMessage：读盘合并内存；写回在助手最终回复后与工具学习后。

## 6. 习惯画像

### 6.1 结构

```json
{
  "version": 1,
  "updatedAt": 0,
  "topAnchors": [{ "query": "小张", "count": 3, "lastAt": 0 }],
  "preferMetric": "wave|duration|mixed|null",
  "preferTeam": "male|female|both|null",
  "preferArtifact": "text|image|file|mixed|null"
}
```

- `topAnchors`：最多 8 条，按 `count` 与 `lastAt` 排序保留。  
- `prefer*`：由成功工具种类统计主导（简单计数/最近一次加权即可）。

### 6.2 学习规则（仅自动）

在 `skills.execute` **成功**（`ok !== false` 且无抛错）后：

| 技能 | 学习 |
| --- | --- |
| 含主播 query 的查数技能 | 累加 `topAnchors`（用用户/工具参数中的 query 规范化短串） |
| wave 类 | `preferMetric` 倾向 wave |
| duration 类 | 倾向 duration |
| 日报 gender | 更新 `preferTeam` |
| export image | `preferArtifact` image |
| export file/csv | `preferArtifact` file |
| rag_search / 失败 | 不学习 |

不学习：空 query、纯帮助、未解析主播。

### 6.3 注入

若画像非空，在 system persona 后追加一小段，例如：

```text
【用户习惯·自动】常查：小张、小李。偏好：音浪；团队：女队。当轮用户明确要求优先于习惯。禁止用习惯编造数字。
```

上限约 300 字。无习惯则不追加。

### 6.4 清除

| 操作 | 行为 | 实现状态（以代码为准） |
| --- | --- | --- |
| 「清空对话」/「退出客服」等（`SYSTEM_DISABLE_RE`） | **只清线程**；**不**删习惯画像；会话仍保持 `agent` | ✅ `clearThread` + mode 口令 |
| 「清除习惯」/「清除我的习惯」/「清空习惯」 | 清 profile（习惯画像）；**不**必然清线程 | ✅ `matchSystemToken` → `clear-habits` → `agent.clearProfile` / `userMemory.clearProfile` |
| env `AI_USER_MEMORY=0` | 关闭读写与注入（默认开） | ✅ |

产品语义：**清空对话 ≠ 清除习惯**。两套口令分词、分路径。

## 7. 存储

路径建议：

`{BOT_STORAGE_DIR 或 data/runtime}/memory/weixin-user-memory.json`

或拆分：

- `.../memory/threads.json`  
- `.../memory/profiles.json`  

要求：写时 temp+rename；chmod 600 风格与 bot store 一致；容量 prune。

实现可新建 `electron/weixin-bot-user-memory.js`，由 Agent 调用，避免继续膨胀 `weixin-bot-agent.js` 无边界。

## 8. 与现有模块关系

| 模块 | 关系 |
| --- | --- |
| `weixin-bot-agent.js` | 使用 memory 模块读写线程/画像；注入 system；工具成功后 learn |
| `weixin-bot-session-store.js` | Web/server 会话；桌面一期可不强行合并，避免破坏 server 契约 |
| `weixin-bot-mode.js` | 清空对话仍清 agent 线程；调用 memory.clearThread |
| 进度回执 | 独立；记忆不改变进度文案 |

## 9. 测试

1. 落盘后新 Agent 实例能读回线程。  
2. 成功 wave 工具后 topAnchors 增加；失败不增加。  
3. system 消息含习惯摘要（有画像时）。  
4. 不同 userId 画像隔离。  
5. clearThread 后线程空、画像仍在。  
6. `AI_USER_MEMORY=0` 不读写。  
7. 噪声 query / 未匹配 observation 不进 topAnchors。  
8. 「清除习惯」清 profile、保留线程。

## 10. 成功标准

- 重启后仍记得近期对话要点（在 TTL/轮次内）。  
- 常查主播会出现在习惯摘要中。  
- 不把习惯当音浪/时长数字来源。  
- 单测通过。

## 11. 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-27 | 初版；用户确认一期并开始实现；清空对话不清习惯 |
| 2026-07-27 | §6.4：清空对话只清线程；「清除习惯」口令已接线（mode + commands + clearProfile） |
| 2026-07-27 | 学习硬化：噪声 query 过滤；observation 补名；未匹配不写 topAnchors |
