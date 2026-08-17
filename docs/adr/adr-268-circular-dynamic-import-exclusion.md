# ADR-268: 循环依赖口径收窄到加载期：动态 import 不计入环 — check-circular 与白名单抗漂移整改

> **状态**: ✅ 已采纳（2026-10-23）
> **日期**: 2026-10-23

## 背景

2026-10-23 项目健康度体检（`docs/audit-playbook.md` 流程）发现度量层一个系统性盲区：
`scripts/_lib/source-graph.mjs` 先用 `text.replace(/\/\*[\s\S]*?\*\//g, …)` 剥块注释再匹配 import，
而行注释里的 `→ scene/*`、`**/*.ts` 之类 glob 会被当作块注释起点，惰性吞到下一个真 `*/`，
跨过的真实 import 行整行被置空 → 边丢失（假阴性）。立案见
`docs/buglog/2026-10-23-source-graph-line-comment-swallow-edges.md`（P2，🔴 未修复）。

迁移到 `scripts/_lib/import-scan.mjs` 线性状态机（ADR-254 B9 的治本方案）后，同时修掉第二个假阴性：
旧实现 `reDyna` 正则要求 `await import(`，**无 await 的动态 import 全部漏检**。

旧 vs 新全量 diff（362 文件）：`oldEdges=2005 → newEdges=2020`，新增 16 条、移除 1 条。
16 条新增边逐条 grep 核实为真实代码：
`scene/scene.ts:599/605`（惰性加载 `../menus/motion-popup`）、`:648`（`./motion/wasm-layers-blender`）、
`:660`（`../menus/motion-cloth-levels`）、`:681`（`./motion/perception`）、
`core/dev-hooks.ts:50`（`return import('../scene/motion/bone-override')`）、
`menus/model-detail.ts:250/618`（`import('./library-core')`）等；
唯一移除项是旧实现产生的假自环 `core/fileservice.ts → core/fileservice.ts`。

随之 `check:circular --strict` 从「0 个白名单外」变为「🔴 265 个新增环」，白名单 696 条中
234 条因「归并代表环的最短路径改变」而 key 漂移（环本身仍在）。量化归因（临时脚本对 362 文件
按 `kind==='dynamic'` 过滤重算）显示：

| 变体 | 代表环 | 命中白名单 | 新增 | 白名单失效 |
|------|--------|-----------|------|-----------|
| 含动态 import 边（旧口径） | 727 | 462 | **265** | 234 |
| 排除动态 import 边 | 651 | 651 | **0** | 45 |

即：265 个「新增环」**全部且仅**由动态边派生——`scene.ts` 一条惰性加载 `menus` 的边，
叠加既有 `menus → scene` 反向边，就展开出数十个代表环。

## 决策

1. **环口径 = 模块加载期依赖。** 静态 `import … from`、`export … from`、副作用 `import 'x'`
   计入；动态 `import('x')` 不计入。
   理由：ESM 中动态 import 惰性求值，永不产生「部分初始化模块的 undefined 绑定」（最坏只是挂起），
   不构成求值期循环——这正是循环依赖门禁要防的那类缺陷。动态耦合改由 `npm run dep:metrics`
   的边数/扇入扇出观察，不必阻断。
2. **实现：** `parseSourceImports(filePath, srcDir, { includeDynamic = true })` 与
   `scanSourceGraph(srcDir, { scope, localOnly, includeDynamic })` 增加选项，库层默认 `true`
   保持向后兼容；三个度量/门禁下游**全部显式传 `false`** 统一到加载期口径——
   `check-circular.mjs`、`dep-metrics.mjs`、`gen-dep-graph.mjs`。
   理由：三处若各用各的尺子，图上有的边台账上没有，看图的人会被误导（见「补充 1」）。
   仅 `gen-tier.mjs` 仍用默认 `true`（它算知识卡 tier 的反向图，口径可不同）。
3. **白名单收紧 45 条**（696 → 651）：这 45 条是「由动态边派生、口径收窄后不再成立」的环，
   走 `--update-allowlist` 的「只减不增」路径（`addedKeys=0` 才允许写盘）。
4. **白名单 key 改为节点集合**（原计划单独立项，同日落地，见「补充 2」）：判定口径从
   「归并代表环的路径字符串」换成 `cycleSetKey()` = `[...new Set(body)].sort().join('+')`，
   与 `representativeCycles` 的归并键同源。任何一条边变化让最短环改道，不再制造「旧条目已修复 +
   新路径算新增」的假漂移（本次 234 条漂移即此机制）。`key`/`path` 字段保留供人读。

## 备选方案

- **A. 把 265 个环人工登记进白名单。** `--update-allowlist` 的只减不增护栏会直接拒绝；
  即便人工编辑 JSON 绕过，也等于把「动态边派生环」固化为永久架构债（462 → 727，且每条都无到期日）。
  放弃。
- **B. 回退 source-graph 迁移。** 回到「0 个白名单外」的假象，同时保留两个漏检
  （注释吞边 + 无 await 动态 import）。放弃：门禁的价值在于真相，不在于绿灯。
- **C. 本次一并把白名单 key 换成节点集合。** 原判「需要重写 696 条存量 key 并变更文件格式，
  与「收窄口径」两个变量混在同一次提交里，出问题难以二分回溯」→ 拆开做。
  **后修正**：拆分后发现 key 口径不改，白名单就永远在漂移（本次 234 条假新增即证），
  且改动可在同一脚本内一次完成、可复算。当日按「补充 2」落地。

## 影响

