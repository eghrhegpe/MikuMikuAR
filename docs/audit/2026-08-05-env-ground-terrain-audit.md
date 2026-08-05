# 地面/地形系统（env-ground / env-terrain / env-ground-spec / ground-collision）审核

**日期**: 2026-08-05
**发现方式**: 子代理只读审核（general agent）+ 主线程人工抽查验证
**审核范围**: `frontend/src/scene/env/env-ground.ts`(1499) / `env-terrain.ts`(315) / `env-ground-presets.ts`(377) / `env-ground-spec.ts`(430) / `frontend/src/scene/physics/ground-collision.ts`
**参考**: ADR-114 / ADR-226 / ADR-192 / ADR-073
**总体结论**: 有条件通过（已修复 P2 后转通过，见文末「修复状态」）

---

## 1. 导入图谱

| 文件 | 依赖来源 | 说明 |
|------|----------|------|
| `env-ground.ts` | `@babylonjs/core`、`@/core/config`、`@/core/color-helpers`、`@/core/logger`、`./env-terrain`、`./planar-reflection`、`./env-reflection`、`./_shared/env-texture`、`./_shared/env-context`、`./env`、`./env-underwater-fog`、`./env-water`、`./_shared/env-type-helpers`、`./env-ground-presets`、`./env-ground-spec` | 零叶工具仅引 `@/core/clamp`（经 env-terrain）等，**无 `@/core/utils` 神桶** |
| `env-terrain.ts` | `@/core/config`、`./_shared/env-texture`、`@/core/clamp`、`./env-ground`（`_effectiveBumpLevel`）、`./env-underwater-fog`、`@/core/math/hash-noise` | 叶子模块，re-export hash2/valueNoise |
| `env-ground-presets.ts` | `@/core/config`（type-only） | 纯数据 |
| `env-ground-spec.ts` | `env-ground`（14 个符号）、`env-terrain`、`env-water`、`env-underwater-fog`、`env-ground-presets` | 反向依赖 env-ground（消费其 helper），单一方向，无环 |
| `ground-collision.ts` | babylon-mmd 物理类、`@/core/config`、`@/core/dispose-helpers`、`@/core/mmd-adapter`、`@/core/logger` | 经 ADR-192 适配层 |

**发现循环依赖**：`env-ground.ts:35` `import { ensureEnvUpdateObserver } from './env'`，而 `./env → ./env-impl → ./env-ground` 形成 `env-ground → env → env-impl → env-ground` 三节点环。因 `ensureEnvUpdateObserver` 仅在 `applyGround` 运行时调用（ESM 函数提升 + 非模块初始化期访问），当前不炸，但违反 AGENTS.md「无循环依赖」约束，且测试被迫 mock `./env`（env-ground.test.ts:44）绕过。

## 2. 状态读写追踪

| 模块级状态 | 写入点 | 唯一性 |
|-----------|--------|--------|
| `_currentGroundKey` (env-ground.ts:574) | 重建路径 L1336 / disposeGround L1483 | 单一 |
| `_onTerrainReady` / `_onGroundChanged` (575-576) | setter + 直接读 L1389/L1329 + disposeGround 置 null | 单一 |
| `_prevGroundHeight/Pitch/Roll` (577-579) | 原地路径 L1326-1328 / disposeGround 复位 | 单一；**重建/隐藏路径不复位**（见 P4-⑦） |
| `_groundScrollU/V` (580-581) | tickGround / 重建 L1337-1338 / disposeGround | 单一 |
| `_scanRingPhase` (583) | tickGround L1456 / disposeGround | 单一；重建不复位（cosmetic） |
| **`_groundRipples`/`_groundRippleApplied` (587-588)** | `_syncGroundRippleTexture`/`_disableGroundRippleTexture`/disposeGround | **重建路径不重置 → 陈旧引用被恢复（P2）** |
| `_texGroundImg/_texGroundImgUrl/_texGroundGeneration` (616-618) | `_ensureTextureGroundImage` + `clearGroundTexCache`，generation 守卫 | 单一，无幽灵路径 |
| `_groundActualSize` (567) | `setGroundActualSize` / disposeGround | 单一 |
| `_terrainGen` (env-terrain.ts:76) | `createHeightmapGround` ++ | 单一；仅测试重置（生产不归零，仅计数器无害） |
| `_groundBody/_groundInfo/_groundShape` (ground-collision.ts:30-32) | enable/disable | 单一 |

