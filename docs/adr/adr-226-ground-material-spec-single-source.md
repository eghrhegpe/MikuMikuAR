# ADR-226: 地面材质单一事实源重构（GroundMaterialSpec）

> **日期**: 2026-08-01
> **状态**: 规划
> **关联**：ADR-052（地面模式）、ADR-114（PBR 材质适配层）、ADR-134（无限地面）、ADR-160（地面涟漪）、ADR-208（地面预设 sourceKind）

---

## 背景

地面子系统 `frontend/src/scene/env/env-ground.ts` 的 `applyGround(state)` 目前维护**两条平行逻辑**来落地同一份材质：

- **重建路径**（L1200–1333）：`typeKey` 变化时 `dispose + CreateGround + 重建材质`（含 `if/else` 按 source 分支）。
- **原地路径**（L1140–1198）：`typeKey` 未变时直接 mutate 材质属性（alpha / UV offset / normal / ripple / PBR props / edge fade）。

两条路径必须对任意「材质相关状态」保持语义一致，但它们是**手写的、分叉的实现**。当前代码已留下历次踩坑的修复疤痕，证明该结构在「扩展边界」脆弱：

| 疤痕（env-ground.ts） | 根因 |
|------------------------|------|
| L1143–1145 注释：程序化 PBR 三件套会被 canvas 纯色覆盖 | 原地路径的 source 守卫（L1146–1152）漏排除新 source |
| L1292–1296 注释：粗糙度贴图生成后未赋给材质 | 重建路径分支漏接 PBR 属性 |
| L1163 / L1281 / L1307：纹理密度与 mesh 尺寸成正比（三处重复 fix） | 同一不变量在双路径各修一遍 |
| L1328–1330：必须先赋值 mesh 再 buildGroundReflection | 重建路径时序坑 |

**脆弱点的精确机制**：加任何「碰材质」的功能，维护者必须同时改 **3–4 处且逻辑一致**，漏一处即材质错乱：

1. `typeKey` 字符串拼装（L1131–1136）—— 漏加字段 → 永远走原地路径、不触发重建；
2. 原地路径的 source 守卫（L1146–1152）—— 漏排除 → 新 source 被 canvas 纯色覆盖；
3. 重建路径 `if/else` 分支（L1273–1319）—— 漏接 → 新 source 材质赋值丢失；
4. PBR 桥接 `_setAlbedoTex/_getAlbedoTex/_setAlbedoColor`（L87–112）—— 新材质参数无法在 Standard/PBR 双实现下表达。

`typeKey` 是**手动维护的字符串哨兵**，是这一脆弱性的核心：它把「哪些字段算结构性变化」编码成了一段易漏易错的字符串拼接。

## 决策

引入 **`GroundMaterialSpec` 单一事实源**，将「地面材质应该长什么样」描述为一个纯数据结构，由单一 `buildGroundMaterialSpec(state)` 生成；重建与原地两条路径都从这份 spec 派生，不再各自手拼逻辑。

- `buildGroundMaterialSpec(state)` → `GroundMaterialSpec`（结构性 + 外观性字段，唯一真相源）。
- `specKey(spec)` → 由 `structural` 子集**自动序列化**得到稳定 key（取代手拼 `typeKey`）。
- `groundSpecNeedsRebuild(prev, next)` → `specKey` 比较（即 `diffSpec` 的结构性结论）。
- `applyGroundMaterialSpec(mat, state, scene)` → 把 spec 落到已有材质（取代原地路径的散布 mutate）。
- `createGroundMeshFromSpec(state, scene)` → 建几何 + 基础材质 + 调 `applyGroundMaterialSpec`（取代重建路径的 `if/else`）。

**关键收益**：加新功能只需往 `buildGroundMaterialSpec` 填一个字段；`specKey` 自动包含它，重建/原地/key 三处**自动一致**，原地路径不再需要人工 source 守卫。

## 方案

### 1. Spec 数据结构（env-ground-spec.ts）

