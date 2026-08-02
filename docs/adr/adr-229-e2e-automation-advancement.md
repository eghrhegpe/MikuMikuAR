# ADR-229: E2E 自动化推进 —— 从 schema 到测试零映射

> **状态**: 📝 规划
>
> **编号**: 229
>
> **关联**: [ADR-060](adr-060-e2e-testing-strategy.md)（E2E 总策略）、[ADR-220](adr-220-schema-integrity-metatest.md)（Schema 完整性元测试 + P1 schema-driven 原型）、[ADR-093](adr-093-menu-declarative-schema.md)（声明式菜单 Schema）、[ADR-177](adr-177-web-loader-main-app-unification.md)（Phase 4 双 webServer：5173 桌面 dev 已配置）

## 1. 背景

### 1.1 当前自动化成果

ADR-220 P1 已建成 schema-driven E2E 流水线：

```
menu-schema-register.ts（声明式 schema）
    → vitest: schema-snapshot.test.ts
    → e2e/schema-snapshot.json（纯数据快照）
    → playwright: schema-driven.spec.ts
    → 16 面板 / 158 用例 / 零手写断言
```

### 1.2 自动化瓶颈

当前 schema-driven E2E 仍存在 **4 处需人工介入的环节**，限制了"新面板零成本覆盖"的目标：

| 瓶颈 | 文件位置 | 问题 | 每次新增面板的成本 |
|------|---------|------|------------------|
| **① 导航路径手动映射** | `schema-driven.spec.ts:61-84` | `PANEL_NAV` 表硬编码每个面板的 domain/subLevel/subLevel2 | 必须手动加一行，否则被 `console.warn` 跳过 |
| **② 仅断言"存在"，不断言"行为"** | `schema-driven.spec.ts:169-213` | 只检查节点可见 + 控件类型，不拖拽滑块、不切换 toggle、不验证值生效 | 功能交互需手写，与 schema-driven 无关 |
| **③ 视觉回归零自动化** | — | 仅 `env-sky.spec.ts` 有 16×16 指纹，其他面板无视觉快照 | 需手动为新面板编写 `captureScreenshot` + 基线 JSON |
| **④ CI 快照新鲜度无门禁** | `ci.yml` e2e job | CI 只消费已入库的 `schema-snapshot.json`，不重新生成 → schema 变更后 CI 测的是过期数据 | 需手动重生成快照并提交，忘记即 CI 失真 |

**核心判断**：瓶颈 ① 是最大痛点——导航路径本质是面板的结构属性，**应由 schema 声明携带**（注册处一行显式声明 + 快照传递），而非由 spec 侧第二副本人工同步。

## 2. 决策

### 2.1 导航元数据上移注册器（P0，消除瓶颈 ①）

**现状问题**：`PANEL_NAV` 是 schema 数据的"第二副本"，schema 注册后还需人工同步此表。

**解决方案**：导航路径**不能**从 schema 节点结构自动推导——6/16 面板存在特例（`scene:postprocess-*` 实际挂在 env 域的 `folder:env:postprocess` 下；`settings:*` 需二级 folder `controls`/`graphics`，且其节点 id 前缀是 `settings:perf:*`，与导航 folder 无任何映射关系）。故将导航元数据**显式声明**到 schema 注册处（`menu-schema-register.ts`）：消灭 spec 侧 `PANEL_NAV` 第二副本，保留每面板一行声明（**非全自动推导**）。`schema-snapshot.test.ts` 生成快照时并入 `nav` 字段，spec 直接消费。

声明规则（注册处每面板一行）：

```ts
// env:*    → domain = "env"，subLevelTestId = `folder:env:<slug>`（slug = panelId 冒号后段）
// motion:* → domain = "motion"，subLevelTestId = `folder:motion:<slug>`
// scene:postprocess-* → domain 覆写为 "env"，subLevelTestId = "folder:env:postprocess"（panelId 前缀不可信）
// settings:* → domain = "settings"，subLevel2TestId 显式声明
//              （"folder:settings:controls" / "folder:settings:graphics"，节点 id 前缀与导航 folder 无映射，不可推导）
```

