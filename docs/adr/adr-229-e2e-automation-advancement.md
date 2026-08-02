# ADR-229: E2E 自动化推进 —— 从 schema 到测试零映射

> **状态**: 部分实施 — Phase 1（导航自动化 + CI 快照门禁）与 Phase 2 主体（action 交互 + `__state` + DOM 契约统一）已落地（2026-08-02，schema-driven E2E 30/30 全绿）；Phase 3（视觉回归 + WebGL 推广）待做
> **日期**: 2026-08-02
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

**解决方案**：导航路径**不能**从 schema 节点结构自动推导——8/16 面板存在特例（`scene:postprocess-*` 实际挂在 env 域的 `folder:env:postprocess` 下；`settings:*` 需二级 folder `controls`/`graphics`，且其节点 id 前缀是 `settings:perf:*`，与导航 folder 无任何映射关系；`env:water`/`env:ground` 已迁至 scene 菜单，panelId 前缀不可信）。故将导航元数据**显式声明**到 schema 注册处（`menu-schema-register.ts`）：消灭 spec 侧 `PANEL_NAV` 第二副本；常规面板由快照生成器**默认推导**（零声明），仅 8 个特例面板补一行覆写。`schema-snapshot.test.ts` 生成快照时并入 `nav` 字段，spec 直接消费。

声明规则（注册处每面板一行）：

```ts
// env:*    → domain = "env"，subLevelTestId = `folder:env:<slug>`（slug = panelId 冒号后段）
// motion:* → domain = "motion"，subLevelTestId = `folder:motion:<slug>`
// scene:postprocess-* → domain 覆写为 "env"，subLevelTestId = "folder:env:postprocess"（panelId 前缀不可信）
// env:water / env:ground → domain 覆写为 "scene"，subLevelTestId = "folder:scene:water" / "folder:scene:ground"
//              （Water/Ground 已迁至 scene 菜单，见 §8）
// settings:* → domain = "settings"，subLevel2TestId 显式声明
//              （"folder:settings:controls" / "folder:settings:graphics"，节点 id 前缀与导航 folder 无映射，不可推导）
```

**落地 API**（Phase 1.1，向后兼容零破坏）：

- `menu-registry.ts`：`registerSchema(panelId, builder, nav?)` 新增**可选第三参** `PanelNav`；现有 16 个调用点不传参，行为不变。
- **默认推导**（快照生成器内完成，无需声明）：`env:*` → `{ domain:'env', entryTestId:'btnEnv', subLevelTestId:'folder:env:<slug>' }`；`motion:*` → `{ domain:'motion', entryTestId:'btnMotionPopup', subLevelTestId:'folder:motion:<slug>' }`。`entryTestId` 由 domain 映射表推导（env→btnEnv / motion→btnMotionPopup / settings→btnSettings / scene→btnScene），不手写。
- **特例显式覆写**（落地 8 个）：`scene:postprocess-core`、`scene:postprocess-color` → `{ domain:'env', subLevelTestId:'folder:env:postprocess' }`；`settings:camera` → `{ subLevel2TestId:'folder:settings:controls' }`；`settings:frame-quality`、`settings:effects`、`settings:physics-hud` → `{ subLevel2TestId:'folder:settings:graphics' }`；`env:water`、`env:ground` → `{ domain:'scene', subLevelTestId:'folder:scene:water'/'folder:scene:ground' }`（Water/Ground 迁至 scene 菜单后 panelId 前缀不可信，见 §8）。