- 改动文件：`scripts/_lib/source-graph.mjs`（`includeDynamic` 选项 + 口径注释）、
  `scripts/check-circular.mjs`（显式 `includeDynamic: false`、`cycleSetKey()` 判定口径、
  `loadAllowlist` 兼容读旧 `key` 字段）、`scripts/dep-metrics.mjs`（改为复用
  `check-circular` 的 `loadAllowlist`/`cycleSetKey`，删本地重复实现）、
  `scripts/gen-dep-graph.mjs`（显式 `includeDynamic: false`）、
  `scripts/circular-allowlist.json`（696 → 651 条，条目带 `set` 字段）。
  `docs/status.md` 由 `new-adr.mjs` 自动同步。
- 门禁状态：`node scripts/check-circular.mjs --strict` 恢复 exit 0（651 已知环 / 0 新增），
  且已接入 `.githooks/pre-push`（`TS_CHANGED=true` 时）与 `.github/workflows/ci.yml`
  （`Circular gate (ADR-268)`）——原「本来就不在推送链路上」的缺口已闭合。
- **台账同步门禁（补充 3）**：`docs/dep-metrics.md` 与 `docs/dep-graph.md` 新增 `--check` 模式，
  接线到 `npm run check:dep-docs` → `check:docs` 链尾、`.githooks/pre-push`（`TS_CHANGED=true`
  时自动重算并 stage）、`.github/workflows/ci.yml` 的 `Generated docs sync check` 组。
  此前这两份文档只在 pre-commit 里被静默重写，而 pre-push 的文档生成物组对「纯 frontend 变更」
  是**整体跳过**的——恰好在前端代码变化时，记录前端耦合的台账无人验。
- 口径统一后的下游：`dep:metrics` 与 `dep:graph` 均为 **1971** 条边 / 651 环，
  `check:layering` 仍 13 条反向边 / 15 处 import（它不走 source-graph，不受影响）。
- 后续：`check-circular.mjs` 的 `findImportLine()` 仍在用旧正则（含 `reDyna` 的 `await` 要求），
  只影响 `--edges`/`--diff` 的归因行号，可同步换成 `scanImportSpecs` + `index` 换算行号。

## 补充 1（同日）：三处下游口径原本是分裂的

初版声称「`dep:metrics` / `gen-dep-graph` / `check:layering` 观察口径保持不变（边数仍 2020）」，
实际只改了两处：`dep-metrics.mjs` 已传 `false`（台账变 1971），`gen-dep-graph.mjs` 未传
（仍 2020）。同一份源码，台账报 1971 条边、依赖图报 2020 条边，ADR 正文还写着「仍 2020」——
**正文、台账、图三者互相矛盾**。已全部统一为 `includeDynamic: false` 并复算。

## 补充 2（同日）：白名单 key 改节点集合

`normalizeCycleKey()`（路径旋转串）是判定口径，`representativeCycles()`（节点集合）是归并口径，
两把尺子永不相等。改为：

```js
export function cycleSetKey(cycle) {
  return [...new Set(cycle.slice(0, -1))].sort().join('+');
}
```

`loadAllowlist()` 读旧条目时回落 `cycleSetKey(String(c.key).split('→'))`，故存量 JSON 无需一次性
重写也能正确判定；`saveAllowlist()` 写入 `{ set, key, path }` 三元组，`set` 判定、`key`/`path` 供人读。
`dep-metrics.mjs` 删掉本地重复的 `loadAllowlist`，改调 `check-circular` 的导出——**同一个白名单，
同一个判定函数**，台账与门禁不可能再各算一套。

## 补充 3（同日）：台账 / 依赖图同步门禁

锐评现场最刺眼的一处：`docs/dep-metrics.md` 生成于 18:05，写着 2003 边 / 696 环；到 18:47
活代码已是 1971 边 / 651 环，台账仍在报旧数，而 `check:docs`、CI、pre-push 全绿。

原因两层，缺一不可：

1. 这两份生成物**只有 `--file`（写盘）没有 `--check`（比对）**，无法被任何门禁消费。
2. pre-push 的文档生成物组（`_check_funcmap` / `_check_docsindex` 等）在 `_NEED_DOCS_GEN=false`
   时整体跳过，而该开关对「纯 frontend 变更」正是 `false`——**记录前端耦合的台账，恰好在前端
   代码变化时不检查**。这是「仪表盘在报数」的第二层：不只闸门没关，是那个位置的闸门按设计就
   不对前端变更开放。

处置：`dep-metrics.mjs` 与 `gen-dep-graph.mjs` 增加 `--check`（不同步即 exit 1），统一入口
`npm run check:dep-docs`，接线三处：

- `check:docs` 链尾（本地全链）
- `.githooks/pre-push` 按 `TS_CHANGED` 触发（与文档生成物组的分流方向相反），漂移则自动重算并
  `git add`；重算失败才 `collect_fail`
- `ci.yml` 的 `Generated docs sync check` 组（与 funcmap / menumap 同组）

`check-cli.smoke.test.mjs` 增两条断言：仓库内两份生成物当前已同步；手工把一个数字改成 9999 即
变红（已实测验证失败路径，不是只写了 happy path）。

## 相关文档

- 缺陷立案：`docs/buglog/2026-10-23-source-graph-line-comment-swallow-edges.md`
- ADR-242（分层门禁，`check-layering` 同源于 import 扫描）
- ADR-254 B9（`import-scan.mjs` 线性状态机迁移计划）
- 度量台账：`docs/dep-metrics.md`
