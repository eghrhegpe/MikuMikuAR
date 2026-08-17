# ADR-270: 结构耦合门禁 — 首次出现的跨模块通道与文件级 SCC 只许收紧

> **状态**: ✅ 已采纳（2026-10-24）
> **日期**: 2026-10-24

## 背景

ADR-268 把环门禁接进 pre-push 与 CI 后，`check:circular --strict` 一直是绿的。这个绿灯是真的，也是**没有意义的**：

- ADR-269 实测：模块图里真实跨模块 SCC = **0**（模块图是 DAG），551 个「代表环」中**有文件级支撑的 = 0**。它们全部由两个记账假象产生——`buildModuleGraph` 丢弃模块内边（738 条），以及 `core/main.ts` 这类入度为 0 的应用入口被折叠进 `core` 模块节点。
- 环门禁的判定是「白名单之外出现新环」。模块图既然已是 DAG，**任何正向新增的跨模块依赖都不会产生环**，于是不会触发门禁。换言之：`check:circular` 只能拦住「反向新增依赖」（原本 A→B，现在多出 B→A），而耦合恶化的主要形态恰恰是正向的新通道——`menus` 忽然开始依赖一个新模块、`scene/ar` 忽然依赖 `menus`，闸门全程绿灯。

这就是「仪表盘在报数，闸门没关」的第二形态：第一形态（ADR-268 修的）是检查根本没接线；第二形态是检查接好了，但它盯的指标对当前拓扑没有分辨力。

## 决策

新增 `scripts/check-coupling.mjs`（`npm run check:coupling`），盯两个只许收紧的结构指标，基线 `docs/.coupling-baseline.json`：

1. **有向模块对集合**。基线存的是「已批准存在的 A→B 通道」清单，而不是数量。首次出现的模块对即阻断；**同一对模块内新增边不阻断**（`menus→core` 已有 477 条，再加一条不改变架构形状，而 `scene/ar→menus` 是从无到有的新耦合）。新增模块对须**人工编辑基线并写明理由**，使这次放宽在 diff 里可见，而不是跑 `--update` 静默吸收。
2. **文件级 SCC**：`fileSccFiles`（非平凡 SCC 覆盖文件数，纠缠面）与 `fileSccMax`（最大分量成员数，纠缠块）。这两个数字变大意味着子系统内部缠得更紧——ADR-269 实施前后正是靠它们（25 → 12 → 9）确认改造有效的。

`--update` 带只减不增护栏：任一新模块对或任一 SCC 指标上升即拒绝写盘。

接线：`package.json` 的 `check:coupling` / `gen:coupling-baseline`、`.githooks/pre-push`（`TS_CHANGED` 触发）、`.github/workflows/ci.yml`（Circular gate 之后）、`check:all` 链。

## 备选方案

- **A. 用 `modulePairs` 计数而非集合**（否决）。计数分不清「已批准通道加粗」与「开辟新通道」：`menus→core` 再多一条边和 `scene/ar→menus` 首次出现，对计数的贡献都是 +1。前者是正常演进，后者是架构变化。实测两者在集合口径下可区分（`coupling.test.mjs` 有专门用例：同一对模块内增边 → exit 0）。
- **B. 直接用代表环数做棘轮**（否决）。ADR-269 已量化：551 个代表环中 0 个有结构支撑。用假象指标做门禁，只会逼人往白名单里加条目。
- **C. 只靠 `check:layering`**（否决）。分层门禁守的是「方向」（algo→menus 零容忍、core→menus/scene 防回退），它不看「有没有新通道」，也不看子系统内部纠缠。实测 `scene/env` 内部 9 文件互相可达，分层规则一句也管不到。
- **D. 让 `--update` 也能放宽**（否决）。放宽一旦自动化，「跑一次就吸收回归」会成为默认动作，基线失去意义。确需放宽时人工改 JSON，让评审看见。

## 影响

- 新增：`scripts/check-coupling.mjs`（`computeCoupling(srcDir)` 导出供测试）、`scripts/coupling.test.mjs`（12 用例，含正向/反向回归、同对增边不阻断、`--update` 护栏、基线缺失）、`docs/.coupling-baseline.json`（62 个模块对 / SCC 56 文件 / 最大 9）。
- 修改：`package.json`（3 处）、`.githooks/pre-push`（新增 check:coupling 块，头注释 9 项 → 10 项）、`.github/workflows/ci.yml`（新增 Coupling gate）。
- 与 ADR-268 的分工：`check:circular` 守「不新增环」（存量债棘轮），`check:coupling` 守「不新增耦合通道 / 不加深纠缠」（结构形状）。两者都不许放宽。
- 口径一致性：`computeCoupling` 用 `scanSourceGraph({ includeDynamic: false })`，模块归属与 `check-circular.mjs:65 getModule` 同实现（单段路径归 `core`、`scene` 二级目录成 `scene/x`），与 `dep-metrics` 台账同一把尺子。

## 相关文档

> ADR-268 / ADR-269 / ADR-238 / scripts/check-coupling.mjs / docs/.coupling-baseline.json
