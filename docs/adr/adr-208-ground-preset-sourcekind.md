# ADR-208: 地面预设贴图设计统一 —— sourceKind 判别式 + 程序化纹理防覆盖

- **状态**: ✅ 已完成
- **日期**: 2026-07-30
- **相关**: ADR-114（地面 PBR/反射合并）、ADR-134（无限地面）、ADR-137（EnvState 单一源 Schema）、ADR-173（setEnvState middleware）
- **源码锚点**: `scene/env/env-ground-presets.ts:GroundPreset.sourceKind`、`scene/env/env-ground.ts:applyGround`（原地更新守卫 ~L1096）、`core/env-state-schema.ts:groundPreset`

## 背景

7 个地面预设（素净灰 / 镜面舞台 / 草地 / 石板 / 木纹舞台 / 赛博网格 / 金属舞台）的贴图来源，此前由
`groundProceduralTexture` / `groundStyle` / `groundTextureEnabled` / `groundTexture` 四个字段的**隐式组合**决定，
分派优先级散落在 `applyGround` 的重建路径（`env-ground.ts` 程序化分支 > canvas 图案分支 > 文件贴图分支 > 纯色分支）。

这带来两个问题：

### 问题 1：语义暧昧

金属舞台、木纹舞台同时声明 `groundStyle: 'solid'` 和 `groundProceduralTexture: 'metal' | 'wood'`。
由于程序化分支优先级最高，`groundStyle: 'solid'` 是一个**从不生效的死字段**——读者无法从数据判断该预设到底是纯色还是程序化。

### 问题 2：程序化纹理被原地更新覆盖（真实渲染 bug）

`applyGround` 的重建缓存 key `typeKey`（`env-ground.ts`）在 canvas 分支公式中**不含** `groundAlpha` / `groundRoughness` / `groundMetallic`。

复现链路：
1. 首次应用金属舞台 → `typeKey` 变化 → 走**重建路径** → 程序化分支生成 PBR 三件套（albedo/roughness/normal）。
2. 用户改 `groundRoughness`（或 alpha）→ `typeKey` 不变 → `keyChanged = false` → 走**原地更新路径**。
3. 原地路径旧守卫仅判 `state.groundStyle !== 'texture'`，金属舞台 `groundStyle: 'solid'` 满足 → 调 `_updateGroundTexture` → `_generateGroundTexture` 产出 **canvas 纯色纹理**，覆盖掉程序化 albedo。

结果：金属/木纹地面在用户微调任一材质参数后，程序化纹理被替换为纯色。高频触发。

## 设计决策

### 1. 引入 sourceKind 判别式（预设层单一语义标注）

`GroundPreset` 新增 `sourceKind: 'solid' | 'canvas' | 'texture' | 'procedural'`：

| sourceKind | 含义 | 预设 |
|------------|------|------|
| `solid` | 无图案纯色 | 素净灰、镜面舞台 |
| `canvas` | 运行时 canvas 图案（grid/checker） | 赛博网格 |
| `texture` | 文件贴图 | 草地、石板 |
| `procedural` | 运行时程序化 PBR 三件套 | 木纹舞台、金属舞台 |

**边界决策**：`sourceKind` **仅存于预设层**，不进 `buildGroundPresetEnvState` 返回、不进 `GROUND_PRESET_KEYS`、不写 `envState`。
因此旧存档零迁移、`applyGround` 渲染热路径与 `typeKey` 构造完全不动。它服务于「预设意图可读性 + 未来 UI 分组/图标」，不驱动渲染。

### 2. 清理程序化预设死字段

金属舞台、木纹舞台的 `groundStyle: 'solid'` 改为 `groundStyle: 'texture'`，使其与「有贴图来源」语义自洽。
程序化分支优先级最高，故此改不影响首次构建走向；仅让原地更新守卫的第一条判据能正确放行。

### 3. 收紧原地更新守卫（根除覆盖 bug）

`env-ground.ts` 原地更新路径：

```ts
// 旧
if (state.groundStyle !== 'texture') { _updateGroundTexture(mat, state); }
// 新
if (
    state.groundStyle !== 'texture' &&
    state.groundProceduralTexture === 'none' &&
    !(state.groundTextureEnabled && state.groundTexture)
) { _updateGroundTexture(mat, state); }
```

语义：仅当地面确实是 canvas 图案/纯色来源时，原地更新才重生成 canvas 纹理；程序化与文件贴图来源跳过，
交由 `_syncPbrProperties` / `_syncTextureGroundTexture` 增量同步。与决策 2 形成纵深防御——即使 `groundStyle`
未改，`groundProceduralTexture !== 'none'` 也能拦住覆盖。

## 影响

- 数据自洽：每个预设的贴图来源一目了然，消除 solid+procedural 暧昧。
- 覆盖 bug 根除：程序化地面微调材质参数不再退化为纯色。
- 渲染热路径零改动、`envState` 不新增渲染字段、旧存档零迁移。

## 测试

`frontend/src/__tests__/scene/env-ground.test.ts` 新增：
- 每个预设含合法 `sourceKind` 且不落入 `buildGroundPresetEnvState`。
- 程序化预设不残留 `groundStyle: 'solid'`。
- **覆盖 bug 守护（含负向验证）**：应用 metalStage 后改 `groundRoughness` 触发原地更新，断言 albedo
  纹理对象未被替换、metallicTexture 保留。已通过临时放宽守卫确认该测试能捕获 bug。

全量单测无回归。
