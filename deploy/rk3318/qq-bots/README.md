# QQ 多机器人配置

一个 `.json` 文件 = 一个 QQ 官方机器人实例。启动时自动扫描本目录（`*.json`），
逐个建立 WebSocket 连接；文件名（去掉扩展名）就是实例标识。

## 格式

```json
{
  "appId": "102xxxxx",
  "clientSecret": "你的 ClientSecret",
  "label": "主机器人",
  "enabled": true
}
```

- `appId` / `clientSecret`：必填，来自 https://q.qq.com 机器人后台
- `label`：可选，仅用于日志与状态展示
- `enabled`：可选，`false` 表示跳过这个配置
- 其它字段（`apiBase` / `intents` / `autoConnect` / `boundUserIds` 等）与旧
  `qq-bot.v1.json` 一致，服务运行中会把状态写回同一个文件

## 规则

- 同一 `appId` 只生效一份（按文件名排序，先命中者胜）
- JSON 解析失败 / 缺 `appId` / 缺 `clientSecret` 的配置会被跳过，并在启动日志中说明原因
- 兼容旧写法：上级目录的 `qq-bot.v1.json` 作为单机器人配置同样会被加载
- 也可用环境变量 `QQ_BOTS_DIR` 指向其它目录（优先级最高）

## 新增一个机器人的步骤

1. 在 q.qq.com 再创建一个机器人，拿到自己的 AppID 与 ClientSecret
2. 复制上面的格式，存成 `robot2.json` 放进本目录
3. 重启容器：`cd /srv/douyin/app && DOUYIN_DATA_DIR=/srv/douyin docker compose -f docker-compose.rk3318.yml up -d`
4. 验证：`curl http://127.0.0.1:3000/api/v1/bots/qq/bots -H 'authorization: Bearer <API_TOKENS>'`
