# S2 · 凭据加密落库 + 二维码控制通道（实现计划）

> **面向 AI 代理：** 使用 subagent-driven-development；**波次 A 可并行**，波次 B 依赖 A 的凭据 API。  
> 总序：`docs/superpowers/plans/2026-07-24-ilink-server-sequential-roadmap.md` S2  
> 进度真值：`docs/ilink-implementation-progress.md`

**目标：**  
1. **S2a**：`ilink_accounts.credential_ciphertext` 可写入/读出 token；Worker DB 模式**优先读库**，env `BOT_ILINK_TOKEN` 仅开发 fallback。  
2. **S2b**：登录控制表 + 纯 Node 存储 API + Worker 可 claim 登录槽并调用 Adapter 扫码（最小闭环）；Web API 鉴权发起/轮询（最小）。  

**非目标：** 完整 RBAC 角色矩阵、Electron 全面改造、媒体、shared/bot-core、生产标签。

**技术栈：** 既有 `ilink-crypto`、`ilink-db-lease.ensureAccount`、`IlinkAdapter.getBotQrCode/getQrCodeStatus`、`src/server/api/auth.ts`、migration runner。

---

## 波次 A（可并行 2–3 代理）

### 任务 A1：凭据仓库 TDD

**文件：**
- 创建 `scripts/ilink-account-credentials.js`
- 创建 `scripts/ilink-account-credentials.test.js`

**API：**

```js
const { createAccountCredentialStore } = require("./ilink-account-credentials");
const store = createAccountCredentialStore({ pool, crypto });

// JSON payload: { token, baseUrl?, savedAt? }
await store.setCredential({
  workspaceId, accountKey, // or accountId
  token, baseUrl?,
})
// -> { ok:true, accountId }  // ensureAccount if needed via lease store inject or SQL upsert

await store.getCredential({ workspaceId, accountKey | accountId })
// -> { ok:true, token, baseUrl, accountId, keyId } | { ok:false, code:'NOT_FOUND' }

await store.clearCredential({ workspaceId, accountId })
// -> { ok:true }
```

**语义：**
- 使用 `crypto.encrypt(JSON.stringify({ token, baseUrl }))` 写入 `credential_ciphertext` / `credential_key_id`
- get 时 decrypt；失败 → ok:false code DECRYPT_ERROR
- 不落日志明文 token
- 可依赖 `createDbLeaseStore.ensureAccount` **或** 内联 upsert（与 ensureAccount 同 SQL）

**测试：** set→get roundtrip；clear；decrypt 失败；NOT_FOUND（fake pool）

**Commit：** `feat: encrypt iLink account credentials in MySQL`

---

### 任务 A2：Worker 读库凭据

**文件：** `scripts/bot-worker.js`、`scripts/bot-worker.test.js`

**行为：**
1. DB 模式 start 在 ensureAccount 之后：
   - 若 `transportConfig.token` 空 且 `credentialStore` 可用 → `getCredential`
   - 成功则填入 transport token / baseUrl
   - 仍空 → `not_configured`（与现网一致）
2. 注入 `dbRuntime.credentialStore` 供单测
3. `buildLiveDbRuntime` 创建 `createAccountCredentialStore`
4. env token **仍优先**（开发）：`if (env token) use env; else DB`

**测试：**
- 无 env token + credentialStore 返回 token → transport 启动用该 token（mock createTransport 捕获 config）
- 无 env 无 credential → not_configured

**Commit：** `feat: load iLink bot token from encrypted account row`

---

### 任务 A3：运维 seed 脚本 + 文档

**文件：**
- `scripts/ilink-seed-credential.js`（CLI：读 env 写库）
- `docs/server-deployment.md` 小节
- `docs/runbooks/ilink-credential-seed.md` 短文
- `package.json` 可选 `bot:seed-credential`

```bash
# BOT_RUNTIME_SECRET + DB_* + BOT_ILINK_WORKSPACE_ID + BOT_ILINK_ACCOUNT_KEY + BOT_ILINK_TOKEN
node scripts/ilink-seed-credential.js
```

**Commit：** `docs+chore: seed encrypted iLink credentials`

---

## 波次 B（A1 合并后）

### 任务 B1：migration `003_ilink_login_control.js`

表建议（可微调，须单测）：

**`ilink_login_requests`**
- id, workspace_id, login_slot_id (unique), account_id NULL, actor_id, status (`pending|claimed|succeeded|failed|expired|cancelled`)
- request_id, expires_at, claimed_by, claim_expires_at
- result_ciphertext, result_key_id（二维码/状态摘要加密，短 TTL）
- error_message（脱敏）
- created_at, updated_at

**测试：** migration-runner 加载/校验 id；可选 up 语句 smoke（与 001 风格一致）

**Commit：** `feat: migration for iLink login control channel`

---

### 任务 B2：`scripts/ilink-login-control.js` TDD

```js
createLoginControlStore({ pool, crypto, now })
createLoginRequest({ workspaceId, loginSlotId, actorId, accountId?, ttlMs })
claimLoginRequest({ workspaceId, loginSlotId, ownerId, fencing? })
writeLoginResult({ requestId, qrPayload | statusPayload }) // encrypt
getLoginResult({ workspaceId, loginSlotId, actorId }) // decrypt for control plane
cancelLoginRequest(...)
expireStale(...)
```

**Commit：** `feat: iLink login control store with encrypted results`

---

### 任务 B3：Worker 登录槽轮询（最小）

- env `BOT_ILINK_LOGIN_POLL=1` 或 DB 模式默认尝试 claim pending request
- claim 后 `IlinkAdapter.getBotQrCode` → writeLoginResult
- 轮询 `getQrCodeStatus` 直到成功 → setCredential + 更新 account status
- **日志禁止打印二维码内容/token**

**Commit：** `feat: bot-worker claims login slots and stores QR results`

---

### 任务 B4：Web API 最小面

- `POST /api/bot/login/start` — 鉴权后 createLoginRequest
- `GET /api/bot/login/status?slot=` — getLoginResult（no-store）
- `POST /api/bot/login/cancel`
- 复用现有 API token / session 鉴权 fail closed

**Commit：** `feat: authenticated bot login control API`

---

## 顺序与并行

```text
A1 凭据 store ──┬── A2 Worker 读库
                └── A3 seed 脚本/文档
         │
         ▼
B1 migration ── B2 login store ── B3 Worker 登录 ── B4 Web API
```

- **A1 / A3 可并行**（A3 可先写文档占位 API 名）  
- **A2 依赖 A1**  
- **B\* 依赖 A1**（成功登录后 setCredential）

---

## 验收

```bash
npm run test:ilink-db   # 含 credentials 测（package 需加入）
npm run test:bot-worker
npm run test:migrations # 含 003
```

手工：
1. seed credential → 清 env token → DB worker 能 poll  
2. （B 完成后）API start → worker 写 QR → 状态可查 → 登录成功写凭据  

---

## 边界

| 做 | 不做 |
| --- | --- |
| 加密凭据读写 | KMS 多租户密钥轮换 UI |
| 最小登录控制通道 | 完整 RBAC 角色编辑器 |
| env 开发 fallback | 删除桌面加密存储 |
| 文档更新 progress | 宣称生产可用 |
