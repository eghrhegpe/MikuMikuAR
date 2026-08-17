# 依赖耦合台账（dep-metrics）

> 由 `scripts/dep-metrics.mjs` 自动生成（`npm run dep:metrics`）——勿手改。
> 口径：`frontend/src` 内部已解析 import 边（测试文件除外）；模块分组与环检测与 `check:circular` 同源，白名单同读 `scripts/circular-allowlist.json`。
> [ADR-268] 边与环均按「加载期依赖」计：动态 import() 惰性求值、不产生部分初始化绑定，故不计入（与 check:circular --strict 完全同口径，冒烟测试 check-cli.smoke.test.mjs 断言台账白名单外环恒为 0）。

## 1. 总账

| 指标 | 值 |
|------|----|
| 模块文件数 | 377 |
| 文件级依赖边 | 1816 |
| 模块数 | 14 |
| 跨模块有向对 / 文件边 | 62 / 1065 |
| 双向密耦模块对 | 10 |
| 代表环（白名单内 / 外） | 551（551 / 0） |
| 文件级强连通分量（非平凡） | 4 个 / 覆盖 8 文件 / 最大 2 |
| 模块折叠法 SCC（非平凡） | 1 个 / 最大 14 ⚠️ 见 7.2 盲区 |
| 文件级支撑的真实模块 SCC | 0 个 / 最大 0 |
| 代表环中有结构支撑的 | 0 / 551（其余 551 为折叠假象） |
| 白名单复核到期日（reviewBy） | 2027-01-21 |
| 文件平均扇入/扇出 | 4.82 / 4.82 |
| 管路节点数（Ca≥10 且 Ce≥10） | 4 |

## 2. 尺子定义（勿自造刻度）

- **Ca**（afferent）＝被多少个内部文件 import；**Ce**（efferent）＝它 import 了多少个内部文件。
- **I** ＝ Ce/(Ca+Ce)：0≈稳定核心，1≈叶梢；0/0 记「—」。
- **管路节点**：Ca≥10 且 Ce≥10——高入高出的中枢，牵一发动全身。
- **环**：模块级全量简单环枚举后按节点集合并为最短代表环（同门禁）。⚠️ 折叠法有系统性盲区，见 7.2。
- **强连通分量（SCC）**：Tarjan 求「互相可达」的极大节点集。与「环」的区别是结构 vs 记账：
  环数是路径等价类的计数，任何一条边增删都会让它剧烈波动却不描述结构；SCC 直接回答
  「哪些文件必须一起理解/一起迁移」。**判读耦合请用 SCC，环数只作历史对照与门禁输入。**
- **折叠盲区**：把文件折叠成模块会丢弃模块内边（本仓 751/1816 条），模块内环折叠成自环后
  被 `path.includes` 排除 ⇒ 整类消失；跨模块环又被「只留最短代表环」挤掉。实测 4 个真实 SCC
  里折叠法可见 0 个，551 个代表环里只有 0 个有文件级支撑。**环数不是耦合强度。**

## 3. 文件级耦合 Top（各 15）

### 3.1 被接最多（Ca）

| 文件 | Ca | Ce | I |
|------|----|----|---|
| `core/config.ts` | 111 | 10 | 0.08 |
| `core/logger.ts` | 90 | 0 | 0.00 |
| `core/i18n/t.ts` | 87 | 2 | 0.02 |
| `core/feedback.ts` | 44 | 4 | 0.08 |
| `core/toast.ts` | 43 | 1 | 0.02 |
| `core/scene-action-bridge.ts` | 41 | 1 | 0.02 |
| `core/wails-bindings.ts` | 40 | 2 | 0.05 |
| `core/ui-helpers.ts` | 37 | 12 | 0.24 |
| `core/dispose-helpers.ts` | 36 | 0 | 0.00 |
| `menus/render-menu.ts` | 34 | 9 | 0.21 |
| `core/clamp.ts` | 30 | 0 | 0.00 |
| `scene/scene.ts` | 30 | 48 | 0.62 |
| `core/state.ts` | 27 | 6 | 0.18 |
| `core/i18n/goerr.ts` | 26 | 1 | 0.04 |
| `core/async.ts` | 25 | 1 | 0.04 |

### 3.2 接人最多（Ce）

