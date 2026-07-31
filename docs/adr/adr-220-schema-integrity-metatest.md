# ADR-220: Schema 完整性元测试 —— 不开浏览器，秒级捕获 schema 漂移

> **状态**: 实施中（P0 精化完成：16 面板 1427 断言全绿 + 多语言包校验 + motionModule 动态校验 + folder 真空节点修复；P1 原型建成：16 面板 158 用例自动生成，分域导航已实现）
>
> **编号说明**: 本 ADR 原误编为 200，与 `adr-200-wind-physics-empty-bundle-map`（被 wind-physics.ts / mmd-adapter.ts 等 16 处代码 `[doc:adr-200]` 引用，为原生 200）撞车。因本 ADR 无任何代码 `[doc:adr-200]` 引用（测试文件挂接的是 ADR-093），故本 ADR 顺延改号为 220，wind-physics 保留 200，零破坏现有引用。

## 1. 背景

### 1.1 问题：DOM 扫描器看影子不看物体

项目已有 57 个面板迁移为声明式 schema（ADR-093），`MenuNode[]` 是单一数据源。但隔壁团队的 `menu-declaration.spec.ts` 走 DOM 扫描路线——打开浏览器、扫描渲染后的 `data-testid` 节点、断言结构属性。

**根因诊断**：DOM 是 schema 的渲染结果，扫描 DOM 等于看「影子」。真正该扫描的是 schema 树本身。

| 扫描器能发现 | 扫描器发现不了 |
|-------------|---------------|
| 菜单没渲染 | slider 绑错了 state 字段 |
| testid 重复 | `visibleWhen` 条件矛盾 |
| 嵌套太深 | `control.bind` 指向已删除的 EnvState 字段 |
| 分类错误 | i18n key 在语言包缺失 |

### 1.2 已有基础设施

ADR-093 迁移完成后，项目已有：
- `MenuNode[]` 声明式 schema（57 面板）
- `StatePath` 类型化字符串（`'env.xxx'` / `'render.xxx'` / `'ui.xxx'` / `'perception.xxx'`）
- `ENV_STATE_SCHEMA` 常量（113 个字段，运行时可遍历）
- `defaultRenderState()` / `DEFAULT_PERCEPTION_STATE` / `uiState` 默认值对象
- `zhCN` 语言包（可直接 import 做 key 存在性检查）

**关键洞察**：这些运行时对象就是 state 字段的「真相源」，可以在 vitest 层直接做静态分析，不需要浏览器。

## 2. 决策

### 2.1 Schema 收集器（menu-registry.ts）

新建轻量注册表，各 `*-levels.ts` 导出 `getXxxSchema()` 函数后在此注册：

```ts
registerSchema('env:sky', getSkySchema);
registerSchema('env:water', getWaterSchema);
// ...
```

`collectAllSchemas()` 返回所有已注册 schema 的快照，`flattenNodes()` 递归展开子节点。

**设计选择**：注册集中在 `menu-schema-register.ts`（单一文件），`*-levels.ts` 只需导出 schema 构建函数，不依赖 registry——保持 levels 文件零侵入。

### 2.2 五维度完整性校验（menu-schema.integrity.test.ts）

| 维度 | 检查方法 | 能捕获的缺陷 |
|------|---------|-------------|
| **control.bind 路径有效性** | 解析 `StatePath` 前缀 → 查对应 state 对象的 `Object.keys()` | 字段重命名后 schema 没跟 |
| **id 全局唯一** | 收集所有节点 id，`Set` 去重 | 两个控件用了相同 testid |
| **i18n key 存在性** | `label` + `modeSlider.options[].label` → 查 `zh-CN/en/ja/ko/zh-TW` 五语言包 keys | 语言包缺失 key |
| **folder children 非空** | 有 `children` 的 folder 检查长度 >0；`renderCustom` folder 跳过 | 空文件夹节点 |
| **modeSlider options 非空** | `control.options` 长度 >0 | 下拉选择器没有选项 |

