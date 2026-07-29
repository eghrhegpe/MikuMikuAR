# ADR-204: 单测分层与治理规范（拆上帝文件 · 降 mock 密度 · fixtures 复用 · unit/integration 分层）

> **状态**: 🟡 规划
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
| **P1 试点拆分** | 选 `menu.test.ts`（1551 行）垂直拆为 3~4 个 `menu/*.test.ts`，抽 `fixtures/scene.ts` 做样板 | 用例数守恒、`npm run test` 全绿、单文件 ≤300 行 |
| **P2 fixtures 推广 + 脚本** | 建 `fixtures/backend.ts`；加 `test:unit`/`test:int` 脚本；下一个上帝文件（`env-bridge`/`perception`）迁移到共享桩 | 复用率上升、L1 可独立秒级跑 |
| **P3 触碰即改善** | 后续任何触碰超阈值测试文件的改动，顺带拆分 + 上抬 mock；不设独立回填任务 | 存量单调下降，无新增上帝文件 |

**用例数守恒是拆分的硬验收**：拆分前后 `npm run test` 报告的 pass 数必须一致，防止拆分中丢用例。

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