| 文件 | Ca | Ce | I |
|------|----|----|---|
| `scene/scene.ts` | 30 | 48 | 0.62 |
| `menus/scene-menu.ts` | 2 | 33 | 0.94 |
| `menus/model-detail.ts` | 2 | 31 | 0.94 |
| `scene/scene-serialize.ts` | 2 | 30 | 0.94 |
| `core/init.ts` | 1 | 27 | 0.96 |
| `menus/settings-system.ts` | 1 | 27 | 0.96 |
| `scene/manager/model-loader.ts` | 1 | 25 | 0.96 |
| `menus/library-actions.ts` | 2 | 23 | 0.92 |
| `menus/env-menu.ts` | 2 | 22 | 0.92 |
| `menus/library-browse.ts` | 2 | 21 | 0.91 |
| `menus/settings-diagnostic.ts` | 1 | 21 | 0.95 |
| `menus/library-core.ts` | 3 | 20 | 0.87 |
| `menus/motion-override-levels.ts` | 1 | 20 | 0.95 |
| `scene/render/lighting.ts` | 11 | 20 | 0.65 |
| `menus/library-setup.ts` | 3 | 19 | 0.86 |

### 3.3 耦合乘积 Top10（管路节点候补）

| 文件 | Ca | Ce | Ca×Ce | I |
|------|----|----|-------|---|
| `scene/scene.ts` | 30 | 48 | 1440 | 0.62 |
| `core/config.ts` | 111 | 10 | 1110 | 0.08 |
| `core/ui-helpers.ts` | 37 | 12 | 444 | 0.24 |
| `menus/render-menu.ts` | 34 | 9 | 306 | 0.21 |
| `scene/render/lighting.ts` | 11 | 20 | 220 | 0.65 |
| `core/feedback.ts` | 44 | 4 | 176 | 0.08 |
| `core/i18n/t.ts` | 87 | 2 | 174 | 0.02 |
| `core/state.ts` | 27 | 6 | 162 | 0.18 |
| `menus/menu.ts` | 8 | 18 | 144 | 0.69 |
| `scene/manager/model-ops.ts` | 7 | 16 | 112 | 0.70 |

## 4. 模块耦合矩阵（行=接入方 → 列=被接方，格=跨模块文件边数）

| from\to | core | menus | motion-algos | scene | scene/ar | scene/camera | scene/env | scene/manager | scene/motion | scene/physics | scene/pose | scene/render | scene/shared | scene/transform |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `core` | · | **1** |  | **2** |  |  |  | **2** |  | **1** |  | **3** |  |  |
| `menus` | **476** | · | **4** | **29** | **3** | **3** | **10** | **6** | **23** |  | **3** | **12** |  | **4** |
| `motion-algos` | **12** |  | · |  |  |  |  |  |  |  |  |  |  |  |
| `scene` | **37** |  | **2** | · |  | **2** | **11** | **10** | **12** | **3** |  | **6** |  | **3** |
| `scene/ar` | **12** |  |  | **1** | · |  | **2** |  | **1** |  |  | **1** |  |  |
| `scene/camera` | **25** |  |  | **1** |  | · | **1** |  |  |  |  |  |  |  |
| `scene/env` | **83** |  |  | **2** |  |  | · |  |  | **2** |  | **8** |  | **2** |
| `scene/manager` | **60** |  |  | **1** |  | **2** | **3** | · | **4** | **1** |  | **2** | **2** | **3** |
| `scene/motion` | **72** |  | **25** | **3** |  |  | **4** |  | · |  |  |  |  |  |
| `scene/physics` | **14** |  |  |  |  |  |  |  |  | · |  |  |  |  |
| `scene/pose` | **2** |  |  | **1** |  | **1** |  |  |  |  | · |  |  |  |
| `scene/render` | **35** |  |  |  |  |  |  |  |  |  |  | · | **1** | **4** |
| `scene/shared` | **1** |  |  |  |  |  |  |  |  |  |  |  | · |  |
| `scene/transform` | **2** |  |  |  |  |  |  |  |  |  |  | **1** |  | · |

## 5. 模块台账（按总耦合降序）

| 模块 | 文件数 | Ca | Ce | I | 环参与 |
|------|--------|----|----|---|--------|
| `core` | 143 | 831 | 9 | 0.01 | 539 |
| `menus` | 78 | 1 | 573 | 1.00 | 412 |
| `scene/motion` | 41 | 40 | 104 | 0.72 | 217 |
| `scene/env` | 31 | 31 | 97 | 0.76 | 331 |
| `scene` | 10 | 40 | 86 | 0.68 | 422 |
| `scene/manager` | 15 | 18 | 78 | 0.81 | 293 |
| `scene/render` | 15 | 33 | 40 | 0.55 | 263 |
| `motion-algos` | 19 | 31 | 12 | 0.28 | 46 |
| `scene/camera` | 8 | 8 | 27 | 0.77 | 208 |
| `scene/physics` | 5 | 7 | 14 | 0.67 | 64 |
| `scene/ar` | 3 | 3 | 17 | 0.85 | 118 |
| `scene/transform` | 4 | 16 | 3 | 0.16 | 195 |
| `scene/pose` | 3 | 3 | 4 | 0.57 | 109 |
| `scene/shared` | 2 | 3 | 1 | 0.25 | 146 |