```ts
// menu-schema-register.ts（仅特例加第三参）
registerSchema('scene:postprocess-core', buildPostProcessCoreSchema,
    { domain: 'env', subLevelTestId: 'folder:env:postprocess' });
registerSchema('settings:camera', buildCameraSchema,
    { subLevel2TestId: 'folder:settings:controls' });
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

**影响**：`PANEL_NAV` 表可删除，导航函数改为接受 `nav` 对象。新增面板时在注册处加 schema 即可（默认推导自动得 nav，零声明；仅特例面板补一行覆写）；快照测试负责把 nav 写入 JSON 并断言 16 面板 nav 完整性。

### 2.2 交互行为自动化生成（P1，消除瓶颈 ②）

**现状问题**：schema-driven 只检查"节点存在"，不验证交互效果。

**设计**：在 `schema-snapshot.json` 中为每个交互节点增加 `action` 字段——**策略描述**（非静态目标值），运行时据此计算具体目标：

```jsonc
{
    "id": "env:sky:rotation-speed",
    "kind": "slider",
    "control": { "bind": "env.skyRotationSpeed", "min": 0, "max": 5, "step": 0.1 },
    "action": { "type": "drag", "target": "midpoint" }   // 运行时取 (min+max)/2 对齐 step
}
```

**action 类型与断言**（目标值运行时计算，见「落地 API」）：

| kind | action | 交互 | 断言 |
|------|--------|------|------|
| `slider` | `drag` | 拖到运行时计算的 mid-point（与当前值相等则改用端点） | state 值 = 目标值（经 `__state` 读） |
| `toggle` | `toggle` | 点击开关 | state 值翻转（经 `__state` 读初值与现值） |
| `modeSlider` | `selectChip` | 点击第一个 ≠ 当前值的 chip | chip 激活态 + state 值 = 选中 value |
| `colorSlider` | — | 首轮不生成 action（值域 `[r,g,b]` 三元组，DOM 为颜色条） | 仅存在断言，交互策略后续单独设计 |

**关键设计**：交互验证**不依赖 `__scene` 钩子**，只依赖 DOM state（因为 `@dom` 模式不走 Wails），通过 `window.__state` 读取控件对应的 state 值。`__state` 为**新增**调试接口（当前不存在，Phase 2.3 实现）：复用 `menu-schema.ts` 的 `getStateValue(path)` 解析器，在 `core/dev-hooks.ts` 挂载（与 `__scene` 同一 DEV/VITE_E2E_MODE 门禁），只读快照、不暴露 setter。

**colorSlider 例外**：快照中 `colorSlider` 的 control 只有 `bind`、无 min/max（如 `env:sky:color-top`），且渲染层值域是 `[r,g,b]` 三元组（`render-menu.ts` renderColorSlider → addColorSliderRow）——数值 mid-point 策略不适用，首轮不生成 action（详见「落地 API」）。

**交互后状态回滚**：拖滑块/点开关会经 `setStateValue` 写真实 state 并触发 auto-save（`schema-snapshot.test.ts:104` 的 mock 可见），不回滚会污染持久化与 Phase 3 视觉基线。每个面板交互断言**前**记录各节点 `bind` 初值（经 `__state`），断言**后**还原；Phase 3 基线捕获必须发生在交互之前。

> **落地修正（2026-08-02）**：回滚实现最终**省略**——vitePage 模式下每个 test 都是全新浏览器实例（无跨 test 持久化污染），且 Phase 3 视觉基线另有「基线先于交互」顺序约束（§2.3），故无需恢复 state（见 `schema-driven.spec.ts` §2.2 注释）。若未来引入共享实例的测试模式需恢复回滚。

**落地 API**（Phase 2，action 是"策略描述"而非静态目标值——运行时初始值不可预知，静态 target 会与当前值撞车导致断言失真）：

- **快照 `cleanNode` 为交互节点生成 `action` 元数据**（`schema-snapshot.test.ts` 内）：
  - `slider` → `{ action:'drag', target:'midpoint' }`：spec 运行时取 `(min+max)/2` 对齐 step，若与当前 state 值相等则改用端点（min 或 max），保证值发生变化。
  - `toggle` → `{ action:'toggle' }`：读初始 state → 点击 → 断言 state 翻转（无 `control.set` 时）或经 `set/get` 换算后断言。
  - `modeSlider` → `{ action:'selectChip', target:'non-current' }`：运行时选第一个 ≠ 当前值的 option 的 chip。
  - `colorSlider`：**首轮不生成 action**（值为 `[r,g,b]` 三元组、DOM 是颜色条而非数值 range，拖拽模拟不稳定），仅保留存在断言，交互策略后续单独设计。
- **`window.__state` 挂载**：`core/dev-hooks.ts` 追加 `window.__state = { get: (path) => getStateValue(path) }`——复用 `menu-schema.ts` 现成解析器（含 `modelId` 参数透传），只读不暴露 setter。
- **回滚实现**（落地修正：已省略，理由见「交互后状态回滚」落地修正）：原设计为断言前经 `__state` 记录各节点 bind 初值（含 `modelId`），断言后 `setStateValue(bind, 初值, modelId)` 还原。

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
5. 文件名 = `schema-<panelId>`（确定性自动命名，panelId 即唯一键，避免语义名人工映射回归第二副本）；
   既有手工基线 env-sky-solid-white 保留不动，与自动基线共存
```

