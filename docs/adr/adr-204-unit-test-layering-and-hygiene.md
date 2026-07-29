# ADR-204: 单测分层与治理规范（拆上帝文件 · 降 mock 密度 · fixtures 复用 · unit/integration 分层）

> **状态**: 🟢 实施中
> **关联**: [ADR-060](adr-060-e2e-testing-strategy.md)（E2E 策略，本 ADR 补齐其下方的单元/集成层）、[AGENTS.md](../../AGENTS.md)（测试路由、代码审核七维、`npm run test` 入口）、[frontend/AGENTS.md](../../frontend/AGENTS.md)（前端子模块纪律）
> **背景**: 单测已达 **131 个文件 / ~2000 用例**（`frontend/src/**/*.test.ts`，grep 实测）。总量本身不致命，致命的是**结构未分层**：用例挤在少数「上帝测试文件」里，mock 密度畸高，且已有的共享 mock 基础设施几乎无人复用。本 ADR 锁定单测层的分层模型、拆分阈值、mock 治理与 fixtures 复用规范，供多 AI 协同渐进落地——**只治理结构，不推倒重来**。

---

## 一、问题边界

### 1.1 现状清点（2026-07-29 grep 实测）

| 项 | 事实 | 来源 |
|----|------|------|
| 测试文件 | **131 个** `*.test.ts` | `git ls-files 'src/**/*.test.ts'` |
| 用例总数 | **~2000** | `Select-String '\b(it|test)\s*\('` |
| 上帝文件（Top5 行数） | `menu.test.ts` 1551 / `env-bridge.test.ts` 1312 / `perception.test.ts` 1244 / `model-manager.test.ts` 1069 / `library-core.test.ts` 1057 | 逐文件行数统计 |
| 上帝文件（Top5 用例数） | `perception` 100 / `library-core` 99 / `menu` 95 / `model-manager` 88 / `env-bridge` 84 | 逐文件用例统计 |
| Mock 过载（Top） | `model-detail-ui.test.ts` 92 处 / `menu.test.ts` 89 / `model-manager.test.ts` 57 | `Select-String 'vi\.(mock|fn|spyOn)'` |
| 已有共享 mock | `src/__tests__/mocks/`：`babylon-classes.ts`、`babylon.ts`、`babylon-mmd-mocks.ts`、`binding-factories.ts`、`engine-mock.ts`、`factories.ts` | `git ls-files` |
| **共享 mock 复用率** | **仅 2/131 个测试文件从 `mocks/` 导入** | `Select-String "from '.*mocks/'"` |
| 分层脚本 | **无** unit/integration 拆分；`npm run test` = `vitest run` 全量 | `frontend/package.json` |
| fixtures 集中层 | **无** `src/__tests__/fixtures/` | `git ls-files` |

### 1.2 痛点（按杠杆率排序）

1. **上帝测试文件**：Top5 均破千行、80~100 用例。改一处模块逻辑要在 1500 行里翻找相关用例，违反 AGENTS.md「500 行文件先 grep 定位」的硬约束精神。
2. **Mock 过载**：单文件 92 处打桩 = 测试与实现过度耦合。行为不变的重构会红一大片——测试在测「怎么写」而非「做什么」。
3. **共享基础设施空转**：已有 6 个共享 mock + `factories.ts`，却只有 2 个文件在用。绝大多数测试在各自文件里重复造 mock，这正是 mock 过载的根因。
4. **分层缺失**：纯逻辑单测（毫秒级）与带 Babylon/DOM 桩的集成测试混跑，反馈慢，且加测试时无「该放哪一层」的指引。

### 1.3 非目标（防止滑向过度工程）

- **不砍用例数**：2000 用例是覆盖资产，本 ADR 只重排结构，不以「减少用例」为 KPI。
- **不引入新测试框架**：Vitest 已够用，只做分层脚本 + 目录约定。
- **不强制回填历史**：存量按「触碰即改善」渐进迁移，不做一次性大爆炸重写。

---

## 二、方案设计

### 2.1 三层单测模型

在现有 Vitest 之上以**目录 + 命名约定**分层，不改框架：

| 层 | 定义 | 判据 | 速度目标 | 允许的桩 |
|----|------|------|---------|---------|
| **L1 纯逻辑单测** | 无 DOM、无 Babylon、无 Wails 绑定的纯函数/算法 | 仅 import 叶子模块（`@/core/clamp` 等） | 毫秒级 | 几乎不需要 mock |
| **L2 集成单测** | 依赖 DOM（happy-dom）、Babylon 桩、绑定桩的模块 | 需要 `mocks/` 或 `setup-wails.ts` | 亚秒级 | 复用 `mocks/` 共享桩 |
| **L3 E2E** | 真实用户旅程 | Playwright | 秒级 | 见 ADR-060 |