## 6. 双向密耦模块对（两城互搭吊桥）

| 模块 A | 模块 B | A→B | B→A |
|--------|--------|-----|-----|
| `core` | `menus` | 1 | 476 |
| `core` | `scene` | 2 | 37 |
| `core` | `scene/manager` | 2 | 60 |
| `core` | `scene/physics` | 1 | 14 |
| `core` | `scene/render` | 3 | 35 |
| `scene/render` | `scene/transform` | 4 | 1 |
| `scene` | `scene/camera` | 2 | 1 |
| `scene` | `scene/env` | 11 | 2 |
| `scene` | `scene/manager` | 10 | 1 |
| `scene` | `scene/motion` | 12 | 3 |

## 7. 强连通分量（结构口径 · 判读耦合用这个）

> 「哪些文件必须一起理解」——SCC 内任意两点互相可达，改一个就得同时看懂另一个。
> 环数（第 8 节）会随边增删剧烈波动，SCC 不会：**同样的拓扑，环数可以差十倍，SCC 不变。**

### 7.1 文件级 SCC（4 个 / 覆盖 8 文件 / 最大 2）

| # | 大小 | 模块构成 | 成员 |
|---|------|----------|------|
| 1 | 2 | menus×2 | menus/library-actions.ts<br>menus/library-core.ts |
| 2 | 2 | scene/env×2 | scene/env/env-ground-spec.ts<br>scene/env/env-ground.ts |
| 3 | 2 | scene/manager×2 | scene/manager/material-sss.ts<br>scene/manager/material.ts |
| 4 | 2 | scene×2 | scene/scene-serialize.ts<br>scene/scene.ts |

### 7.2 模块级 SCC 与折叠盲区（读第 8 节前必看）

**这一节是台账最重要的读数。** 模块级 SCC 与代表环都建立在「把文件折叠成模块」之上，
而折叠会丢弃模块内边——本仓 1816 条文件边里 **751 条是模块内边**，被折叠法整类丢弃。

| 口径 | 读数 | 含义 |
|------|------|------|
| 模块折叠法 SCC | 1 个 / 最大 14 模块 | 只反映「模块间边是否存在」 |
| 文件级支撑的真实模块 SCC | 0 个 / 最大 0 模块 | 由文件级 SCC 反推，能指导拆分 |
| 代表环中有文件级支撑的 | 0 / 551 | 其余 551 个是折叠假象 |
| 代表环（剔除 27 个入度为 0 的入口文件后） | 139 | 更接近结构事实 |

无跨模块的文件级 SCC——所有真实环都在单个模块内部。

> 盲区成因：① 模块内环折叠成自环，`detectCycles` 用 `path.includes` 排自环 ⇒ 整类环消失；
> ② 跨模块 SCC 已为 0（模块图是 DAG），但折叠法仍报 551 个代表环：
> 这些环全部由「模块内边被丢弃 + 入口文件被折叠进模块」两个记账假象产生，**没有一个有结构支撑**——
> 环数不能用来判断耦合，只能用作门禁的回归棘轮。

> **第三个假象源：入口文件被折叠进模块。** 本仓 27 个文件入度为 0（应用入口与独立叶子），
> 其中 `core/main.ts` 与 `core` 其余文件合并成同一个模块节点。它指向 `menus/library-setup` 的那条边
> 因此被记成 `core→menus`，让 menus 这个纯叶子模块凭空获得回边。剔除全部入口文件后代表环 **551 → 139**，
> 而只剔除 `core/main.ts` 一个文件效果完全相同——**那消失的 412 个环全部由「应用入口住在 core 里」这一个记账选择产生。**
> 入口文件天然入度 0，不可能是环的中间节点；把它们折叠进业务模块是度量口径缺陷，不是架构缺陷。

## 8. 残留环清单（代表环 · 历史对照 + 门禁输入）