```typescript
export type GroundGeometryKind = 'flat' | 'infinite' | 'terrain';
export type GroundSourceKind = 'solid' | 'canvas' | 'texture' | 'procedural';

export interface GroundStructuralSpec {
  geometry: GroundGeometryKind;       // groundType / groundInfiniteEnabled
  size: number;                        // flat/infinite → groundSize；terrain → 60
  terrainHeight: number;
  terrainScale: number;
  terrainSeed: number;
  terrainOctaves: number;
  pbrEnabled: boolean;                 // groundPbrEnabled
  sourceKind: GroundSourceKind;        // 派生：terrain / texture / procedural / canvas(solid)
  // canvas/source 判别符（决定纹理生成管线，需重建）
  canvasStyle: string;                 // groundStyle
  overlay: string;                     // groundOverlay
  gridSize: number;                    // groundGridSize
  lineColor: [number, number, number];
  color: [number, number, number];
  pattern: string;                     // groundPattern
  proceduralTexture: string;           // groundProceduralTexture
  proceduralSeed: number;
  proceduralScale: number;
  textureUrl: string;                  // groundTexture
  reflectionQuality: string;
  alpha: number;                       // terrain 模式下 alpha 进结构性（历史一致性，见下）
  level: number;                       // terrain 模式进结构性
}

export interface GroundAppearanceSpec {
  alpha: number;                       // non-terrain：增量
  edgeFade: number;
  textureScale: number;
  textureRotation: number;
  normalTexture: string | null;
  normalStrength: number;
  metallic: number;
  roughness: number;
  reflectionBlur: number;
  reflectionDistort: number;
  reflectionBlend: number;
  scrollSpeedX: number;
  scrollSpeedZ: number;
  pitch: number;
  roll: number;
}

export interface GroundMaterialSpec {
  structural: GroundStructuralSpec;
  appearance: GroundAppearanceSpec;
}
```

### 2. 自动 key（杀死手拼 typeKey）

`specKey(spec)` 对 `structural` 做**确定性序列化**（字段序固定 + 数值精度固定）。`buildGroundMaterialSpec` 忠实复刻当前 `typeKey` 在各分支的判别符集合（见 `env-ground.ts` L1131–1136），但表达为类型化对象。新增结构性字段 = 改接口 + 在 `buildGroundMaterialSpec` 赋值，`specKey` 自动纳入，**无手拼遗漏风险**。

> 已知历史不一致（待迁移时 revisit，不阻塞本 ADR）：当前 `alpha`/`level` 仅在 terrain 分支进 `typeKey`，canvas/texture 模式走增量。Spec 用 `structural.alpha/level` 仅在 `geometry==='terrain'` 时取值，其余模式归入 `appearance`，以**逐字节保留现有行为**。

### 3. 函数职责

- `applyGroundMaterialSpec(mat, state, scene)`：按 `spec.structural.sourceKind` 选 source（procedural → `generateProceduralGroundTextures`；canvas → `_updateGroundTexture`；texture → `_syncTextureGroundTexture`；solid → `_setAlbedoColor`），随后统一设置 alpha / transparencyMode / UV scale+offset / normal / ripple / PBR props / edge fade。
- `createGroundMeshFromSpec(state, scene)`：terrain → `createHeightmapGround` + `applyTerrainMaterial`；flat/infinite → `MeshBuilder.CreateGround` + `createGroundMaterial` + 调 `applyGroundMaterialSpec` 填充；最后设 transform + `underwaterFogController.install` + `buildGroundReflection`。

### 4. 分阶段迁移（逐步，不改行为直到全部完成）