L1/L2 均为 Vitest，通过**文件命名后缀**区分：L2 使用 `*.int.test.ts`，L1 使用 `*.test.ts`（默认）。这样可选择性单独运行 L1 拿到秒级反馈。

### 2.2 拆分阈值（新增/触碰文件强约束）

| 维度 | 软上限 | 硬上限 | 处置 |
|------|--------|--------|------|
| 单测试文件行数 | 300 | 500 | 超软线建议拆；触碰超硬线文件必须拆 |
| 单文件用例数 | 30 | 50 | 同上 |
| 单文件 `vi.mock/fn/spyOn` 计数 | 20 | 40 | 超线优先抽 `mocks/` 共享桩，而非就地打桩 |

拆分方向：**按被测模块的子功能垂直切**，参照 `motion-popup` 模块化拆分先例。例：
`menu.test.ts` → `menu/schema.test.ts` + `menu/keyboard-nav.test.ts` + `menu/state-binding.test.ts`。

### 2.3 Mock 治理

1. **共享优先**：任何 Babylon/绑定/场景桩，先查 `src/__tests__/mocks/` 是否已有；缺则**补进共享层**，禁止在测试文件里私造同类 mock。
2. **测行为不测实现**：mock 只桩「外部依赖的副作用与返回值」，不桩被测模块的内部方法。若必须 spy 内部方法才能测，说明该拆函数或提公共 API。
3. **UI builder 豁免延续**：纯布局 UI builder 允许无单测（AGENTS.md 审核标准已豁免），对应测试从「逐行打桩」降级为「少量集成冒烟」，不追求分支全覆盖。

### 2.4 fixtures 复用层

新建 `src/__tests__/fixtures/`，收敛跨文件重复的**场景级组装**（区别于 `mocks/` 的类级桩）：

- `fixtures/scene.ts`：`makeTestScene()` —— 基于 `mocks/babylon-classes` 组装含常用 mesh/material 的场景。
- `fixtures/backend.ts`：`makeMockBackend()` —— 统一 Wails 绑定桩，替代各文件重复的 `binding-factories` 拼装。
- 迁移策略：拆分上帝文件时顺手把就地 mock 上抬到 fixtures，**不做独立的大迁移任务**。

### 2.5 分层脚本（`frontend/package.json`）

```jsonc
"test": "vitest run",                         // 全量（CI 门禁不变）
"test:unit": "vitest run --exclude '**/*.int.test.ts'",   // L1 纯逻辑，秒级反馈
"test:int": "vitest run '**/*.int.test.ts'",  // L2 集成
```

`vitest.config.ts` 现有 `exclude`（`e2e/**`、`*.perf.test.ts`）保持不变；分层通过脚本层过滤，不改 config 主体。

---

## 三、落地路标（渐进，无大爆炸）

| Phase | 内容 | 验收 |
|-------|------|------|
| **P0 规范落地** | 本 ADR + 更新 `frontend/AGENTS.md` 测试小节（分层/阈值/mock 治理） | 文档就位，`npm run check:docs` 绿 |
| **P1 试点拆分** | ✅ 已完成（2026-07-29）：`menu.test.ts`（1551 行 / 95 用例）垂直拆为 8 个 `menu/*.test.ts`（均 ≤287 行），抽 `fixtures/menu.ts` 收敛 `makeLevel` + `new SlideMenu(...vi.fn())` 桩；旧 `menu.test.ts` 已删 | 用例数守恒（95→95）、`npm run test` 全绿（2437 passed / 0 failed）、单文件 ≤287 行 |
| **P2 fixtures 推广 + 脚本** | ✅ 已完成（2026-07-29）：建 `fixtures/backend.ts`（`makeMockBackend` + `makeMockCapabilities`）；`package.json` 加 `test:unit`/`test:int`；`env-bridge.test.ts`（1471 行 / 84 用例 / 54 处打桩）拆为 6 个 `env-bridge/*.int.test.ts`（≤286 行），581 行 mock 前导上抬为共享桩 `env-bridge/env-mocks.ts` | 用例数守恒（84→84，全量 2437 passed）、`test:int` 精确命中 84、`test:unit` 2353 例独立可跑 |
| **P3 触碰即改善** | ✅ 已完成（2026-07-29）：`perception.test.ts`（1431 行 / 100 用例 / 18 处 `vi.mock`）拆为 8 个 `perception/*.int.test.ts`（均 ≤300 行）；`mockState`/`mockPipeline` 以 `vi.hoisted` 内联留各测试文件（避免 `vi.resetModules()` 驱逐外置模块导致新旧实例脱节），`perception-mocks.ts` 收敛 18 个 `vi.mock` 工厂函数 + `setupPerceptionTest` + 共享 morph 助手。同轮 `model-manager.test.ts`（1270 行 / 88 用例 / 7 处 `vi.mock`）拆为 7 个 `model-manager.*.test.ts`（均 ≤205 行）+ `model-manager-mocks.ts` 共享桩（7 个 `vi.mock` 工厂 + 6 个 helper；mock 类自 `./mocks/babylon-classes` 静态引入以保证与 SUT 被 mock 的导入同一引用，且 `model-manager-mocks` 的 import 置于 SUT 之前以规避 `vi.mock` 工厂 hoist 后引用未初始化）。同轮 `library-core.test.ts`（1189 行 / 99 用例 / 10 处 `vi.mock`）拆为 6 个 `library-core.*.test.ts`（均 ≤326 行）+ `library-core-mocks.ts` 共享桩（9 个 `vi.mock` 工厂 + `makeModel`/`extractLevelRows` 助手；`mockState` 以 `vi.hoisted` 内联对象字面量而非导入函数以规避 hoist 后引用未初始化）。同轮 `material-editor.test.ts`（1048 行 / 50 用例 / 26 处 `vi.mock`）拆为 4 个 `material-editor.*.test.ts`（均 ≤259 行）+ `material-editor-mocks.ts` 共享桩（26 个 `vi.mock` 工厂 + `_mockMat` 纯数据 helper；`modelRegistry` 非 mock 导入，共享模块 import 置于 Babylon 导入之前以规避 `vi.mock` 工厂 hoist 后引用未初始化）| 用例数守恒（perception 100→100、model-manager 88→88、library-core 99→99、material-editor 50→50、全量 2429 passed / 0 failed）、单文件 ≤300 行、上帝文件数递减 |