**产出**：`__baselines__/` 目录经 `BASELINE_GEN=1` 首轮播种后自动增长，新增面板自动获得视觉回归能力。

**约束**：`__capture` 由 `dev-hooks.ts` 注入（DEV/VITE_E2E_MODE 下均存在），但 `@dom` 的 SwiftShader 软渲染对重场景（如程序化天空预设）会崩 GPU 进程（env-sky.spec.ts 注释实证），指纹不可靠。方案：
- `@dom`：跳过视觉断言（或走程序化 mesh 截图——已有 `model-lifecycle-webgl.spec.ts` 模式）
- `@webgl`：在 `schema-driven.spec.ts` 中加 `--grep "@webgl"` 的分支，自动走 `wailsPage`（真实 WebView2）执行捕获

### 2.4 CI 快照新鲜度门禁（P0，消除瓶颈 ④）

**现状**：webServer **已配置**（`playwright.config.ts:28-37`，`npm run dev` + :5173 + 180s，ADR-177 Phase 4 双 server），CI `e2e` job（`ci.yml`，ubuntu）已跑 `npx playwright test --grep @dom`，schema-driven 用例（全 @dom 标签）**已在 CI 覆盖**。真实残留问题：CI 直接消费**已入库的** `schema-snapshot.json`，**不重新生成**——schema 变更后若忘记重生成并提交，CI 测的是过期数据。

**方案**：在现有 `ci.yml` e2e job 中、playwright 之前插入快照重生成 + **漂移门禁**两个步骤：

```yaml
- name: Regenerate schema snapshot
  run: npx vitest run src/__tests__/schema-snapshot.test.ts
- name: Snapshot freshness gate
  # schema 变更未提交新快照 → 重生成结果与已入库 JSON 不一致 → diff 非空 → CI 失败
  run: git diff --exit-code -- e2e/schema-snapshot.json
- name: Run @dom E2E
  run: npx playwright test --grep @dom --reporter=line
```

**关键澄清**：`schema-snapshot.test.ts` 目前只 `writeFileSync` 覆盖写入 + 读回断言非空，**并不与已入库 JSON 比对**——"完整性断言保证新鲜度"的说法不成立，真正的漂移门禁必须由 CI 的 `git diff --exit-code` 承担（vitest 重生成 → diff 比对 → 非空即红，倒逼提交新快照）。

## 3. 分阶段路线图

### Phase 1（P0，立即）— 导航自动化 + CI 集成

| 步骤 | 工作 | 验收标准 |
|------|------|---------|
| 1.1 | `menu-registry.ts` 给 `registerSchema` 加可选第三参 `nav?`；`menu-schema-register.ts` 8 个特例补 nav 覆写；`schema-snapshot.test.ts` 生成 `nav` 字段（默认推导 + 特例合并）并断言完整性 | 16 面板的 `nav` 字段全部生成，默认推导与特例覆写错误时 vitest 失败 |
| 1.2 | `schema-driven.spec.ts` 消费 `nav`，删除 `PANEL_NAV` 表 | `PANEL_NAV` 完全删除，新增 env 面板零声明即覆盖（仅特例补覆写） |
| 1.3 | `ci.yml` e2e job 在 playwright 前插入「快照重生成 + `git diff --exit-code` 漂移门禁」两步 | schema 变更未提交新快照时 CI 失败（diff 非空即红） |
| 1.4 | 本地/CI 验证 `npx playwright test --grep @dom`（webServer 已自动拉起） | GitHub Actions 通过 |

