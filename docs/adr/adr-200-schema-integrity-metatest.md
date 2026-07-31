# ADR-200: Schema 完整性元测试 —— 不开浏览器，秒级捕获 schema 漂移

> **状态**: 实施中（env 域 9 面板已覆盖，244 个断言全绿；scene/motion/settings/model 域待推广）

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
| **folder children 非空** | 有 `children` 的 folder 检查长度 >0（`renderCustom` folder 跳过） | 空文件夹节点 |
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
| `frontend/src/__tests__/menu-schema.integrity.test.ts` | 新增：P0 元测试（244 断言） |

## 5. 当前覆盖

| 域 | 面板数 | 节点数 | bind 路径 | i18n key | folder | modeSlider | 断言数 |
|----|--------|--------|----------|---------|--------|-----------|--------|
| env | 9 | 133 | 97 | 142 | 17 | 5 | 244 |
| scene | — | — | — | — | — | — | 待推广 |
| motion | — | — | — | — | — | — | 待推广 |
| settings | — | — | — | — | — | — | 待推广 |
| model | — | — | — | — | — | — | 待推广 |

## 6. 推广路径

1. **env 域**（已完成）：9 面板，244 断言
2. **scene 域**：需扩展 `STATE_PREFIX_MAP` 加入 `render.*` 的完整字段集
3. **motion 域**：需加入 `perception.*` 前缀（已有 `DEFAULT_PERCEPTION_STATE`）
4. **settings 域**：需加入 `ui.*` 前缀（已有 `uiState`）；但 settings 面板大量用 `renderCustom`，bind 路径检查覆盖有限
5. **model 域**：model 面板几乎全是 `renderCustom`，元测试价值低，可跳过

## 7. 发现的真实问题

`env-fog-levels.ts` 的 modeSlider options label 用了 `t()` 调用（`t('env.exp2')`），而 `env-sky-levels.ts` 没用（直接 `'env.solid'`）。这导致 fog 的 options label 在测试中被翻译，sky 的不会——**schema 不一致**。当前测试通过（因为 `env.exp2` 等在 zh-CN.ts 中存在），但建议后续统一为直接 i18n key。

## 8. 验证

```bash
cd frontend && npx vitest run src/__tests__/menu-schema.integrity.test.ts
```

- 244 个断言全通过
- 不依赖浏览器，vitest 秒级运行
- 新增菜单面板时：在 `menu-schema-register.ts` 加一行 `registerSchema(...)` 即自动覆盖

## 9. 与隔壁方案的关系

本方案**不替代** DOM 扫描器，而是**补充**：
- DOM 扫描器验证「渲染结果完整」（schema → DOM 的渲染链路无 bug）
- 本方案验证「schema 本身正确」（bind 路径有效、i18n key 存在、id 唯一）

两者互补，共同覆盖从数据到渲染的完整链路。