| Phase | 动作 | 行为变化 |
|-------|------|----------|
| 0 | 落地 `env-ground-spec.ts`（spec/key/diff/apply/create）+ 导出 env-ground 必要内部 helper（仅加 `export`，无逻辑改动） | 无（新模块本回合未被 applyGround 引用） |
| 1 | `applyGround` 重建路径（平面/无限）改调 `createGroundMeshFromSpec`；terrain 保留 legacy 分支（含 elevationColoring / `_onTerrainReady` 语义） | ✅ 已实现（2026-08-01）：等价替换，tsc 0 错 + 合约测试 23/23 + env-ground.test 19/19 不回归；terrain 因 elevationColoring 行为差未受合约测试覆盖，留待 Phase 2 收敛 |
| 2 | `applyGround` 原地路径改为调 `applyGroundMaterialSpec` | 等价替换 |
| 3 | 补 contract 测试：断言「重建产物 == 原地产物」（同 state 下 mesh.material 等价），CI 锁死双路径分叉 | 已落地（23 例全绿）；并修复 legacy 程序化 normal 被原地路径清掉的不一致 bug（见下） |
| 4 | 删除旧双路径 + 手拼 `typeKey`；`applyGround` 退化为 `if (groundSpecNeedsRebuild(prev,next)) createGroundMeshFromSpec else applyGroundMaterialSpec` | 结构性收敛完成 |

## 对比方案

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A. GroundMaterialSpec 单一事实源（选中）** | 加功能只改一处；key 自动派生；双路径语义强制一致 | 前期需导出内部 helper + 写 apply/create 委托 | ✅ |
| B. 保留双路径，仅补 contract 测试兜底 | 改动最小 | 不消除根因，维护者仍须手写 3–4 处一致性 | ❌ |
| C. 每次改动都全量重建材质（弃用原地路径） | 彻底消灭双路径 | 拖滑杆（alpha/UV）每次重建，性能不可接受 | ❌ |

## 不变量（迁移前后必须保持）

- `subdivisions` 恒为 2（性能）；纹理重复由 `uScale/vScale` 而非几何细分控制。
- 纹理密度 `= meshSize/10/scale`，与 mesh 尺寸正比（防拉伸模糊）。
- PBR 粗糙度读 `metallicTexture` 的 **Green** 通道（`useRoughnessFromMetallicTextureAlpha=false`，`useRoughnessFromMetallicTextureGreen=true`）。
- 反射 `buildGroundReflection` 必须在 mesh 赋值后调用（L1328 时序坑）。
- 地形高度图异步：`spawn` 先回退 `groundLevel`，`onReady` 后重贴地。

## 涉及文件

| 文件 | 操作 | 阶段 |
|------|------|------|
| `docs/adr/adr-226-ground-material-spec-single-source.md` | 新增 | 本回合 |
| `frontend/src/scene/env/env-ground-spec.ts` | 新增（spec/key/diff/apply/create） | Phase 0 |
| `frontend/src/scene/env/env-ground.ts` | 内部 helper 加 `export`；`applyGround` 两路径逐步改调 spec 模块 | Phase 0–4 |

## 风险

- **Phase 0 导出 helper 属非行为改动**，但若误改签名会影响编译；以 tsc 校验。
- **Phase 1/2 等价替换**存在逐字段语义偏差风险，必须以 Phase 3 一致性测试 + 手动渲染双重验证，禁止「信任摘要」直接合入。
- 地形 `onReady` 回调含 `_onTerrainReady` 等模块局部状态，迁移时须保持回调触发时机不变。

## Phase 3 执行记录（2026-08-01）

### 交付物

- 测试：`frontend/src/__tests__/scene/env-ground-spec.contract.test.ts`（**23 例全绿**，tsc 全项目 0 错）。
- 双重护栏：
  - **A. spec 内部契约**（`Suite 3`）：同结构性 spec 下，重建 `stateB` 必须 == 原地 `A→B`。覆盖 solid/canvas/procedural/texture × flat/infinite 共 7 例。
  - **B. 迁移护栏**（`Suite 4/5`）：legacy `applyGround`（重建 / 原地）产物必须 == spec 模块（`createGroundMeshFromSpec` / `applyGroundMaterialSpec`）。
  - `Suite 1/2`：`buildGroundMaterialSpec` 确定性 + `groundSpecNeedsRebuild` 结构性判别（外观变更不触发、结构变更加触发）。

