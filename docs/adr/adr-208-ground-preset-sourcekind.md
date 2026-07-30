# ADR-208: 地面预设贴图设计统一 —— sourceKind 语义标注（预留）+ 程序化纹理防覆盖

- **状态**: ✅ 已完成
- **日期**: 2026-07-30
- **相关**: ADR-114（地面 PBR/反射合并）、ADR-134（无限地面）、ADR-137（EnvState 单一源 Schema）、ADR-173（setEnvState middleware）
- **源码锚点**: `scene/env/env-ground-presets.ts:GroundPreset.sourceKind`、`scene/env/env-ground.ts:applyGround`（原地更新守卫 ~L1096）

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

### 1. 引入 sourceKind 语义标注（预设层，预留字段，本次未接 UI 消费）

`GroundPreset` 新增 `sourceKind: 'solid' | 'canvas' | 'texture' | 'procedural'`：

| sourceKind | 含义 | 预设 |
|------------|------|------|
| `solid` | 无图案纯色 | 素净灰、镜面舞台 |
| `canvas` | 运行时 canvas 图案（grid/checker） | 赛博网格 |
| `texture` | 文件贴图 | 草地、石板 |
| `procedural` | 运行时程序化 PBR 三件套 | 木纹舞台、金属舞台 |

**边界决策**：`sourceKind` **仅存于预设层**，不进 `buildGroundPresetEnvState` 返回、不进 `GROUND_PRESET_KEYS`、不写 `envState`。
因此旧存档零迁移、`applyGround` 渲染热路径与 `typeKey` 构造完全不动。它服务于「预设意图可读性」，不驱动渲染，也不参与 `applyGround` 分派。本次**未接入任何 UI 消费方**——chip 高亮已由 `groundPreset` 字段驱动（与 sourceKind 无关）；按贴图来源给 chip 分组/加图标的展示增强为**未来预留增强**，本 ADR 不实现。

> **防漂移约定（审核补充）**：未来若接入 UI 分派，须以 `groundStyle` / `groundProceduralTexture` 为准，`sourceKind` 仅作展示分组，**不得作为并行渲染分派依据**，避免与 state 层形成隐式双状态源。运行期「地面来源类别」可由 `groundProceduralTexture` / `groundTextureEnabled` / `groundStyle` 推导，建议后续抽 `getGroundSourceCategory(state)` 纯函数供 `typeKey` 构造（env-ground.ts:1116-1120）与原地更新守卫（:1130）共用，消除两处同源判断的隐性耦合。

### 2. 清理程序化预设死字段

金属舞台、木纹舞台的 `groundStyle: 'solid'` 改为 `groundStyle: 'texture'`，使其与「有贴图来源」语义自洽。
程序化分支优先级最高，故此改不影响首次构建走向；使守卫第一条判据 `groundStyle !== 'texture'` 对程序化预设结果为 `false`，从而**正确跳过** `_updateGroundTexture`（不再覆盖程序化 albedo）。

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

## 审核记录（2026-07-30）

审核结论：**通过（Pass）**。状态「✅ 已完成」，申报的三处落地（sourceKind 字段与分布、死字段清理、守卫收紧三重 AND）与代码**逐字一致**；测试守护含负向用例（即便 `groundStyle` 退化回 `solid`，`proc≠none` 守卫仍拦截覆盖）。`typeKey` 构造未动、`sourceKind` 不进 `envState`、旧存档零迁移，三项影响声明核实成立。

### 已采纳建议（已写入上文）

- 🟢 P4 决策 2 措辞："正确放行"→"正确跳过 `_updateGroundTexture`"，消除"放行了 canvas 覆盖"的误读。
- 🟡 P3 边界段补「防漂移约定」：`sourceKind` 仅作展示分组、不得作为并行渲染分派依据；建议抽 `getGroundSourceCategory(state)` 供 `typeKey` 构造与原地更新守卫共用（非阻塞，留作增强）。

### 遗留（非阻塞）

- `typeKey` 分支（env-ground.ts:1116-1120）与原地更新守卫（:1130）对"地面来源类别"的判断为同源隐性耦合，新增来源类别时需同步两处；抽 `getGroundSourceCategory` 可根除该耦合。