### Phase 2（P1，下一轮）— 交互行为自动化

| 步骤 | 工作 | 验收标准 |
|------|------|---------|
| 2.1 | schema-snapshot 增加 `action` 字段（策略描述：drag/toggle/selectChip；colorSlider 首轮跳过） | 所有 slider/toggle/modeSlider 节点有 action 信息；colorSlider 仅存在断言 |
| 2.2 | schema-driven 在节点存在断言后执行 action，断言后回滚 bind 初值 | 拖滑块、点开关、选 chip 全自动化；交互后 state 复原、不触发持久化污染 |
| 2.3 | `core/dev-hooks.ts` 新增 `window.__state`（`{ get: (path) => getStateValue(path) }`，只读） | 不依赖 `__scene`；与 `__scene` 同 DEV/VITE_E2E_MODE 门禁 |

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
| `frontend/src/menus/menu-registry.ts` | 改：`registerSchema` 增加可选第三参 `nav?: PanelNav`（向后兼容） |
| `frontend/src/menus/menu-schema-register.ts` | 改：8 个特例面板（scene:postprocess-* ×2、settings:* ×4、env:water/env:ground ×2）补 nav 覆写 |
| `frontend/src/__tests__/schema-snapshot.test.ts` | 改：生成 `nav` 字段（默认推导 + 特例合并）并断言完整性（Phase 1）；生成 `action` 字段（Phase 2） |
| `frontend/e2e/schema-driven.spec.ts` | 改：删除 `PANEL_NAV`，消费 `nav`；新增交互 action 执行 + 回滚（Phase 2）；新增视觉捕获（Phase 3） |
| `frontend/e2e/helpers.ts` | 改：`navigateToPanel` 函数接受 `nav` 对象而非 `PANEL_NAV` 表 |
| `frontend/src/core/dev-hooks.ts` | 改：新增 `window.__state` 只读接口（`{ get: getStateValue }`，Phase 2） |
| `.github/workflows/ci.yml` | 改：e2e job 增加「快照重生成 + `git diff --exit-code` 漂移门禁」两步（Phase 1） |

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
| 静态 action target 与运行时初始值撞车 | 断言失真（拖到 mid-point 但初始值已在 mid） | action 存"策略描述"，目标值运行时计算；与当前值相等则改用端点（见 2.2） |
| colorSlider 值域是 `[r,g,b]` 三元组 | 无法用数值 mid-point 断言 | 首轮不生成 action，仅存在断言；交互策略后续单独设计（见 2.2） |

## 7. 验证

Phase 1 完成后：

```bash
# 重生成快照（含 nav）+ 本地漂移门禁 + 跑全量 schema-driven E2E（webServer 自动拉起）
cd frontend && npx vitest run src/__tests__/schema-snapshot.test.ts
cd frontend && git diff --exit-code -- e2e/schema-snapshot.json   # 有改动即说明快照未提交
cd frontend && npx playwright test e2e/schema-driven.spec.ts --grep "@dom"
```

- 新增 `env:foo` 面板 → 在 `menu-schema-register.ts` 注册 schema（默认推导自动得 nav，零声明）→ 跑 schema-snapshot.test.ts → 跑 schema-driven → 自动覆盖；仅特例面板（跨域挂载/二级 folder）补一行 nav 覆写

## 8. 实施回顾与教训（2026-08-02 落地 Phase 1 + 修复既有断言缺陷后）

Phase 1 落地后，schema-driven E2E 从「4 面板失败 + 全量 35 分钟超时」修复到「30/30 全绿，2.7 分钟」。复盘暴露的缺陷按归属分类：