### 合约测试锁出的两个 legacy 缺陷

| 缺陷 | 根因 | 处置 |
|------|------|------|
| **程序化 normal 被原地路径清掉** | `_syncGroundNormalTexture`（L1093）的 `else` 分支在 `groundNormalTexture` 为空时 `dispose + null` bump；重建路径（L1287–1314）**不调用**它故保留程序化 normal，而原地路径（L1182）调用它故清掉 → legacy 内部不一致（重建保留、原地丢失）。 | spec 模块对 `procedural` source 且外部 normal 为空时跳过 `_syncGroundNormalTexture`（保留程序化 normal）；**并对称修复 legacy 原地路径**同名守卫，使 legacy 重建/原地一致。修复后 Suite 4/5 程序化用例全绿。 |
| **重建路径 canvas 纹理密度漏除 `scale`** | 重建路径 `tex.uScale = _groundActualSize/10`（L1321）漏乘 `groundTextureScale`，原地路径（`_groundActualSize/10/scale`）正确。 | spec 模块重建/原地统一用 `_groundActualSize/10/scale`，已正确；`Suite 4` 末条显式断言 legacy(`/10`) ≠ spec(`/10/scale`)，把该 legacy bug 锁进文档，待 Phase 1 接 spec 后自然消失。 |

### 涉及改动（本回合）

| 文件 | 改动 |
|------|------|
| `frontend/src/scene/env/env-ground-spec.ts` | `applyGroundMaterialSpec`：`procedural` 且外部 normal 为空时跳过 `_syncGroundNormalTexture`（保留程序化 normal） |
| `frontend/src/scene/env/env-ground.ts` | 原地路径（L1182 附近）：对称守卫，修复程序化 normal 被原地清掉的历史 bug |
| `frontend/src/__tests__/scene/env-ground-spec.contract.test.ts` | 新增 Phase 3 合约测试（23 例） |

## Phase 1 执行记录（2026-08-01）

### 范围决策
- **收敛对象**：`applyGround` 重建路径的**平面 / 无限**分支（solid/canvas/texture/procedural × flat/infinite），改为调用 `createGroundMeshFromSpec`，消除手拼 `typeKey` 双路径分叉。
- **暂留 legacy**：`terrain` 分支保留原实现。原因：terrain 程序化分支依赖 `!groundElevationColoringEnabled`（原 L1243）条件套用三件套，而 spec 的 `applyGroundMaterialSpec` 对 procedural 无条件套用；该行为差**未受合约测试覆盖**（Suite 4 仅覆盖平面 7 例 + bug 用例），贸然收敛会改变 elevationColoring 语义且缺测试护栏。留待 Phase 2 单独收敛，并补 terrain 合约测试。

### 改动
| 文件 | 改动 |
|------|------|
| `frontend/src/scene/env/env-ground.ts` | 重建路径平面/无限分支整段（原 L1278–1354）替换为 `createGroundMeshFromSpec(state, scene); return;`；新增 `import { createGroundMeshFromSpec } from './env-ground-spec'`；移除因删除平面分支而变为未引用的 `MeshBuilder` import |
| `frontend/src/__tests__/scene/env-ground-spec.contract.test.ts` | `Suite 4` bug 用例由「断言 legacy≠spec（bug 存在）」改为「断言 legacy==spec（bug 已消除，Phase 1 收敛成果）」——legacy 重建路径现也走 spec，原漏除 `scale` 的 bug 自然消失 |

### 验证
- `tsc --noEmit` 全项目 **0 错误**
- 合约测试 **23/23 全绿**（legacy 重建 == spec 重建的护栏在 Phase 1 后更强：legacy 重建路径本身即收敛到 spec）
- 既有 `env-ground.test.ts` **19/19** 不回归
- 循环依赖安全：`env-ground` ↔ `env-ground-spec` 双向 import 均为函数级延迟调用，无模块顶层执行，ESM/TS 下安全