### 2.3 StatePath 前缀映射

```ts
const STATE_PREFIX_MAP: Record<string, Set<string>> = {
    env: new Set(Object.keys(ENV_STATE_SCHEMA)),
    render: new Set(Object.keys(defaultRenderState())),
    light: LIGHT_KEYS,  // 硬编码（LightState 无运行时 schema）
    perception: new Set(Object.keys(DEFAULT_PERCEPTION_STATE)),
    ui: new Set(Object.keys(uiState)),
};
```

**注意**：`EnvState` 的字段真相源是 `ENV_STATE_SCHEMA`（ADR-137），不是 `EnvState` 类型本身（TS 类型运行时已擦除）。

### 2.4 动态路径动态校验（motion 域推广 + P0 精化）

motion 域的骨骼模块参数采用运行时动态路径（如 `motionModule.<moduleId>.<param>`），其字段集在编译期不可枚举。P0 精化引入了 `MOTION_MODULE_PARAMS` 映射表，从各模块的 `DEFAULTS` 中提取已知的 `moduleId → paramKey` 集合，实现了动态校验：

```ts
// motionModule 参数映射（从各模块 DEFAULTS 提取）
const MOTION_MODULE_PARAMS: Record<string, Set<string>> = {
    'body-posture': new Set(['tilt', 'bend', 'twist', 'bodyHeight', 'bodyDepth']),
    'left-hand': new Set(['pitch', 'yaw', 'roll', 'handPosX', ...]),
    // ... 其他模块
};

function isValidStatePath(path: string): boolean {
    // ...
    if (prefix === 'motionModule') {
        const moduleId = rest.slice(0, sep);
        const paramKey = rest.slice(sep + 1);
        const params = MOTION_MODULE_PARAMS[moduleId];
        if (!params) return false; // 未知模块 ID
        return params.has(paramKey);
    }
    return false;
}
```

**注意**：新增 motion 模块时需同步更新 `MOTION_MODULE_PARAMS`，否则新模块的 bind 路径会被判为无效。

## 3. 备选方案（未采纳）

| 方案 | 能否捕获功能缺陷 | 运行成本 | 未采纳理由 |
|------|----------------|---------|-----------|
| **A. DOM 扫描器（隔壁方案）** | 否，只查结构 | 需浏览器，慢 | 看影子不看物体 |
| **B. Schema 驱动 E2E** | 部分 | 需浏览器，慢 | P0 先落地静态分析，P1 可选补充 |
| **C. AST 分析（ts-morph）** | 是 | 编译期，零运行时 | 投入高，且 schema 是运行时对象不是 AST 节点 |

## 4. 影响