结论：除涟漪模块状态外，写入点均唯一、无幽灵路径。

## 3. 资源配对验证（new/create/add ↔ dispose/remove）

| 资源 | 创建 | 释放 | 配对 |
|------|------|------|------|
| 地面材质 (Standard/PBR) | createGroundMaterial L141/143 | disposeGroundMaterial L560 / applyTerrainMaterial L191 | 配对 |
| 程序化三件套 | getOrCreateCanvasTexture（env-texture 缓存） | disposeTextureCache（env-impl 时）+ LRU 退役不立即释放 | 缓存专属所有权清晰 |
| canvas 纹理 `envGround` | createCanvasTexture L969 | `_updateGroundTexture` 旧 tex L1206 | 配对 |
| 文件贴图 DynamicTexture `envGroundTex` | L1066 | needCreate 旧 dt L1064 + disposeGroundMaterial Step1 | 配对 |
| 外部 normal Texture | L1217 / env-terrain L225/L245 | `_syncGroundNormalTexture` else L1225 + dispose 路径 Step1 | 配对（cache-owned 豁免） |
| 反射 RT/相机 | planar-reflection.create | groundReflection.dispose/disable（含 customRenderTargets 摘除、BFC 恢复） | 配对 |
| 地面 mesh | CreateGround L407 / CreateGroundFromHeightMap L102 | applyGround 重建 L1343 + disposeGround L1480 | 配对 |
| **涟漪纹理** | env-water-fx L318 | disposeGroundRipples **＋ disposeGroundMaterial 也会 dispose**（L522-525） | **双归属双释放（P2）** |
| tick observer | env-impl ensureEnvUpdateObserver L129 | disposeEnvUpdateObserver L202 safeDispose | 配对 |
| 水下焦散 install | env-ground-spec L396/L425、env-ground L1382 | uninstall（disposeGroundMaterial L558 / applyTerrainMaterial L189） | 配对（有 P1-fix 注释） |
| 地形 mesh 的 onReady 后材质 | applyTerrainMaterial 内 | 若 stale 回调在 dispose 后到达则无释放点（P3） | 隐患 |

重点核验：applyGround 重建路径先 `disposeGroundMaterial(oldMesh.material)` + `oldMesh.dispose()` 再建新（L1340-1345），无重复 mesh；disposeGround 覆盖材质/网格/反射/涟漪/缓存全通道（L1476-1498）；程序化纹理有 `clearGroundTexCache` 通道但注意它清的是**文件图缓存**（见 invariant 漂移）。

## 4. 心理模拟结论

**① 契约检查（ADR-226 双路径）**：非地形两路径均从 `buildGroundMaterialSpec` 派生——重建走 `createGroundMeshFromSpec`（env-ground.ts:1402）、原地走 `applyGroundMaterialSpec`（L1315），判定键统一 `specKey(buildGroundMaterialSpec(state))`（L1303），**无残留手拼 typeKey**。**但 terrain 路径是例外**：重建仍为手写 legacy 块（L1351-1395，含手拼程序化三件套逻辑），原地走 `_applyGroundInplaceLegacy`（L1250-1295），两条平行逻辑均未从 spec 派生；代码注释自认「待补 terrain 合约测试后收敛」。此外 `createGroundMeshFromSpec` 内还藏着一个 terrain 分支（env-ground-spec.ts:389-403），生产上 `applyGround` 提前 return 了 terrain 故为**死代码**，但它是第三份 divergent 实现（且未 `setGroundActualSize`，`_syncTextureGroundTexture` 会用陈旧 `_groundActualSize` 算纹理密度——潜在 bug）。