**产出**：

```jsonc
// schema-snapshot.json（扩展结构）
{
    "panelId": "env:sky",
    "nodes": [...],
    "nav": {                    // ← 新增：注册处显式声明 → 快照携带
        "domain": "env",
        "entryTestId": "btnEnv",
        "subLevelTestId": "folder:env:sky",
        "subLevelLabel": "天空"
    }
}
```

**影响**：`PANEL_NAV` 表可删除，导航函数改为接受 `nav` 对象。新增面板时在注册处加 schema + 一行 nav 声明（特例面板需 domain 覆写）；快照测试负责把 nav 写入 JSON 并断言 16 面板 nav 完整性。

### 2.2 交互行为自动化生成（P1，消除瓶颈 ②）

**现状问题**：schema-driven 只检查"节点存在"，不验证交互效果。

**设计**：在 `schema-snapshot.json` 中为每个交互节点增加 `action` 字段，描述可自动化执行的交互类型：

```jsonc
{
    "id": "env:sky:exposure",
    "kind": "slider",
    "control": { "min": 0, "max": 4, "step": 0.05 },
    "action": "setValue",           // 自动交互类型
    "actionTargetValue": 2.0        // 期望值（从 control 默认值或 mid-point 推导）
}
```

**action 类型与断言**：

| kind | action | 交互 | 断言 |
|------|--------|------|------|
| `slider` | `setValue` | 拖到 mid-point | slider value = target |
| `toggle` | `toggle` | 点击开关 | DOM 类名变化 + state 值变化 |
| `modeSlider` | `selectChip` | 点击指定 chip | chip 激活态 + state 值变化 |
| `colorSlider` | `setValue` | 拖到 mid-point | slider value = target |

**关键设计**：交互验证**不依赖 `__scene` 钩子**，只依赖 DOM state（因为 `@dom` 模式不走 Wails），通过 `window.__state` 读取控件对应的 state 值。`__state` 为**新增**调试接口（当前不存在，Phase 2.3 实现）：复用 `menu-schema.ts` 的 `getStateValue(path)` 解析器，在 `core/dev-hooks.ts` 挂载（与 `__scene` 同一 DEV/VITE_E2E_MODE 门禁），只读快照、不暴露 setter。

**colorSlider 兜底**：快照中 `colorSlider` 的 control 只有 `bind`、无 min/max（如 `env:sky:color-top`），mid-point 推导落空——action 生成时若 control 缺 min/max，取默认 0.5 作为目标值。

**交互后状态回滚**：拖滑块/点开关会经 `setStateValue` 写真实 state 并触发 auto-save（`schema-snapshot.test.ts:104` 的 mock 可见），不回滚会污染持久化与 Phase 3 视觉基线。每个面板交互断言**前**记录各节点 `bind` 初值（经 `__state`），断言**后**还原；Phase 3 基线捕获必须发生在交互之前。

### 2.3 视觉回归自动发现（P1，消除瓶颈 ③）

**现状**：仅 `env-sky` 有 16×16 指纹，基线手动创建。

**方案**：扩展 `schema-driven.spec.ts`，在每个面板导航完成后，自动执行 `window.__capture()`，生成指纹基线。

**流程**：

```
1. 导航到面板（同 2.1）→ 先捕获基线，再做交互断言（顺序约束见 2.2）
2. 执行 window.__capture() → dataURL
3. 计算 16×16 亮度指纹（复用 helpers.ts 的 captureFingerprint）
4. 与 __baselines__/ 目录基线比对；基线缺失时按既有 BASELINE_GEN=1 门禁创建
   （helpers.ts:compareToBaseline 强制要求显式播种，防 ubuntu SwiftShader 渲染 ≠ Windows WebView2 漂移）
5. 文件名 = 场景语义名（如 env-sky-solid-white），非裸 panelId
```

**产出**：`__baselines__/` 目录经 `BASELINE_GEN=1` 首轮播种后自动增长，新增面板自动获得视觉回归能力。