| 文件 | 变更 |
|------|------|
| `frontend/src/menus/menu-registry.ts` | 新增：注册表 + `collectAllSchemas` + `flattenNodes` |
| `frontend/src/menus/menu-schema-register.ts` | 新增：集中注册点 |
| `frontend/src/menus/env-sky-levels.ts` | 改：提取 `getSkySchema()` 导出 |
| `frontend/src/menus/env-wind-levels.ts` | 改：提取 `getWindSchema()` 导出 |
| `frontend/src/menus/env-fog-levels.ts` | 改：提取 `getFogSchema()` 导出 |
| `frontend/src/menus/env-cloud-levels.ts` | 改：提取 `getCloudSchema()` 导出 |
| `frontend/src/menus/env-shadow-levels.ts` | 改：提取 `getShadowSchema()` 导出 |
| `frontend/src/menus/env-water-levels.ts` | 改：提取 `getWaterSchema()` 导出 |
| `frontend/src/menus/env-ground-levels.ts` | 改：提取 `getGroundSchema()` 导出（合并 6 个子 schema） |
| `frontend/src/menus/env-experimental-levels.ts` | 改：提取 `getExperimentalSchema()` 导出 |
| `frontend/src/menus/env-menu.ts` | 改：`buildParticleSchema` 加 `export` |
| `frontend/src/menus/scene-render-levels.ts` | 改：导出 `buildPostProcessCoreSchema` / `buildPostProcessColorSchema` |
| `frontend/src/menus/motion-gaze-levels.ts` | 改：提取 `getGazeSchema()` 导出（含 perception 域 22 bind 路径） |
| `frontend/src/menus/settings-controls.ts` | 改：导出 `buildCameraSchema` |
| `frontend/src/menus/settings-graphics.ts` | 改：导出 `buildFrameQualitySchema` / `buildEffectsSchema` / `buildPhysicsHudSchema` |
| `frontend/src/__tests__/menu-schema.integrity.test.ts` | 改：扩展 mock 覆盖 scene/motion/settings 域依赖；新增 §6-§10 检查维度 |
| `frontend/src/__tests__/schema-snapshot.test.ts` | **新增**：P1 阶段 1 — 生成 `e2e/schema-snapshot.json` |
| `frontend/e2e/schema-driven.spec.ts` | **新增**：P1 阶段 2 — 通用 schema 驱动 E2E 测试（158 用例） |
| `frontend/e2e/helpers.ts` | 改：扩展 `ENV_SUB_TESTID`（补充云/水/地面）；新增 `clickMotionSubLevel` / `clickSettingsSubLevel` |

## 5. 当前覆盖

| 域 | 面板数 | 节点数 | bind 路径 | i18n key | folder | modeSlider | 断言数 |
|----|--------|--------|----------|---------|--------|-----------|--------|
| env | 9 | 133 | 97 | 142 | 17 | 5 | ~280 |
| scene | 2 | — | 20+ | 20+ | — | — | ~60 |
| motion | 1 | 43 | 22 | 30 | 1 | 3 | ~100 |
| settings | 4 | 30+ | 19+ | 30+ | — | — | ~90 |
| model | — | — | — | — | — | — | 待推广 |
| **合计** | **16** | **~206** | **~158** | **~222** | **~18** | **~8** | **753** |

## 6. 推广路径

1. **env 域**（已完成）：9 面板，~280 断言
2. **scene 域**（已完成）：2 面板（postprocess-core / postprocess-color），~60 断言
3. **motion 域**（已完成）：1 面板（gaze），~100 断言；骨骼模块参数走 `motionModule.*` 动态路径，已通过 §2.4 动态映射表校验（P0 精化）
4. **settings 域**（已完成）：4 面板（camera / frame-quality / effects / physics-hud），~90 断言
5. **model 域**：model 面板几乎全是 `renderCustom`，元测试价值低，可跳过
6. **P1 推进**（已完成原型）：schema 驱动 E2E 框架建成，16 面板 / 158 用例自动生成。待完善 settings 域嵌套导航 + 复用共享 mock 工厂

## 7. 发现的真实问题

`env-fog-levels.ts` 的 modeSlider options label 用了 `t()` 调用（`t('env.exp2')`），而 `env-sky-levels.ts` 没用（直接 `'env.solid'`）。这导致 fog 的 options label 在测试中被翻译，sky 的不会——**schema 不一致**。当前测试通过（因为 `env.exp2` 等在 zh-CN.ts 中存在），但建议后续统一为直接 i18n key。

## 8. 已知局限