**② 状态机（快速连切预设/模式）**：重建幂等——每次先 dispose 旧 mesh/材质再建新，`_envSys.ground.mesh` 单引用覆盖，无重复 mesh。`tickGround` 在 mesh 缺失/材质非 ground 时全部 guard 空转（L1415-1416），observer 未注册时安全。terrain 重建后 onReady 未到期间 mesh 无 material：此窗口内的原地更新被 `if (mat && …)` 静默跳过，但 onReady 闭包捕获的是 `envState` 同一对象（setEnvState 原地 mutate），故 onReady 应用的是**最新** state，行为可接受。

**③ 异常模拟**：`applyGround` 中途抛错时，`_currentGroundKey` 已先于创建被置（L1336），若创建失败 `_envSys.ground.mesh` 为 null，下次同 key 调用因 `mesh` 为空仍走重建 → 可自愈，错误上抛到 setEnvState 调用方，不吞不扩散。**`createHeightmapGround` 的 onReady 陈旧回调竞态**：`_terrainGen` 只防「新地形取代旧地形」（env-terrain.ts:113-115）；**不防「地形被移除/换非地形而未重建」**——此时 gen 未递增，旧回调在 `oldMesh.dispose()` 后通过 gen 校验，对已销毁 mesh 执行 `applyTerrainMaterial`（新建材质挂在死 mesh 上）→ 泄漏 + 僵尸材质（P3）。

**④ 引用计数 / 并发边界**：observer 注册于 `scene.onBeforeRenderObservable`，`disposeEnvUpdateObserver` safeDispose 移除；RT 上的 bfcSave/bfcRestore observer 随 rt.dispose 级联移除；scene 销毁时 env-impl 依次 disposeTextureCache → _disposeGround → 涟漪/水下复位。`_texGroundGeneration` 守卫陈旧图片回写。**`generateTerrainHeightmapURL` 本身同步无竞态**，竞态仅在 `CreateGroundFromHeightMap` 的异步 onReady（同 ③）。

## 5. 知识卡 invariant 核验结果

| # | 知识卡声明 | 核验 |
|---|-----------|------|
| 1a | disposeGround 释放地面材质/网格/反射/涟漪资源 | 一致（L1476-1498 全覆盖） |
| 1b | …「经 safeDispose 安全清理」 | **轻微漂移**：disposeGround 内是直接 `mesh.dispose()`/`mat.dispose()`（带 null 守卫），未用 safeDispose；safeDispose 只在 env-impl/ground-collision 使用。语义安全但机制描述不符 |
| 1c | 程序化 6 预设 × albedo+roughness+normal 三通道 | 一致（PROCEDURAL_GENERATORS，env-ground.ts:425-456） |
| 1d | UV 滚动每帧由 tickGround(dt) 驱动 | 一致（L1408-1439） |
| 1e | getGroundHeightAt 含倾斜平面插值 | 一致（getTiltedPlaneHeight L736-750） |
| 1f | 卡片正文：`clearGroundTexCache() — 清理程序化纹理缓存`（env-ground.md:84） | **漂移**：`clearGroundTexCache`（L620-624）只清外部文件图缓存 `_texGroundImg*`；程序化纹理缓存在 env-texture `_texCache`，由 `disposeTextureCache` 释放 |
| 2 | terrain 确定性哈希 / fbm~[-1,1] / 256² 灰度图 / isPickable=true | 一致（hash2/valueNoise 确定性、fbm L35 归一化、TERRAIN_HM_SIZE=256、onReady L117 `isPickable=true`，就绪前临时 false） |
| 3a | 重建与原地两路径须从同一份 spec 派生，禁手拼 typeKey/平行逻辑 | **部分漂移**：非地形已全收敛；**terrain 重建+原地仍是手写平行逻辑**（注释明示暂缓），未满足声明全量 |
| 3b | specKey 由 structural 子集自动序列化 | 基本一致，但 `groundPattern` 属 structural 却**未入 specKey**（L247-258，靠原地重绘兜底，合理但未文档化）；alpha/level 非 terrain 不入 specKey 有注释说明 |
| 4 | collision：WASM-only / 幂等 / 失败释放 / 2000m / 全组全掩码 / friction 0.9 / remove 抛错不阻断 | 全部一致；头部注释「由 env-bridge.setGroundCollisionEnabled 驱动」与实现 `env-collision.ts` 名错位（轻微漂移） |
| 5 | 涟漪联动经 env 门面注册更新 | 一致（env-impl observer → updateGroundRipples L178；geometry provider 模块期注入 L571） |