**约束**：`__capture` 由 `dev-hooks.ts` 注入（DEV/VITE_E2E_MODE 下均存在），但 `@dom` 的 SwiftShader 软渲染对重场景（如程序化天空预设）会崩 GPU 进程（env-sky.spec.ts 注释实证），指纹不可靠。方案：
- `@dom`：跳过视觉断言（或走程序化 mesh 截图——已有 `model-lifecycle-webgl.spec.ts` 模式）
- `@webgl`：在 `schema-driven.spec.ts` 中加 `--grep "@webgl"` 的分支，自动走 `wailsPage`（真实 WebView2）执行捕获

### 2.4 CI 快照新鲜度门禁（P0，消除瓶颈 ④）

**现状**：webServer **已配置**（`playwright.config.ts:28-37`，`npm run dev` + :5173 + 180s，ADR-177 Phase 4 双 server），CI `e2e` job（`ci.yml`，ubuntu）已跑 `npx playwright test --grep @dom`，schema-driven 用例（全 @dom 标签）**已在 CI 覆盖**。真实残留问题：CI 直接消费**已入库的** `schema-snapshot.json`，**不重新生成**——schema 变更后若忘记重生成并提交，CI 测的是过期数据。

**方案**：在现有 `ci.yml` e2e job 中、playwright 之前插入快照重生成步骤（vitest 秒级，无需浏览器），同时充当 schema 漂移门禁：

```yaml
- name: Regenerate schema snapshot
  run: npx vitest run src/__tests__/schema-snapshot.test.ts
- name: Run @dom E2E
  run: npx playwright test --grep @dom --reporter=line
```

快照新鲜度由 `schema-snapshot.test.ts` 的完整性断言保证：schema 与已入库 JSON 不一致即失败 → CI 红，倒逼提交新快照。

## 3. 分阶段路线图

### Phase 1（P0，立即）— 导航自动化 + CI 集成

| 步骤 | 工作 | 验收标准 |
|------|------|---------|
| 1.1 | `menu-schema-register.ts` 注册处增加 nav 声明（每面板一行）；`schema-snapshot.test.ts` 生成 `nav` 字段并断言完整性 | 16 面板的 `nav` 字段全部生成，缺失/特例覆写错误时 vitest 失败 |
| 1.2 | `schema-driven.spec.ts` 消费 `nav`，删除 `PANEL_NAV` 表 | `PANEL_NAV` 完全删除，新增 env 面板一行声明即覆盖 |
| 1.3 | `ci.yml` e2e job 在 playwright 前插入快照重生成步骤 | schema 变更未提交新快照时 CI 失败（漂移门禁生效） |
| 1.4 | 本地/CI 验证 `npx playwright test --grep @dom`（webServer 已自动拉起） | GitHub Actions 通过 |

### Phase 2（P1，下一轮）— 交互行为自动化

| 步骤 | 工作 | 验收标准 |
|------|------|---------|
| 2.1 | schema-snapshot 增加 `action` 字段 | 所有 slider/toggle/modeSlider 节点有 action 信息（colorSlider 无 min/max 时兜底 0.5） |
| 2.2 | schema-driven 在节点存在断言后执行 action，断言后回滚 bind 初值 | 拖滑块、点开关、选 chip 全自动化；交互后 state 复原、不触发持久化污染 |
| 2.3 | `core/dev-hooks.ts` 新增 `window.__state`（复用 `getStateValue`，只读） | 不依赖 `__scene`；与 `__scene` 同 DEV/VITE_E2E_MODE 门禁 |

### Phase 3（P1/P2，后轮）— 视觉回归 + WebGL 推广

| 步骤 | 工作 | 验收标准 |
|------|------|---------|
| 3.1 | schema-driven 在 `@webgl` 分支自动执行 `__capture()` + 指纹，先基线后交互 | 16 面板全量视觉基线生成（`BASELINE_GEN=1` 在 Windows WebView2 播种） |
| 3.2 | `@webgl` 分支自动走 wailsPage | 新增 3D 面板自动获得截图回归 |
| 3.3 | 视觉基线 diff 报告 | CI 中截图 diff 展示 |