| 环 | 长度 | 白名单 |
|----|------|--------|
| `core → menus → core` | 2 | ✅ 已知 |
| `core → menus → motion-algos → core` | 3 | ✅ 已知 |
| `core → menus → scene → motion-algos → core` | 4 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → motion-algos → core` | 5 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → motion-algos → core` | 5 | ✅ 已知 |
| `core → menus → scene/motion → motion-algos → core` | 4 | ✅ 已知 |
| `core → menus → scene/ar → scene → motion-algos → core` | 5 | ✅ 已知 |
| `core → menus → scene/ar → scene/env → scene → motion-algos → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene/env → scene → scene/manager → scene/motion → motion-algos → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene/env → scene → scene/motion → motion-algos → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/motion → motion-algos → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/motion → motion-algos → core` | 6 | ✅ 已知 |
| `core → menus → scene/camera → scene → motion-algos → core` | 5 | ✅ 已知 |
| `core → menus → scene/camera → scene/env → scene → motion-algos → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene/env → scene → motion-algos → core` | 7 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene/env → scene → scene/motion → motion-algos → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/manager → scene/motion → motion-algos → core` | 9 | ✅ 已知 |
| `core → menus → scene/camera → scene/env → scene → scene/motion → motion-algos → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/motion → motion-algos → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → motion-algos → core` | 7 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene → motion-algos → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene → scene/motion → motion-algos → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/motion → motion-algos → core` | 8 | ✅ 已知 |
| `core → menus → scene/camera → scene → scene/motion → motion-algos → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/motion → motion-algos → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → motion-algos → core` | 6 | ✅ 已知 |
| `core → menus → scene/env → scene → motion-algos → core` | 5 | ✅ 已知 |
| `core → menus → scene/manager → scene/env → scene → motion-algos → core` | 6 | ✅ 已知 |
| `core → menus → scene/env → scene → scene/manager → scene/motion → motion-algos → core` | 7 | ✅ 已知 |
| `core → menus → scene/env → scene → scene/motion → motion-algos → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene → motion-algos → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/motion → motion-algos → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/motion → motion-algos → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/motion → motion-algos → core` | 5 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/motion → motion-algos → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → motion-algos → core` | 5 | ✅ 已知 |
| `core → menus → scene → core` | 3 | ✅ 已知 |
| `core → menus → scene/ar → core` | 3 | ✅ 已知 |
| `core → menus → scene/ar → scene/env → core` | 4 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene/env → core` | 5 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene/env → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene/env → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene/env → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene/env → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene/env → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene/env → scene/physics → core` | 5 | ✅ 已知 |
| `core → menus → scene/ar → scene/env → scene/render → core` | 5 | ✅ 已知 |
| `core → menus → scene/ar → scene/env → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene/env → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene/env → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene/env → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → core` | 4 | ✅ 已知 |
| `core → menus → scene/ar → scene/render → core` | 4 | ✅ 已知 |
| `core → menus → scene/ar → scene/render → scene/shared → core` | 5 | ✅ 已知 |
| `core → menus → scene/ar → scene/render → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene/camera → core` | 3 | ✅ 已知 |
| `core → menus → scene/camera → scene/env → core` | 4 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene/env → core` | 5 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene/env → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene/env → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene/env → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene/env → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene/env → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/camera → scene/env → scene/physics → core` | 5 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → core` | 5 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/camera → scene/env → scene/render → core` | 5 | ✅ 已知 |
| `core → menus → scene/camera → scene/env → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/camera → scene/env → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/camera → scene/env → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → core` | 4 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → core` | 4 | ✅ 已知 |
| `core → menus → scene/env → core` | 3 | ✅ 已知 |
| `core → menus → scene/manager → scene/env → core` | 4 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene/env → core` | 5 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene/env → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene/env → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene/env → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene/env → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene/env → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/env → scene/physics → core` | 5 | ✅ 已知 |
| `core → menus → scene/manager → scene/env → scene/render → core` | 5 | ✅ 已知 |
| `core → menus → scene/manager → scene/env → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/env → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/manager → scene/env → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/env → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene/motion → scene/env → core` | 4 | ✅ 已知 |
| `core → menus → scene/motion → scene/env → scene/physics → core` | 5 | ✅ 已知 |
| `core → menus → scene/motion → scene/env → scene/render → core` | 5 | ✅ 已知 |
| `core → menus → scene/motion → scene/env → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/motion → scene/env → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/motion → scene/env → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene/env → scene/physics → core` | 4 | ✅ 已知 |
| `core → menus → scene/env → scene/render → core` | 4 | ✅ 已知 |
| `core → menus → scene/env → scene/render → scene/shared → core` | 5 | ✅ 已知 |
| `core → menus → scene/env → scene/transform → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/env → scene/render → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene/env → scene/transform → core` | 4 | ✅ 已知 |
| `core → menus → scene/manager → core` | 3 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → core` | 4 | ✅ 已知 |
| `core → menus → scene/manager → scene/physics → core` | 4 | ✅ 已知 |
| `core → menus → scene/manager → scene/render → core` | 4 | ✅ 已知 |
| `core → menus → scene/manager → scene/render → scene/shared → core` | 5 | ✅ 已知 |
| `core → menus → scene/manager → scene/transform → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/render → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene/manager → scene/shared → core` | 4 | ✅ 已知 |
| `core → menus → scene/manager → scene/transform → core` | 4 | ✅ 已知 |
| `core → menus → scene/motion → core` | 3 | ✅ 已知 |
| `core → menus → scene/pose → core` | 3 | ✅ 已知 |
| `core → menus → scene/render → core` | 3 | ✅ 已知 |
| `core → menus → scene/render → scene/shared → core` | 4 | ✅ 已知 |
| `core → menus → scene/transform → scene/render → scene/shared → core` | 5 | ✅ 已知 |
| `core → menus → scene/render → scene/transform → core` | 4 | ✅ 已知 |
| `core → menus → scene/transform → core` | 3 | ✅ 已知 |
| `core → menus → scene/ar → scene → core` | 4 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/camera → core` | 5 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/camera → scene/env → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/camera → scene/env → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene/env → scene → scene/manager → scene/camera → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/camera → scene/env → scene/physics → core` | 9 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/camera → scene/env → scene/render → core` | 9 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/camera → scene/env → scene/render → scene/shared → core` | 10 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 11 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/camera → scene/env → scene/render → scene/transform → core` | 10 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/camera → scene/env → scene/transform → core` | 9 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/camera → scene/env → scene/physics → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/camera → scene/env → scene/render → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/camera → scene/env → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 10 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/camera → scene/env → scene/render → scene/transform → core` | 9 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/camera → scene/env → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene/env → scene → scene/camera → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/camera → scene/env → scene/physics → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/camera → scene/env → scene/render → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/camera → scene/env → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 10 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/camera → scene/env → scene/render → scene/transform → core` | 9 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/camera → scene/env → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/camera → scene/env → scene/physics → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/camera → scene/env → scene/render → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/camera → scene/env → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/camera → scene/env → scene/render → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/camera → scene/env → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/camera → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/camera → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/camera → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/env → core` | 5 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/env → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/motion → scene/env → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/motion → scene/env → scene/physics → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/motion → scene/env → scene/render → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/motion → scene/env → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 10 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/motion → scene/env → scene/render → scene/transform → core` | 9 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene/env → scene → scene/manager → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/motion → scene/env → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/env → scene/physics → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/env → scene/render → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/env → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/env → scene/transform → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/env → scene/render → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene/env → scene → scene/manager → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/env → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/motion → scene/env → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/motion → scene/env → scene/physics → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/motion → scene/env → scene/render → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/motion → scene/env → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/motion → scene/env → scene/render → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/motion → scene/env → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/env → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/env → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/env → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/env → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/env → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/env → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → core` | 5 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/motion → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/physics → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/render → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/transform → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/render → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/manager → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/manager → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/motion → core` | 5 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene/motion → scene → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/physics → core` | 5 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/render → core` | 5 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/ar → scene → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/camera → core` | 4 | ✅ 已知 |
| `core → menus → scene → scene/camera → scene/env → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/camera → scene/env → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene/env → scene → scene/camera → core` | 7 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene → scene/camera → scene/env → scene/physics → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/motion → scene/env → scene/physics → core` | 9 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/manager → scene/motion → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/motion → scene/env → scene/render → core` | 9 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/motion → scene/env → scene/render → scene/shared → core` | 10 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 11 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/motion → scene/env → scene/render → scene/transform → core` | 10 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/motion → scene/env → scene/transform → core` | 9 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene → scene/camera → scene/env → scene/render → core` | 8 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene → scene/camera → scene/env → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 10 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene → scene/camera → scene/env → scene/render → scene/transform → core` | 9 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene → scene/camera → scene/env → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/camera → scene/env → scene/physics → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/manager → scene/physics → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/manager → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/manager → scene/render → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/manager → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/manager → scene/transform → scene/render → scene/shared → core` | 10 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/manager → scene/render → scene/transform → core` | 9 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/manager → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/manager → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/camera → scene/env → scene/render → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/camera → scene/env → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/camera → scene/env → scene/render → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/camera → scene/env → scene → scene/manager → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/camera → scene/env → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/motion → scene/env → scene → scene/camera → core` | 6 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/camera → scene/env → scene/physics → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/motion → scene/env → scene/physics → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/motion → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/motion → scene/env → scene/render → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/motion → scene/env → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 10 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/motion → scene/env → scene/render → scene/transform → core` | 9 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/motion → scene/env → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/camera → scene/env → scene/render → core` | 7 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/camera → scene/env → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/camera → scene/env → scene/render → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/camera → scene/env → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/camera → scene/env → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/physics → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/render → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/transform → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/render → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene/env → scene → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/camera → scene/env → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/camera → scene/env → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene → scene/camera → scene/env → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/camera → scene/env → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/camera → core` | 5 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene → scene/camera → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/motion → core` | 7 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/physics → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/render → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/transform → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/render → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/manager → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/camera → scene → scene/manager → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/camera → scene → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/camera → core` | 5 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/motion → core` | 6 | ✅ 已知 |
| `core → menus → scene/camera → scene → scene/physics → core` | 5 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → core` | 5 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene/camera → scene → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/camera → scene → scene/render → core` | 5 | ✅ 已知 |
| `core → menus → scene/camera → scene → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/camera → scene → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/camera → scene → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/camera → scene → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/env → core` | 4 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/env → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/motion → scene/env → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/motion → scene/env → scene/physics → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/motion → scene/env → scene/physics → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/motion → scene/env → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/motion → scene/env → scene/render → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/motion → scene/env → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 10 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/motion → scene/env → scene/render → scene/transform → core` | 9 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/motion → scene/env → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/motion → scene/env → scene/render → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/motion → scene/env → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/motion → scene/env → scene/render → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/motion → scene/env → scene → scene/manager → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/motion → scene/env → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/env → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/env → scene/physics → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/env → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/env → scene/render → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/env → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/env → scene/transform → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/env → scene/render → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/env → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/env → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/env → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/env → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/env → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/env → scene → scene/manager → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/env → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/motion → scene/env → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/motion → scene/env → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/motion → scene/env → scene/physics → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/motion → scene/env → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/motion → scene/env → scene/render → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/motion → scene/env → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/motion → scene/env → scene/render → scene/transform → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/motion → scene/env → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/motion → scene/env → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/motion → scene/env → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene → scene/motion → scene/env → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/motion → scene/env → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/env → scene/physics → core` | 5 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/env → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/env → core` | 5 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/env → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/env → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/env → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/env → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/env → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/env → scene/render → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/env → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/env → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/env → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/env → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/manager → core` | 4 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/motion → core` | 5 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/motion → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/manager → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/manager → scene/motion → scene → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/physics → core` | 5 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/physics → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → core` | 5 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/render → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/manager → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/render → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/shared → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/manager → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/motion → core` | 4 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/physics → core` | 5 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/motion → core` | 5 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/render → core` | 5 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/motion → scene → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/physics → core` | 4 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/physics → core` | 5 | ✅ 已知 |
| `core → menus → scene/pose → scene → core` | 4 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/render → core` | 5 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → menus → scene/pose → scene → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/render → core` | 4 | ✅ 已知 |
| `core → menus → scene → scene/render → scene/shared → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/transform → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → menus → scene → scene/render → scene/transform → core` | 5 | ✅ 已知 |
| `core → menus → scene → scene/transform → core` | 4 | ✅ 已知 |
| `core → scene → motion-algos → core` | 3 | ✅ 已知 |
| `core → scene/manager → scene/motion → motion-algos → core` | 4 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene/env → scene → motion-algos → core` | 6 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene/env → scene → scene/motion → motion-algos → core` | 7 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene → motion-algos → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene → scene/motion → motion-algos → core` | 6 | ✅ 已知 |
| `core → scene/manager → scene/env → scene → motion-algos → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/env → scene → scene/motion → motion-algos → core` | 6 | ✅ 已知 |
| `core → scene/manager → scene → motion-algos → core` | 4 | ✅ 已知 |
| `core → scene → scene/manager → scene/motion → motion-algos → core` | 5 | ✅ 已知 |
| `core → scene → scene/motion → motion-algos → core` | 4 | ✅ 已知 |
| `core → scene → core` | 2 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene/env → core` | 4 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene/env → scene/physics → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene/env → scene/render → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene/env → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene/env → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene/env → scene/transform → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/camera → core` | 3 | ✅ 已知 |
| `core → scene/manager → scene/env → core` | 3 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene/env → core` | 4 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene/env → scene/physics → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene/env → scene/render → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene/env → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene/env → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene/env → scene/transform → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/env → scene/physics → core` | 4 | ✅ 已知 |
| `core → scene/manager → scene/env → scene/render → core` | 4 | ✅ 已知 |
| `core → scene/manager → scene/env → scene/render → scene/shared → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/env → scene/transform → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → scene/manager → scene/env → scene/render → scene/transform → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/env → scene/transform → core` | 4 | ✅ 已知 |
| `core → scene/manager → core` | 2 | ✅ 已知 |
| `core → scene/manager → scene/motion → core` | 3 | ✅ 已知 |
| `core → scene/manager → scene/physics → core` | 3 | ✅ 已知 |
| `core → scene/manager → scene/render → core` | 3 | ✅ 已知 |
| `core → scene/manager → scene/render → scene/shared → core` | 4 | ✅ 已知 |
| `core → scene/manager → scene/transform → scene/render → scene/shared → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/render → scene/transform → core` | 4 | ✅ 已知 |
| `core → scene/manager → scene/shared → core` | 3 | ✅ 已知 |
| `core → scene/manager → scene/transform → core` | 3 | ✅ 已知 |
| `core → scene/physics → core` | 2 | ✅ 已知 |
| `core → scene/render → core` | 2 | ✅ 已知 |
| `core → scene/render → scene/shared → core` | 3 | ✅ 已知 |
| `core → scene/render → scene/transform → core` | 3 | ✅ 已知 |
| `core → scene → scene/camera → core` | 3 | ✅ 已知 |
| `core → scene → scene/camera → scene/env → core` | 4 | ✅ 已知 |
| `core → scene → scene/manager → scene/camera → scene/env → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene/env → scene → scene/camera → core` | 6 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene → scene/camera → scene/env → scene/physics → core` | 7 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene → scene/camera → scene/env → scene/render → core` | 7 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene → scene/camera → scene/env → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 9 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene → scene/camera → scene/env → scene/render → scene/transform → core` | 8 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene → scene/camera → scene/env → scene/transform → core` | 7 | ✅ 已知 |
| `core → scene → scene/manager → scene/camera → scene/env → scene/physics → core` | 6 | ✅ 已知 |
| `core → scene → scene/manager → scene/camera → scene/env → scene/render → core` | 6 | ✅ 已知 |
| `core → scene → scene/manager → scene/camera → scene/env → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → scene → scene/manager → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → scene → scene/manager → scene/camera → scene/env → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → scene → scene/manager → scene/camera → scene/env → scene/transform → core` | 6 | ✅ 已知 |
| `core → scene → scene/camera → scene/env → scene/physics → core` | 5 | ✅ 已知 |
| `core → scene → scene/camera → scene/env → scene/render → core` | 5 | ✅ 已知 |
| `core → scene → scene/camera → scene/env → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → scene → scene/camera → scene/env → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → scene → scene/camera → scene/env → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → scene → scene/camera → scene/env → scene/transform → core` | 5 | ✅ 已知 |
| `core → scene → scene/manager → scene/camera → core` | 4 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene → scene/camera → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene → scene/physics → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene → scene/render → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → scene/manager → scene/camera → scene → scene/transform → core` | 5 | ✅ 已知 |
| `core → scene → scene/env → core` | 3 | ✅ 已知 |
| `core → scene → scene/manager → scene/env → core` | 4 | ✅ 已知 |
| `core → scene → scene/manager → scene/motion → scene/env → core` | 5 | ✅ 已知 |
| `core → scene → scene/manager → scene/motion → scene/env → scene/physics → core` | 6 | ✅ 已知 |
| `core → scene → scene/manager → scene/motion → scene/env → scene/render → core` | 6 | ✅ 已知 |
| `core → scene → scene/manager → scene/motion → scene/env → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → scene → scene/manager → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 8 | ✅ 已知 |
| `core → scene → scene/manager → scene/motion → scene/env → scene/render → scene/transform → core` | 7 | ✅ 已知 |
| `core → scene → scene/manager → scene/motion → scene/env → scene/transform → core` | 6 | ✅ 已知 |
| `core → scene → scene/manager → scene/env → scene/physics → core` | 5 | ✅ 已知 |
| `core → scene → scene/manager → scene/env → scene/render → core` | 5 | ✅ 已知 |
| `core → scene → scene/manager → scene/env → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → scene → scene/manager → scene/env → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → scene → scene/manager → scene/env → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → scene → scene/manager → scene/env → scene/transform → core` | 5 | ✅ 已知 |
| `core → scene → scene/motion → scene/env → core` | 4 | ✅ 已知 |
| `core → scene → scene/motion → scene/env → scene/physics → core` | 5 | ✅ 已知 |
| `core → scene → scene/motion → scene/env → scene/render → core` | 5 | ✅ 已知 |
| `core → scene → scene/motion → scene/env → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → scene → scene/motion → scene/env → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → scene → scene/motion → scene/env → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → scene → scene/motion → scene/env → scene/transform → core` | 5 | ✅ 已知 |
| `core → scene → scene/env → scene/physics → core` | 4 | ✅ 已知 |
| `core → scene → scene/env → scene/render → core` | 4 | ✅ 已知 |
| `core → scene → scene/env → scene/render → scene/shared → core` | 5 | ✅ 已知 |
| `core → scene → scene/env → scene/transform → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → scene → scene/env → scene/render → scene/transform → core` | 5 | ✅ 已知 |
| `core → scene → scene/env → scene/transform → core` | 4 | ✅ 已知 |
| `core → scene → scene/manager → core` | 3 | ✅ 已知 |
| `core → scene → scene/manager → scene/motion → core` | 4 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene → scene/physics → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene → scene/render → core` | 5 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene → scene/transform → scene/render → scene/shared → core` | 7 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene → scene/render → scene/transform → core` | 6 | ✅ 已知 |
| `core → scene/manager → scene/motion → scene → scene/transform → core` | 5 | ✅ 已知 |
| `core → scene → scene/manager → scene/physics → core` | 4 | ✅ 已知 |
| `core → scene → scene/manager → scene/render → core` | 4 | ✅ 已知 |
| `core → scene → scene/manager → scene/render → scene/shared → core` | 5 | ✅ 已知 |
| `core → scene → scene/manager → scene/transform → scene/render → scene/shared → core` | 6 | ✅ 已知 |
| `core → scene → scene/manager → scene/render → scene/transform → core` | 5 | ✅ 已知 |
| `core → scene → scene/manager → scene/shared → core` | 4 | ✅ 已知 |
| `core → scene → scene/manager → scene/transform → core` | 4 | ✅ 已知 |
| `core → scene → scene/motion → core` | 3 | ✅ 已知 |
| `core → scene → scene/physics → core` | 3 | ✅ 已知 |
| `core → scene → scene/render → core` | 3 | ✅ 已知 |
| `core → scene → scene/render → scene/shared → core` | 4 | ✅ 已知 |
| `core → scene → scene/transform → scene/render → scene/shared → core` | 5 | ✅ 已知 |
| `core → scene → scene/render → scene/transform → core` | 4 | ✅ 已知 |
| `core → scene → scene/transform → core` | 3 | ✅ 已知 |
| `scene/render → scene/transform → scene/render` | 2 | ✅ 已知 |
| `scene → scene/camera → scene` | 2 | ✅ 已知 |
| `scene → scene/camera → scene/env → scene` | 3 | ✅ 已知 |
| `scene → scene/manager → scene/camera → scene/env → scene` | 4 | ✅ 已知 |
| `scene → scene/manager → scene/camera → scene` | 3 | ✅ 已知 |
| `scene → scene/env → scene` | 2 | ✅ 已知 |
| `scene → scene/manager → scene/env → scene` | 3 | ✅ 已知 |
| `scene → scene/manager → scene/motion → scene/env → scene` | 4 | ✅ 已知 |
| `scene → scene/motion → scene/env → scene` | 3 | ✅ 已知 |
| `scene → scene/manager → scene` | 2 | ✅ 已知 |
| `scene → scene/manager → scene/motion → scene` | 3 | ✅ 已知 |
| `scene → scene/motion → scene` | 2 | ✅ 已知 |

---
*趋势对比：`node scripts/dep-metrics.mjs --json` 落盘快照文件随 git 提交，台账变化即 diff。*