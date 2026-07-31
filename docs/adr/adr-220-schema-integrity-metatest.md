# ADR-220: Schema 完整性元测试 —— 不开浏览器，秒级捕获 schema 漂移

> **状态**: 实施中（env 域 9 面板 + scene 域 2 面板 + motion 域 1 面板 + settings 域 4 面板，共 16 面板 753 断言全绿；model 域待推广）
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
| **i18n key 存在性** | `label` + `modeSlider.options[].label` → 查 `zhCN` 的 keys | 语言包缺失 key |
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

### 2.4 动态路径白名单（motion 域推广引入）

motion 域的骨骼模块参数采用运行时动态路径（如 `motionModule.<moduleId>.<param>`），其字段集在编译期不可枚举（随已注册模块动态变化），无法像 `env.*` 那样挂一个静态 `Set`。因此 `isValidStatePath` 对未知前缀不一律判失败，而是对白名单内的动态前缀（当前仅 `motionModule`）放行：

```ts
const keySet = STATE_PREFIX_MAP[prefix];
if (!keySet) {
    // 未知前缀：motionModule 等动态路径跳过字段校验
    return prefix === 'motionModule';
}
return keySet.has(field);
```

**权衡**：白名单是“有意识的覆盖缺口”——它放弃了对 `motionModule.*` 字段存在性的校验（换取 motion 域可接入）。后续若需回收这个缺口，可在模块注册表建立后从 registry 反向提取已注册模块的合法参数名集，将白名单升级为真实校验。新增动态前缀时需同步扩展此白名单，否则该前缀下所有 bind 会被判失败。

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
| `frontend/src/__tests__/menu-schema.integrity.test.ts` | 改：扩展 mock 覆盖 scene/motion/settings 域依赖；新增 §6-§10 检查维度；扩展 UI_KEYS 硬编码 |
| `frontend/src/__tests__/menu-schema.integrity.test.ts` | 改：§1 跳过有自定义 get/set 的控件（bind 为逻辑标识） |

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
3. **motion 域**（已完成）：1 面板（gaze），~100 断言；骨骼模块参数走 `motionModule.*` 动态路径，已通过 §2.4 白名单接入
4. **settings 域**（已完成）：4 面板（camera / frame-quality / effects / physics-hud），~90 断言
5. **model 域**：model 面板几乎全是 `renderCustom`，元测试价值低，可跳过
6. **P1 推进**：待上述 P0 跑稳后，考虑 schema 驱动 E2E（导航 → 断言 DOM 渲染）

## 7. 发现的真实问题

`env-fog-levels.ts` 的 modeSlider options label 用了 `t()` 调用（`t('env.exp2')`），而 `env-sky-levels.ts` 没用（直接 `'env.solid'`）。这导致 fog 的 options label 在测试中被翻译，sky 的不会——**schema 不一致**。当前测试通过（因为 `env.exp2` 等在 zh-CN.ts 中存在），但建议后续统一为直接 i18n key。

## 8. 已知局限（推广期技术债）

| 局限 | 当前行为 | 风险 | 回收方向 |
|------|---------|------|---------|
| **i18n 仅校 zh-CN 单包** | `I18N_KEYS` 只取 `zhCN` 的 keys；label 在 zh-CN 有、ja/ko/en/zh-TW 缺失时测试仍绿 | 线上非中文用户可能看到 raw key | 将 `I18N_KEYS` 改为五个语言包 keys 的交集，或逐包各校一遍 |
| **motionModule.* 不校字段存在性** | 见 §2.4 白名单，动态前缀直接放行 | 骨骼模块 bind 拼错参数名不会被捕获 | 从模块注册表反向提取合法参数名集，白名单升级为真实校验 |
| **folder 仅查有 children 者** | `renderCustom` folder 跳过；若某 folder 既无 children 也无 renderCustom（真空节点），当前也会因“无 children 属性”而跳过 | 真空文件夹缺陷会被漏掉 | 断言改为“`children` 非空 **或** 存在 `renderCustom`”，两者皆无才判失败 |
| **schema 求值依赖渲染层→mock 膨胀** | 每推广一域需新增一批 `vi.mock`（当前 env 域已 10+ 个）隔断 Babylon/渲染初始化 | 测试维护成本随域数线性上涨；mock 与真实导出漂移时可能假绿（见“vi.mock 缺失导出”历史坑） | 根因是 `getXxxSchema()` 在模块顶层 import 渲染依赖；长期应将 schema 回调（`apply`）内的依赖延迟到渲染时 resolve，使 schema 回归纯数据 |

> 说明：上述四项均为 P0 阶段可接受的权衡（先落地静态分析、再逐域收紧），不阻塞当前 244 断言的价值。推广到 scene/motion 域时优先处理第 1、4 项（i18n 多包 + mock 膨胀）。

## 9. 验证

```bash
cd frontend && npx vitest run src/__tests__/menu-schema.integrity.test.ts
```

- 753 个断言全通过（11 个测试套件共 793 测试）
- 不依赖浏览器，vitest 秒级运行（~23ms）
- 新增菜单面板时：在 `menu-schema-register.ts` 加一行 `registerSchema(...)` 即自动覆盖

## 10. 与隔壁方案的关系

本方案**不替代** DOM 扫描器，而是**补充**：
- DOM 扫描器验证「渲染结果完整」（schema → DOM 的渲染链路无 bug）
- 本方案验证「schema 本身正确」（bind 路径有效、i18n key 存在、id 唯一）

两者互补，共同覆盖从数据到渲染的完整链路。