## 6. 亮点

- `disposeGroundMaterial` 的缓存所有权处理（env-ground.ts:505-561）：Step1 仅释放非缓存纹理、Step2 先脱离缓存贴图再 `mat.dispose()`，配合 `underwaterFogController.uninstall`，根除「PBR+缓存程序化三件套被连带释放」历史雷（metal 预设敏感，注释详实）。
- `specKey` 单一决策键取代手拼 typeKey（env-ground.ts:1300-1303）+ 合约测试四套护栏（rebuild==inplace、legacy==spec、infinite 消除 spurious rebuild、emissive/overlay 外观性）。
- `_terrainGen` 代际计数器（env-terrain.ts:73-128）+ `_texGroundGeneration`（L1032-1047）双陈旧回调防护，注释讲清「快速连切」场景。
- ground-collision `try/catch/finally` 契约（ground-collision.ts:91-99）：remove 抛错 logWarn 不阻断 dispose 链。
- `applyGroundMaterialSpec` 程序化分支保留程序化 normal 除非用户显式提供外部法线（env-ground-spec.ts:355-360），修复 legacy 原地清程序化法线的历史 bug。
- env-texture LRU 上限 + `_retiredTextures`（env-texture.ts:132-142）防程序化纹理缓存无界增长。

## 7. 风险表