| 局限 | 当前行为 | 风险 | 回收方向 |
|------|---------|------|---------|
| ~~**i18n 仅校 zh-CN 单包**~~ | ~~已修复：P0 精化引入 5 语言包（zh-CN/en/ja/ko/zh-TW）校验~~ | — | — |
| ~~**motionModule.* 不校字段存在性**~~ | ~~已修复：P0 精化引入 `MOTION_MODULE_PARAMS` 映射表，动态校验 moduleId + paramKey~~ | — | — |
| ~~**folder 仅查有 children 者**~~ | ~~已修复：P0 精化改为「children 非空 或 存在 renderCustom」~~ | — | — |
| **schema 求值依赖渲染层→mock 膨胀** | 每推广一域需新增一批 `vi.mock`（当前已 20+ 个）隔断 Babylon/渲染初始化。`schema-snapshot.test.ts` 内联 mock 未复用 `menu-schema-mocks.ts` 中的共享工厂 | 测试维护成本随域数线性上涨；mock 与真实导出漂移时可能假绿 | 复用 `menu-schema-mocks.ts` 的 `mockScene()` / `mockLighting()` / `mockPerception()` 共享工厂；长期将 `getXxxSchema()` 内的渲染依赖延迟到渲染时 resolve，使 schema 回归纯数据 |
| **MOTION_MODULE_PARAMS 硬编码** | 新 motion 模块需手动更新测试中的映射表，否则 bind 路径判失败 | 新增模块时可能忘记同步更新 | 长期方案：直接 import `getBuiltinModuleDefs()` 动态提取，但需解决 Babylon 依赖副作用 |
| **settings 域嵌套导航** | settings:camera/frame-quality/effects/physics-hud 位于 performance/rendering folder 下，需二次导航；当前用文本匹配回退 | settings 域 E2E 可能因导航问题假红 | 实现嵌套 folder 导航：`#btnSettings` → `folder:settings:performance` → 子面板 |
| **P1 依赖 Vite dev server** | `schema-driven.spec.ts` 需要运行 `npm run dev` 才能执行 | CI 集成需额外启动 dev server | 长期：Playwright 直接启动 Vite（`webServer` 配置），纳入 CI 流水线 |

> 说明：前两项局限已通过 P0 精化修复。剩余三项为当前可接受的权衡，不阻塞 1427 断言的价值。

## 9. 验证

```bash
cd frontend && npx vitest run src/__tests__/menu-schema.integrity.test.ts
```

- 1427 个断言全通过（11 个测试套件共 793 测试）
- 不依赖浏览器，vitest 秒级运行（~46ms）
- 新增菜单面板时：在 `menu-schema-register.ts` 加一行 `registerSchema(...)` 即自动覆盖

```bash
# 生成 P1 快照
cd frontend && npx vitest run src/__tests__/schema-snapshot.test.ts
```

- 16 面板 / 193 节点 / 156 bind 路径 / 181 i18n label
- 输出到 `e2e/schema-snapshot.json`，供 Playwright 消费

```bash
# 运行 P1 schema 驱动 E2E（需先启动 Vite dev server）
cd frontend && npm run dev &
npx playwright test e2e/schema-driven.spec.ts --grep "@dom"
```

- 158 个 E2E 测试用例，覆盖全部 16 面板
- 分域导航：env（9 面板）、motion（1 面板）、settings（4 面板）、scene:postprocess（2 面板）

## 10. P1 Schema 驱动 E2E — 通用方案

### 10.1 目标

在 P0 静态分析的基础上，增加浏览器内的端到端验证——确认 schema 声明的每个节点都被正确渲染为 DOM 元素。

### 10.2 实现架构

**核心思路**：不是 DOM 扫描，而是从 schema 反推测试路径。采用「快照生成 → 通用 E2E」两阶段架构：

```
┌─────────────────────────────┐     ┌─────────────────────────────────┐
│ 阶段 1: Schema 快照生成      │     │ 阶段 2: 通用 E2E 测试           │
│ (vitest, 秒级, 不开浏览器)   │ ──► │ (Playwright, 需 Vite dev server) │
└─────────────────────────────┘     └─────────────────────────────────┘
```

**阶段 1** — `schema-snapshot.test.ts`：
- 导入 `menu-schema-register`（所有已注册 schema）
- 用 `vi.mock` 隔离 Babylon/渲染层副作用
- 将所有 schema 序列化为纯数据 JSON → `e2e/schema-snapshot.json`
- 16 面板 / 193 节点 / 156 bind 路径 / 181 i18n label