**用例数守恒是拆分的硬验收**：拆分前后 `npm run test` 报告的 pass 数必须一致，防止拆分中丢用例。

> **P2 实施记录（2026-07-29）**：三点与 ADR 原文的实现差异——① `test:int` 脚本用 vitest 位置过滤子串 `.int.test`（而非 glob `'**/*.int.test.ts'`），因 Windows npm script 单引号不剥离且位置参数按子串匹配语义更可靠；`test:unit` 用 `--exclude`（追加语义，不覆盖 config 的 e2e/perf 排除）。② env-bridge 的模块桩集（config/env-impl/env-dispatcher/lighting/scene 等 10 模块）与 SUT 强绑定，故收敛为 `env-bridge/env-mocks.ts` 就近共享（拆分文件的 `vi.mock` 工厂经 `await import('./env-mocks')` 取桩，vitest 按测试文件隔离模块图、状态不串扰），而非塞进通用 `mocks/`；其中 backend 桩改用 `fixtures/backend.ts` 的 `makeMockBackend`（跨模块通用层）。③ 拆分文件首次落地 `*.int.test.ts` L2 命名约定；P1 的 `menu/*.test.ts`（依赖 happy-dom，属 L2）留待 P3 触碰时顺带改名。旧文件里 hoisted 的 `_defaults` 对象为死代码，未搬运。
>
> **P1 实施记录（2026-07-29）**：`menu.test.ts` 是纯 DOM 组件测试（SlideMenu / showPopupMenu / registerPopupMenu），不依赖 Babylon，故抽出的共享设施为 `src/__tests__/fixtures/menu.ts`（`makeTestLevel` + `makeTestMenu`，收敛 `makeLevel` 辅助函数与重复的 `new SlideMenu({...})` 桩），而非 ADR 示例中的 `fixtures/scene.ts`（`makeTestScene` 基于 `mocks/babylon-classes`，面向 Babylon 依赖测试，留待 P2 触碰 `env-bridge` / `perception` 等上帝文件时引入）。拆分比 ADR 示例的「3~4 个」更细（8 个文件），因为 ADR 自身的「单文件 ≤300 行」硬阈值优先于「3~4」的软建议——3~4 个文件会迫使部分文件超过 300 行。验收：95 用例守恒、全量 2437 passed / 0 failed、单文件最大 287 行。

---

## 四、风险与权衡

| 风险 | 缓解 |
|------|------|
| 拆分中误删/合并用例 | 用例数守恒验收；拆分用 `npm run codemod move-function` 类 AST 工具或手工逐块搬，禁止 `re.sub` |
| `*.int.test.ts` 重命名引发 CI/覆盖率遗漏 | `vitest.config.ts` 的 coverage `include: src/**/*.ts` 不受文件名影响；`test`（全量）仍是 CI 门禁，分层脚本仅为本地反馈 |
| 过度抽 fixtures 造成「测试的测试」耦合 | fixtures 只做无逻辑的组装工厂，不含断言、不含分支；一处 fixtures 只服务一类场景 |
| 规范沦为纸面 | 阈值仅对**新增/触碰**文件强约束，不搞存量一刀切，降低执行摩擦 |

---

## 五、决策

采用**三层单测模型 + 拆分阈值 + 共享 mock/fixtures 复用 + 分层脚本**的渐进治理方案。核心原则：**总量不砍、结构分层、共享优先、触碰即改善**。P0 规范先行，P1 以 `menu.test.ts` 试点验证方法论，其余存量随触碰渐进迁移。
