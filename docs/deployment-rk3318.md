# RK3318 BOX 部署说明（arm64 / Docker）

> 分支：`3318`
> 目标机：Rockchip RK3318 BOX 电视盒子

| 项 | 值 |
| --- | --- |
| SoC | Rockchip RK3318，4× Cortex-A53 |
| 架构 | aarch64 / arm64（ARMv8-A），`dpkg --print-architecture` = `arm64` |
| 系统 | Armbian 26.2.0-trunk.488 trixie = Debian GNU/Linux 13 |
| 内核 | 6.18.13-current-rockchip64 |
| Docker | 29.1.3（API 1.52），原生 `linux/arm64`，overlayfs + cgroup v2 + systemd |

部署形态：**盒子只跑 Web（Next.js）+ 可选 bot-worker**。桌面 Electron 安装包仍是
macOS / Windows x64，不会在盒子上运行。

---

## 1. 盒子侧前置

```bash
# 确认平台
uname -m                       # aarch64
dpkg --print-architecture      # arm64
docker info --format '{{.Architecture}} {{.CgroupVersion}} {{.Driver}}'
# 期望：aarch64 2 overlayfs

# 内存：RK3318 常见 2–4 GB。2 GB 机器必须先加 swap，否则 next build 会被 OOM kill
sudo armbian-config            # System → 启用 zram，或手工建 2G swapfile
free -h
```

目录准备（compose 默认挂到这里）：

```bash
sudo mkdir -p /srv/douyin/{app,runtime,artifacts,exports,fonts}
sudo chown -R $USER /srv/douyin
```

> `assets/fonts/` 里的阿里巴巴普惠体**不在仓库里**（被 `.gitignore` 排除）。
> 出中文图（日报 / PK 分组图）必须把字体放到 `/srv/douyin/fonts` 并挂载，
> 否则图片里中文变方框。基础镜像只装了 `fonts-noto-cjk` 兜底。

## 2. 构建镜像

两条路，选一条。

### A. 盒子上原生构建（推荐，无 QEMU 开销）

```bash
git clone <repo> /srv/douyin/app && cd /srv/douyin/app
git checkout 3318
npm run docker:build          # docker build --platform linux/arm64 ...
```

4×A53 上完整 `npm ci + next build` 约 10–25 分钟。构建堆上限写死在 Dockerfile
的 `BUILD_NODE_OPTIONS`（默认 2048 MB），2 GB 机器可下调：

```bash
docker build --platform linux/arm64 \
  --build-arg BUILD_NODE_OPTIONS=--max-old-space-size=1400 \
  -t douyin-data-manager:arm64 .
```

### B. x64 开发机交叉构建 → 传盒子

```bash
npm run docker:buildx         # buildx + QEMU，产出本地 arm64 镜像
npm run docker:save           # release/douyin-arm64.tar
scp release/douyin-arm64.tar root@<盒子IP>:/tmp/
ssh root@<盒子IP> 'docker load -i /tmp/douyin-arm64.tar'
# 或推送到仓库后在盒子 docker pull
bash scripts/docker-build-arm64.sh --push ghcr.io/<owner>/douyin:arm64
```

Linux 开发机没有 QEMU binfmt 时先装：

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64
```

## 3. 配置

```bash
cd /srv/douyin/app
cp deploy/rk3318/.env.example deploy/rk3318/.env
$EDITOR deploy/rk3318/.env
```

要点：

- **数据库**：盒子宿主已装 MySQL 时，`DB_HOST=host.docker.internal`
  （compose 已注入 `host-gateway`）。容器访问宿主 `127.0.0.1:3306` 就是这个别名。
- **盒子没装 MySQL**：`docker compose --profile db up -d`，并把
  `DB_HOST` 改成 `douyin-mysql`。MySQL 8.4 官方镜像有 `linux/arm64` 版本。
- `ARTIFACT_ROOT=/var/lib/douyin/artifacts`、`BOT_STORAGE_DIR=/app/data/runtime`
  与 compose 挂载卷一一对应，**别改成容器内非挂载路径**，否则容器重建即丢。
- 口令/token 只放 `deploy/rk3318/.env`（该文件已在 `.gitignore` 中，不会入库）。

## 4. 启动

```bash
export DOUYIN_DATA_DIR=/srv/douyin
docker compose -f docker-compose.rk3318.yml up -d            # 镜像已存在
# 首次或改了代码：
docker compose -f docker-compose.rk3318.yml up -d --build

# 数据库迁移（每次发布前必做）
docker compose -f docker-compose.rk3318.yml run --rm web node scripts/migrate.js up
docker compose -f docker-compose.rk3318.yml run --rm web node scripts/migrate.js status
```

开机自启（Armbian 是 systemd）：

```bash
sudo cp deploy/rk3318/douyin-compose.service /etc/systemd/system/
sudo sed -i "s#/srv/douyin/app#$(pwd)#" /etc/systemd/system/douyin-compose.service
sudo systemctl daemon-reload && sudo systemctl enable --now douyin-compose
```

## 5. 验证

```bash
docker compose -f docker-compose.rk3318.yml ps          # web 应为 healthy
curl -fsS http://127.0.0.1:3000/api/v1/health
curl -fsS http://127.0.0.1:3000/api/v1/dashboard/summary \
  -H "authorization: Bearer <API_TOKENS>"