## 4. 备选方案

### A. 完全自动生成 spec 文件（Codegen）

从 schema 输出 Playwright `.spec.ts` 源码文件。

**未采纳理由**：schema-driven 模式已足够——一个 spec 文件 + 数据驱动，比 16 个 `.spec.ts` 更易维护。Codegen 增加构建步骤，且 Playwright 的 TDD 调试体验下降。

### B. 基于 AI 自动生成 E2E 测试

用 LLM 从 schema 描述生成完整测试代码。

**未采纳理由**：不稳定，维护成本不可预测。Schema-driven 是确定性方案，每次运行结果一致。

### C. 不做交互行为自动化

只保留 DOM 存在性断言，交互测试全部手写。

**不采纳理由**：`toggle` 和 `modeSlider` 的值变更是常见的破坏点（如 bind 路径错误导致值写入错误字段），纯 DOM 存在性无法捕获。交互自动化的 ROI 明确。

## 5. 影响

### 5.1 文件变更

| 文件 | 变更 |
|------|------|
| `frontend/src/menus/menu-schema-register.ts` | 改：注册处每面板增加 nav 声明（含 scene/settings 特例覆写） |
| `frontend/src/__tests__/schema-snapshot.test.ts` | 改：生成 `nav` 字段并断言完整性（Phase 1）；增加 `action` 字段（Phase 2） |
| `frontend/e2e/schema-driven.spec.ts` | 改：删除 `PANEL_NAV`，消费 `nav`；新增交互 action 执行 + 回滚（Phase 2）；新增视觉捕获（Phase 3） |
| `frontend/e2e/helpers.ts` | 改：`navigateToPanel` 函数接受 `nav` 对象而非 `PANEL_NAV` 表 |
| `frontend/src/core/dev-hooks.ts` | 改：新增 `window.__state` 只读接口（复用 `getStateValue`，Phase 2） |
| `.github/workflows/ci.yml` | 改：e2e job 增加快照重生成步骤（Phase 1） |

### 5.2 不涉及的模块

- `*-levels.ts`（不改动，schema 数据源稳定）
- `frontend/playwright.config.ts`（不改动，webServer 已配置，ADR-177 Phase 4）
- `core/main.ts`（不改动；调试钩子统一在 `core/dev-hooks.ts` 挂载）

## 6. 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 导航非全自动（scene/settings 特例需覆写） | 新面板注册时忘声明特例 → 导航错位 | nav 完整性断言（16 面板全量）；特例规则写入 2.1 声明规则注释 |
| `subLevelLabel` 与 i18n 中文标签耦合 | 切换语言后标签不匹配 | 导航以 testid（`folder:*`）为唯一依据，label 仅作可读元数据，不参与定位 |
| `__capture()` 在 `@dom`（SwiftShader）不可靠 | 视觉回归只能在 `@webgl` 跑 | Phase 3 拆分 `@dom`（无视觉）和 `@webgl`（有视觉）两条分支 |
| 交互后 state 未回滚 | 污染持久化（auto-save）与 Phase 3 基线 | 断言前记录 bind 初值、断言后还原；基线捕获先于交互（见 2.2/2.3） |
| `window.__state` 暴露扩大调试接口 | 安全风险（理论上） | `__state` 只读快照（复用 `getStateValue`），不暴露 setter；与 `__scene` 同 DEV/VITE_E2E_MODE 门禁 |

## 7. 验证

Phase 1 完成后：

```bash
# 重生成快照（含 nav）+ 跑全量 schema-driven E2E（webServer 自动拉起）
cd frontend && npx vitest run src/__tests__/schema-snapshot.test.ts
cd frontend && npx playwright test e2e/schema-driven.spec.ts --grep "@dom"
```

- 新增 `env:foo` 面板 → 在 `menu-schema-register.ts` 注册 schema + 一行 nav 声明 → 跑 schema-snapshot.test.ts → 跑 schema-driven → 自动覆盖，**仅一行声明**（特例面板补 domain 覆写）
