# PK 分组页合并设计（只分组）

| 项 | 内容 |
|----|------|
| 日期 | 2026-07-31 |
| 状态 | 已实现 |
| 落点 | `pk-roster-page.tsx` + `electron/pk-group-engine.js` |
| 替代 | `2026-07-28-pk-stage-grouping-design.md`（三阶段 / 争霸运行时） |

## 1. 目标

把「争霸赛」与「PK 名单」合并为**唯一分组入口**：

1. 侧栏只留「PK 分组」；卸 star-battle 记分 / 晋级 / 监控回写 UI
2. 仅男团；打开页即引擎重算
3. 文本弹窗导入名单
4. 三种模式：顺序（high_to_low）、均衡（balanced）、能出分（score_capable）
5. 人拖到人互换；组标题拖改出场序
6. 硬间隔：浩阳↔浩沐 ≥4；啸泽↔啸帆 ≥3
7. 默认 ≥4 组（n≥16）；含 gap≥4 对时抬到 ≥5 组
8. 名牌右侧互斥显示总分（wave）或最新日（latestWave）

## 2. 架构

```
打开「PK 分组」
  → getPkRoster(+latestWave)
  → 白名单筛男团
  → IPC data:buildPkGroups → pk-group-engine（三模式）
  → 组卡片：人拖互换 / 组头改序 / gap 校验 / 导出
Bot make_pk_groups → 同一引擎（+ score_capable）
```

约束校验抽到 `shared/pk-group-constraints.js`，引擎与前端共用。

## 3. 非目标

- 三阶段初/中/终赛
- 女团
- 监控分入库
- 现场记分 UI（DB API 可只读残留）

## 4. 关键文件

- `electron/pk-group-engine.js` — 三模式 + 组数下限
- `shared/pk-group-constraints.js` / `shared/pk-roster-stats.js`
- `electron/db.js` `getPkRoster` → `latestWave`
- `src/components/desktop/pk-roster-page.tsx` — 分组-only UI
- `src/components/desktop/pk-roster-config.ts` — 单一名单
- 导航：`types.ts` / `shell.tsx`；删除 `star-battle-page.tsx`