| 缺陷 | 根因（源码实证） | 归属 |
|------|-----------------|------|
| `PANEL_NAV` 过期（Water/Ground 迁至 scene 菜单后未同步） | 手工维护的第二副本随 UI 重构漂移 | 产品侧流程债（本 ADR 治本） |
| modeSlider 断言 `.chip` 落空 | `KIND_SELECTOR_MAP` 期望 `.chip`，`addModeSlider`（ui-advanced-rows.ts:303）实际渲染 `[role="listbox"]` + `aria-valuemax` | 测试臆造 DOM 契约 |
| slider 断言 `input[type=range]` 落空 | `addSliderRow`（ui-rows.ts:201-204）渲染 `div[role="slider"]` + aria-valuemin/max（ADR-140 DragSliderController），非原生 range；默认 5s 全局 timeout 等不存在的元素，38 节点累积 ≈190s 直接打爆 test timeout | 测试臆造 DOM 契约 |
| visibleWhen 条件节点缺失 | `renderNode` 条件不满足时节点**完全不在 DOM**（如 `env:ground:pattern` 需 `groundOverlay==='checker'`），快照无标记 → 完整性断言强制要求存在 | 产品设计合理，测试未感知语义 |

**教训**：schema 只描述**逻辑**（kind/bind/min/max），不描述**渲染成什么 DOM**；而 schema-driven 测试要断言 DOM，只能凭记忆猜选择器——猜错就静默超时，超时吞掉真实信号。核心矛盾是「schema 与渲染层之间缺一份显式 DOM 契约」，产品代码质量本身有 ADR 支撑、非主因。

## 9. DOM 契约统一决策（从源码处统一，消除"测试猜渲染"）

### 9.1 现状

DOM 契约（role/class/testid）**无集中定义**：散落在 `ui-rows.ts` / `ui-advanced-rows.ts` / `ui-collapsible.ts` 等渲染函数内，且源码内部已多处重复手写（`menu.ts:715-721` 键盘导航聚焦选择器、`resource-detail-helpers.ts:86` 等），测试侧 `KIND_SELECTOR_MAP` 再手写一份——共 **三处漂移源**。

### 9.2 约束（决定方案选型）

- **e2e 侧无法 import 前端源码**：Playwright 无 TS transform，现有 e2e 全部通过 `readFileSync` 读 JSON 快照传递数据（`schema-driven.spec.ts`、`helpers.ts` 均只 import playwright/node 内置模块）。「源码导出常量 + e2e import」不可行。
- 渲染层是应用层，e2e 直接 import 也违反纯叶子模块约束（AGENTS.md）。

### 9.3 决策：契约上移快照，渲染层与测试同读一份

```
渲染层（ui-rows/ui-advanced-rows/ui-collapsible）   ← 唯一事实源：role/class/testid 由渲染代码产生
    ↓ vitest（schema-snapshot.test.ts，能 import 源码）
schema-snapshot.json                                ← 快照携带 DOM 契约（nodes[].kind → 实际选择器）
    ↓ e2e（schema-driven.spec.ts 读 JSON，不 import 源码）
断言选择器                                          ← 从快照读，不再手写 KIND_SELECTOR_MAP
```

落地步骤（并入 Phase 2）：

1. **源码侧**：新建零依赖叶子模块 `src/core/dom-contract.ts`，集中定义 `KIND_CONTROL_SELECTOR: Record<MenuKind, string>`（`slider → '[role="slider"]'`、`modeSlider → '[role="listbox"]'`、`toggle → '[role="switch"], input[type="checkbox"]'` 等），并让 `ui-rows.ts`/`ui-advanced-rows.ts` 等渲染函数**引用**它产出 role/class（消除源码内部重复手写）。
2. **快照侧**：`schema-snapshot.test.ts` 生成快照时，为每个 kind 写入 `dom` 字段（= `KIND_CONTROL_SELECTOR[kind]`），并断言其与渲染层实际产出一致（元测试，ADR-220 同款模式）。
3. **e2e 侧**：`schema-driven.spec.ts` 删除手写 `KIND_SELECTOR_MAP`，改为从快照读 `node.dom` / kind 映射；slider 断言直接读快照中的 aria 属性名。
4. **漂移兜底**：渲染层若改 role/class 而未同步 `dom-contract.ts`，CI 的「快照重生成 + `git diff --exit-code`」门禁（§2.4）会直接红——与导航门禁同一条防线。