| 严重度 | 文件:行号 | 具体问题 | 整改建议 |
|--------|-----------|----------|----------|
| P1 | — | 未发现 | — |
| P2 | env-ground.ts:505-561 + 587-612 + env-water-fx.ts:311-329 | **涟漪纹理跨模块所有权被破坏**：`disposeGroundMaterial` Step1 把非缓存的 `bumpTexture`（即 `groundRippleTex`）dispose 掉，而 env-water-fx 仍持有 `_groundRippleTex` 引用；重建后 `getGroundRippleTexture` 因 `_groundRippleTex` 非空返回已销毁纹理（不重建），涟漪系统永久失效直到 disposeGround。且 `_groundRipples`/`_groundRippleApplied` 在重建路径不重置，`_disableGroundRippleTexture` 会把**上一代材质的陈旧 bump（可能是不同程序化 kind 的 normal）**恢复到新材质上 | ① disposeGroundMaterial 对 name==='groundRippleTex' 的纹理跳过（或纳入缓存所有权标记）；② applyGround 重建路径先复位 `_groundRipples=null; _groundRippleApplied=false`；③ 补一条「涟漪激活时重建地面」的测试 |
| P3 | env-terrain.ts:112-121 + env-ground.ts:1336-1348 | **地形 onReady 陈旧回调在「移除而非替换」场景漏防**：`_terrainGen` 只防 terrain→terrain；terrain→隐藏/换 flat 时 gen 不递增，旧回调越过 gen 校验对已 dispose 的 mesh 执行 applyTerrainMaterial，新材质挂死 mesh 泄漏 | onReady 首行补 `if (gm.isDisposed()) return;`；或在 applyGround 重建 dispose 旧 mesh 前递增地形代际 |
| P3 | env-ground-spec.ts:389-403 + env-ground.ts:1249-1401 | **terrain 双路径未收敛 spec（invariant 3a 漂移）**：terrain 重建 legacy 块、原地 `_applyGroundInplaceLegacy`、spec 内死代码 terrain 分支三份平行实现，其中 spec 分支未 `setGroundActualSize`，`_syncTextureGroundTexture` 会用陈旧 `_groundActualSize` 算纹理密度 | 已按 ADR-226 Phase 4 收尾：补 terrain 合约测试（Suite 6 覆盖 elevationColoring）后删 legacy 双路径，仅留 spec 单源；`applyGroundMaterialSpec` 加 `isElevation` 守卫；spec terrain 分支补 `setGroundActualSize` |
| P4 | env-ground.ts:35 | `env-ground → env → env-impl → env-ground` 循环导入（运行时安全但违反 AGENTS.md「无循环依赖」） | 将 `ensureEnvUpdateObserver` 提升至 env-dispatcher/独立叶子，砍掉环 |
| P4 | env-ground.md:84 / env-ground.md:57 / ground-collision.ts:6 | 文档漂移：`clearGroundTexCache` 描述为「清程序化缓存」（实际清文件图缓存）；disposeGround「经 safeDispose」（实际直接 dispose）；collision「由 env-bridge 驱动」（实际 env-collision.ts） | 修正知识卡/头部注释 |
| P4 | env-ground.ts:1336-1338 | 重建只复位 `_groundScrollU/V`，`_scanRingPhase` 不复位（相位延续，cosmetic） | 顺手复位或注释豁免 |
| P4 | env-ground.ts:1346 | groundVisibleEnabled=false 重建路径不复位 `_prevGroundHeight/Pitch/Roll` 哨兵；同高度 hide→show 不再触发 `_onGroundChanged`（模型不重新贴地） | 隐藏时复位哨兵 |
| P4 | env-terrain.ts:305-306 | `applyElevationColoring` 释放 prev 材质时 `diffuseTexture?.dispose()` 无 `isCacheOwnedTexture` 守卫（当前因 applyTerrainMaterial 已置 `ground.material=null` 而不可达，潜伏） | 对齐 disposeGroundMaterial 模式加守卫 |
| P4 | env-ground-spec.ts:247-258 | `groundPattern` 属 structural 却未入 specKey（依赖原地重绘兜底，行为正确但未文档化） | 注释说明豁免理由 |

**i18n 维度**：env-ground.ts / env-terrain.ts / env-ground-spec.ts / ground-collision.ts 均为纯逻辑无 UI 文案，不适用；`GROUND_PRESETS` 的 `label` 中文硬编码位于数据层，菜单层已用 `t(GROUND_PRESET_I18N[key] ?? gp.label)`（env-ground-levels.ts:38）兜底，可接受。

## 修复状态

| 严重度 | 状态 | 说明 |
|--------|------|------|
| P2 涟漪纹理所有权 | ✅ 已修复 | 见 `docs/buglog/` 对应记录；disposeGroundMaterial 跳过 groundRippleTex、重建路径复位涟漪状态、补回归测试 |
| P3 地形 onReady 陈旧回调 | ✅ 已修复 | onReady 首行补 `if (gm.isDisposed()) return;`（env-terrain.ts:116）；补 2 条回归测试（陈旧回调不触发 + 存活 mesh 正常触发），9 tests passed，tsc 通过 |
| P3 terrain 双路径未收敛 spec | ✅ 已修复 | 见 ADR-226 Phase 4b 记录；删 `_applyGroundInplaceLegacy` + legacy 重建块，统一 spec 单源；`applyGroundMaterialSpec` 加 `isElevation` 守卫；spec terrain 分支补 `setGroundActualSize`；新增 Suite 6 terrain 合约测试 2 例，28/28 全绿 |
| P4 循环导入 / 文档漂移 / 哨兵 | ⬜ 待修 | 低优先，可随日常改动顺手处理 |