docker compose -f docker-compose.rk3318.yml run --rm web node scripts/storage-doctor.mjs
```

`storage-doctor` 会报告 `artifactsDefault` / `ARTIFACT_ROOT`，确认它指向挂载卷。

## 6. 资源与磁盘

盒子 eMMC 有限，compose 已做两件事：

- 日志 `json-file`，单文件 10 MB、保留 3 份（避免刷爆 eMMC）
- `web` 默认 `mem_limit=1024m` / `memswap_limit=1536m`，可按内存改
  `DOUYIN_WEB_MEM` / `DOUYIN_WEB_MEMSWAP`

调节运行时堆：`NODE_OPTIONS=--max-old-space-size=1024`（镜像默认，compose 覆盖生效）。
2 GB 机器建议 512–768，并让 bot-worker 与 web 不要同时开。

若启动时看到 `WARNING: Your kernel does not support swap limit capabilities`，
说明内核没开 swap accounting，忽略即可（限制退化为仅内存）；想启用就在
`/boot/armbianEnv.txt` 的 `extraargs` 加 `cgroup_enable=memory swapaccount=1` 重启。

## 7. 已知限制

1. **原生依赖**：`sharp` 用 arm64 预编译二进制（`--omit=dev` 安装）；
   `better-sqlite3` 是 devDependency 且只给桌面备份脚本用（`init-backup-db.js` /
   `sync-backup.js`），**容器内不可用**，如需 SQLite 备份在桌面机跑。
2. **bot-worker 仍是实验性**：按 `CLAUDE.md` 第 4 节，未达 S7 前不得标记生产可用。
   默认不启动，需要时 `docker compose --profile bot up -d`。
   同一微信 iLink 账号**禁止**与桌面 Electron 同时在线。
3. **Electron 桌面端**仍只构建 mac/win x64（`npm run dist`），本分支不改变这点。
4. 镜像基础为 `node:22-bookworm-slim`（glibc 2.36），在 trixie 宿主上正常运行。

## 8. 回滚

```bash
docker compose -f docker-compose.rk3318.yml down
# 换回上一版镜像 tag 后重新 up；数据库回滚走 npm run db:backup 的备份
```

---

## 9. 实测记录（192.168.0.13，2026-09-17）

实测环境：`rk3318-box` / aarch64 / Armbian 26.11.0-trunk.51 trixie / 内核 6.18.52 /
3.9 GiB 内存 + 1.9 GiB swap / eMMC 15 GB（余 9.2 GB）/ Docker 29.8.1 arm64 / 4 核。

结果：**Web 服务已跑通**，`healthy`，Ready 6.2 s，空闲占用 CPU 0.15% / 内存 107 MiB。

```bash
curl http://192.168.0.13:3000/api/v1/health          # {"success":true,...}
curl http://192.168.0.13:3000/api/v1/dashboard/summary -H 'authorization: Bearer <API_TOKENS>'
```

### 踩过的四个坑（都已修，别重犯）

1. **拉不动 Docker Hub**。`auth.docker.io` 走 IPv6 直接 i/o timeout。必须配加速：
   ```json
   // /etc/docker/daemon.json
   { "registry-mirrors": ["https://dockerproxy.net", "https://hub.rat.dev"] }
   ```
   实测这两个源可达，`docker.m.daocloud.io` / `docker.1ms.run` / `docker.xuanyuan.me` 在
   该网络下不可达。改完 `systemctl restart docker`。同时 Dockerfile 里**不要**写
   `# syntax=docker/dockerfile:1.7`，否则还要多拉一个 frontend 镜像。
2. **`next start` 现场装 typescript 把容器卡死**。slim 镜像没有 typescript（devDep），
   而 `next.config.ts` 是 TS，Next 会 `npm install typescript` —— A53 上装不完，
   容器不进 healthy，配了 `restart: unless-stopped` 就变成无限重启，9 次后把 4 核榨干，
   连带拖死同时进行的 `docker build`。Dockerfile 已在 runtime 阶段用等价 `next.config.mjs`
   替换 `.ts`，启动从「卡到重启」变成 6.2 s 就绪。
3. **`COPY . .` 会把 Dockerfile 自己算进构建上下文**，于是「只改 Dockerfile」也会打穿
   缓存，`next build` 白跑 16 分钟。`.dockerignore` 里已排除 `Dockerfile*`、
   `docker-compose*.yml`、`.dockerignore`。
4. **`schema_migrations` 校验和全线不匹配**。远端 sqlpub 库的 4 条迁移记录是另一份代码
   写入的，与本仓库文件 checksum 不一致，迁移器按设计直接终止（库里表其实都在）。
   处理方式是对账（只改 `checksum` 字段，不动业务表）：用 `migrate.js status` 拿到
   `database=` / `local=` 两侧值，确认目标表（`ilink_*` / `outbox_messages` /
   `anchor_income*`）确实存在后，`UPDATE schema_migrations SET checksum=<local> WHERE version=?`，
   再 `status` 应全为 `applied`。**注意**：这是历史账目修正，不是 schema 变更。

### 构建耗时（4×A53，实测）

| 阶段 | 耗时 |
| --- | --- |
| 首次全量构建 | ~45 分钟（含 deb.debian.org 拉 56 MB 中文字体包，apt 阶段 41 分钟） |
| 改 Dockerfile 后重建 | ~25 分钟（缓存被打穿 + 旧容器抢 CPU；CPU 让出来后明显变快） |
| 容器启动 | 6.2 秒 |
| 镜像体积 | 内容 283 MB / 虚拟 1.18 GB |

### 该网络下的遗留问题

- **AI 网关不通**：盒子（192.168.0.13）访问不到 `192.168.5.12:80`，
  `AI_BASE_URL` 指向它时 AI 对话/Agent 技能会失败。要么换可达地址，要么在盒子上本地起网关。
- 远端库 `mysql7.sqlpub.com:3312` 从盒子可达，所以业务数据接口正常。
- `bot-worker` 未启动（实验性，需 `--profile bot`）；同一微信账号严禁与桌面 Electron 同时在线。