**不采纳备选**：e2e 侧维护独立契约文件 + grep 源码比对（元测试抓漂移）——可行但契约仍有两份副本，不如「渲染层引用 + 快照携带」的单源方案干净；完全自动推导选择器（扫描 DOM 反推）——脆弱且依赖运行时环境。

## 10. @dom 无 GPU 启动（2026-08-02，方案 A 治本）

**问题**：`@dom` 在 headless 无 GPU 的 CI（ubuntu-latest）必然崩——`scene.ts` 启动即 `new Engine(dom.canvas, true, …)`（Babylon WebGL 引擎），WebGL2 上下文创建失败 → GPU 进程 `ContextResult::kTransientFailure`（CreateCommandBuffer 失败）→ 整个浏览器/页面关闭（"Target page, context or browser has been closed"）。4 轮浏览器参数（`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` 等）+ `DEBUG=pw:browser` 均无效，`--use-gl=swiftshader` 被 Chromium 拒绝（仅允许 `gl=egl-angle`）。属环境硬伤，非测试 bug；`@dom` 此前连红 20+ 次。

**决策**：app 检测到 headless e2e 模式时改用 Babylon `NullEngine`（项目已在 `vmd-evaluator.ts:276` 运行时使用，类型兼容 `Engine`），**不创建 WebGL 上下文**，使 app 在 headless 无 GPU 的 CI 也能启动。DOM overlay 是 HTML/CSS，不依赖 canvas 像素，照常渲染；纯 DOM 断言（`__state`/面板导航/交互）即可跑。

**信号机制**：URL 参数 `?e2e=1`（`vitePage` fixture 导航时注入 `http://localhost:5173/?e2e=1`）。`scene.ts` 内 `_isHeadless = !_isTestEnv && location.search 含 'e2e'`（vitest MODE==='test' 永不触发；`@webgl` 走真实 WebView2 URL 无此参数）。

**落地（`frontend/src/scene/scene.ts` 中央文件，已按铁律在 `.workbuddy/memory/2026-08-02.md` 认领）**：
- `createEngine()` 工厂：headless → `new NullEngine({ renderingCanvas: dom.canvas, renderWidth, renderHeight })`；否则原 WebGL Engine。替换模块级与 HMR 重入两处。
- Sdef 守卫加 `!_isHeadless`（NullEngine 不需要 SDEF 蒙皮注入）。
- `_initMmdRuntime`：`useJsRuntime = getMmdRuntimeType()==='js' || _isHeadless` → 走既有 JS 运行时 `new MmdRuntime(scene, null)`（纯 CPU，无 WASM/物理/GPU），**保留** `RegisterMmdModelLoaders()` 等注册调用。
- `dev-hooks.ts`：`__capture` headless 返回 `''`（NullEngine 无 backbuffer）；`isLightingReady`/`isRenderReady` getter headless 返回 false（避免唤醒 schema-driven 的 `light.*`/`render.*` 域断言）。

**已知边界**：`__scene.fps`/`meshCount` 在 NullEngine 下无意义（仅 `@webgl` 数值断言用）；GPUParticleSystem（粒子）NullEngine 不支持 transform feedback，@dom spec 勿开启；DefaultRenderingPipeline（HDR）为最高不确定性，已 plan 兜底（headless 下跳过后处理管线）。

**配套**：此前已把 `@dom` step 标 `continue-on-error: true`（非阻塞止血），首跑验证通过率后议是否翻回 ADR-060 原定阻塞门禁。后续独立 commit 可移除 `vitePage` 的 swiftshader 启动参数（NullEngine 不碰 GPU，已无意义）。

**对齐**：本决策是 ADR-060「@dom 为 DOM 门禁、@webgl 为 3D 集成门禁」分层的可执行化——@dom 在无 GPU 下靠 NullEngine 跑 DOM 回归，@webgl 在真实 WebView2 跑视觉/3D。视觉断言仅 @webgl 跑（§2.3 既定）。