**阶段 2** — `schema-driven.spec.ts`：
- 读取 `schema-snapshot.json`
- 遍历所有面板 × 所有节点，自动生成 Playwright 断言
- 每个交互式节点验证：DOM 可见性、控件类型、options 数量、属性值

**分域导航策略**（`navigateToPanel()` 函数）：

| 域 | 根按钮 | 子面板导航 |
|----|--------|-----------|
| env | `#btnEnv` (`openEnvPanel`) | `clickEnvSubLevel(page, label)` → `data-testid="folder:env:<slug>"` |
| motion | `#btnMotionPopup` (`openMotionPopup`) | `clickMotionSubLevel(page, label)` → `data-testid="folder:motion:<slug>"` |
| settings | `#btnSettings` (`openSettingsPanel`) | `clickSettingsSubLevel(page, label)` → 文本匹配回退（嵌套结构待完善） |
| scene:postprocess | `#btnEnv` (实际在 env 域) | `clickEnvSubLevel(page, '后处理')` → `data-testid="folder:env:postprocess"` |

### 10.3 能捕获的缺陷

| 缺陷类型 | 示例 |
|----------|------|
| 渲染器 bug | schema 声明 `kind: 'slider'` 但渲染出不是 `input[type=range]` |
| 渲染器遗漏 | `visibleWhen` 返回 true 但节点未渲染 |
| 控件类型错误 | `modeSlider` 被渲染为普通 `div` 而非 segmented control |
| 属性丢失 | slider 的 `min`/`max`/`step` 属性未正确传递到 DOM |

### 10.4 覆盖范围

158 个 E2E 测试用例，覆盖全部 16 个面板：

| 域 | 面板数 | 测试用例 |
|----|--------|---------|
| env | 9 | ~100 |
| scene | 2 | ~20 |
| motion | 1 | ~15 |
| settings | 4 | ~23 |
| **合计** | **16** | **158** |

### 10.5 零新增成本

新增面板时的完整流程：
1. 在 `*-levels.ts` 中导出 `getXxxSchema()` 函数
2. 在 `menu-schema-register.ts` 加一行 `registerSchema(...)`
3. 运行 `schema-snapshot.test.ts` 重新生成快照
4. ✅ E2E 自动覆盖新面板的所有节点

### 10.6 运行方式

```bash
# 1. 生成快照
cd frontend && npx vitest run src/__tests__/schema-snapshot.test.ts

# 2. 启动 Vite dev server
npm run dev

# 3. 跑 P0 + P1 全套
npx vitest run src/__tests__/menu-schema.integrity.test.ts   # P0 元测试
npx playwright test e2e/schema-driven.spec.ts --grep "@dom"     # P1 E2E
```

### 10.7 推广计划

1. ✅ P1 通用方案已建成（16 面板 / 158 用例自动生成，分域导航已实现）
2. ✅ 导航路径映射已完善（env: 9 面板用 testId 导航；motion: 1 面板用 testId；settings: 4 面板文本回退；scene:postprocess 归入 env 域）
3. 🔧 解决 mock 膨胀问题（让 `getXxxSchema()` 回归纯数据，或复用 `menu-schema-mocks.ts` 中的共享 mock 工厂）
4. 🔧 settings 域嵌套结构导航（camera/frame-quality/effects/physics-hud 在 performance/rendering folder 下，需二次导航）
5. 将 P1 纳入 CI 门禁（当前为非阻塞，需 Vite dev server）

## 11. 与隔壁方案的关系

本方案**不替代** DOM 扫描器，而是**补充**：
- DOM 扫描器验证「渲染结果完整」（schema → DOM 的渲染链路无 bug）
- 本方案验证「schema 本身正确」（bind 路径有效、i18n key 存在、id 唯一）

两者互补，共同覆盖从数据到渲染的完整链路。
