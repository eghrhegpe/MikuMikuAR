# 地面反射逻辑性审计（假设性：地面不反射角色 / 反射错误）

> **审计对象**：`frontend/src/scene/env/env-impl.ts`（地面镜面反射 Phase B）、`env-water.ts`（水面反射，作为对照）、`env-terrain.ts`（地形材质）
> **审计角度**：在「假设地面不反射角色」或「反射内容错误」的前提下，反向推导代码在哪些路径会落空 / 出错 / 静默失效
> **关联**：ADR-083 §5.1（互斥机制、MirrorTexture 方案）、第⑨轮镜面反射审计（部分结论被本审计修正）
> **审计日期**：2026-07-12

---

## 0. 系统地图（两套反射，互不兼容的投影机制）

| 系统 | 投影机制 | 反射纹理挂载 | 投影 UV 来源 |
|------|---------|-------------|-------------|
| 水面反射 | 自定义 `ShaderMaterial` | `mat.setTexture('reflectionTexture', _mirrorRT)` | 显式 `vScreenCoord` 屏幕空间（env-water.ts:415-422）✅ 正确 |
| 地面反射 | `StandardMaterial.reflectionTexture` | `mat.reflectionTexture = _groundMirrorRT`（env-impl.ts:752） | 依赖 `reflectionTexture.getReflectionTextureMatrix()`（由 RT 的 `mirrorPlane` 推导）❌ 未配置 |

**核心矛盾**：水面反射自己写屏幕空间投影，所以正确；地面反射把 RT 直接挂到 `StandardMaterial` 却**没有走 MirrorMaterial 的平面投影机制**（ADR-083 §2 明写的是 `MirrorTexture planar reflection`），导致投影矩阵退化为单位阵。这是「反射错误」最可能的根因（见 B1）。

---

## A. 故障模式一：地面**不反射角色**（彻底无反射）

### A1 🟠 P2 — GridMaterial 地面：RT 空转、反射永不挂载
| 文件:行 | 观察 | 影响 |
|---------|------|------|
| `env-impl.ts:750` / `:827` | `buildGroundReflection` 挂载条件为 `mat instanceof StandardMaterial`；`grid` 风格用 `GridMaterial`（env-impl.ts:894），该判断恒为 `false` | grid 地面即便 `groundReflectionQuality≠off && blend>0`，RT 仍被创建并每帧 `_groundMirrorRT.render()`（env-impl.ts:1082），但**反射纹理永不挂到可见材质** → 角色在 grid 地面上不反射；RT 每帧空耗 GPU |

**修复**：`shouldEnable` 阶段先判断地面材质可挂载性；grid 风格若需反射，应改用兼容 StandardMaterial 反射的材质或自写 ReflectionMaterial（同水面做法）。至少应在 `shouldEnable` 为 true 但材质不可挂载时 `console.warn` 而非静默创建 RT。

### A2 🟠 P2 — 地形(heightmap) 地面：反射脆弱 / 一经改参即永久丢失
| 文件:行 | 观察 | 影响 |
|---------|------|------|
| `env-impl.ts:871-879` | `applyGround` 的 `terrain` 分支在 `createHeightmapGround(...)` 后直接 `return`，**不经过 `buildGroundReflection`**（该函数仅在 flat 创建分支 line 950 与 in-place 分支 line 859 被调用） | terrain 地面反射只在「`keyChanged===false` 且进入 in-place 分支」时建一次 |
| `env-impl.ts:787` | terrain 的 `typeKey` **不含** `groundReflection*` 字段 | 一旦修改任何 terrain typeKey 参数（heightmap/level/size/color/alpha/texture/scale/rotation 等几乎全部），`keyChanged=true` → 走重建 → terrain 分支 `return` → 反射永久丢失，且不再重建 |

用户感知即「地形地面不反射」。地形材质虽为 `StandardMaterial`（env-terrain.ts:144/156/214），可挂载，但**触发路径被 return 截断**。

**修复**：在 `applyGround` 的 terrain 分支 `onReady` 回调内，于 `applyTerrainMaterial` 之后补调 `buildGroundReflection(state)`；或在分支末尾统一调用（与 flat 分支对齐）。

### A3 🟡 P3 — 角色沉地时反射中"消失"
| 文件:行 | 观察 | 影响 |
|---------|------|------|
| `env-impl.ts:691` | `_populateGroundMirrorRenderList` 排除 `bounds.maximumWorld.y < groundLevel` 的网格 | 脚穿地 / 下沉时角色被排除，反射中角色消失。多为预期行为，但易被误判为反射失效 |

---

## B. 故障模式二：地面**反射错误内容**（反射错 / 乱反射）

### B1 🔴 P1/P2 — 缺少镜像平面投影配置（核心根因）
| 文件:行 | 观察 | 影响 |
|---------|------|------|
| `env-impl.ts:636-646`（`_createGroundMirrorRT`） | 创建 RT 时**未设置 `mirrorPlane`**，也无显式 `coordinatesMode = PLANAR` | `StandardMaterial` 的 planar 反射 UV 由 `reflectionTexture.getReflectionTextureMatrix()` 决定，该矩阵在 RT 无 `mirrorPlane` 时退化为**单位阵** |
| `env-impl.ts:748-756` | 仅 `mat.reflectionTexture = _groundMirrorRT` + `.level`，无投影矩阵配置 | 反射按 identity 投影采样（≈ 以世界 XZ 当 UV）→ 角色反射位置/比例彻底错位、呈现乱反射或伪像 —— 即典型「反射错误的情形」 |

**对照**：水面反射在自定义 frag 中显式 `vec2 reflUV = vec2(vScreenCoord.x, 1.0 - vScreenCoord.y)`（env-water.ts:415-422），投影正确。地面却把 RT 直接挂 `StandardMaterial` 而偏离 ADR-083 声明的 MirrorMaterial 投影机制，导致几何错误。

**置信度**：静态分析高置信度；建议运行时确认（`console.log(mat.reflectionTexture.getReflectionTextureMatrix())` 是否非单位阵）。

**修复（任一）**：
```typescript
// 方案 A：补全 MirrorMaterial 式投影（在 _createGroundMirrorRT / 高度变化时）
_groundMirrorRT.mirrorPlane = new Plane(0, 1, 0, -groundLevel);
_groundMirrorRT.coordinatesMode = Texture.PLANAR_MODE;
// 注意：groundLevel 变化时需同步更新 _groundMirrorRT.mirrorPlane

// 方案 B（与 ADR-083 §2 一致）：改用 MirrorMaterial 而非 StandardMaterial
//   const mat = new MirrorMaterial('envGroundMat', scene);
//   mat.reflectionTexture = _groundMirrorRT;  // MirrorMaterial 自动接管 mirrorPlane 投影
```

### B2 🟠 P2 — 倾斜地面反射平面不跟随
| 文件:行 | 观察 | 影响 |
|---------|------|------|
| `env-impl.ts:660` | 镜像平面固定 `new Plane(0, 1, 0, -groundLevel)`（水平面） | `groundPitch/groundRoll` 使可见地面旋转（env-impl.ts:940），但反射仍按水平面计算 → 反射与倾斜地面几何错位（"歪反射"）。heightmap 已禁倾斜安全；flat 模式倾斜+反射即错位 |

**修复**：镜像平面应按地面 world matrix 的法线/旋转构造（或用 `Matrix.Reflection` 作用于地面旋转后的平面），与 `_updateGroundMirrorCamera` 共用同一变换来源。

### B3 🟡 P3 — 反射相机 `maxZ=200` 截断远处角色
| 文件:行 | 观察 | 影响 |
|---------|------|------|
| `env-impl.ts:652` | `_createGroundMirrorCam` 的 `maxZ = 200` | 角色距镜像相机 >200 单位时被裁剪，大场景远处角色反射缺失/截断 |

---

## C. 故障模式三：互斥失效（地面 + 水面同时反射）

### C1 🟠 P2 — 互斥守卫是死代码（修正第⑨轮"互斥 ✅"判定）
| 文件:行 | 观察 | 影响 |
|---------|------|------|
| `env-impl.ts:853` 与 `:944` | `applyGround` 在调用 `buildGroundReflection(state)` **之前**已执行 `state.planarReflectBlend = 0`（此处 `state` 即全局 `envState`，按引用修改） | 守卫 `if (envState.planarReflectBlend > 0) disableWaterReflection()`（line 714）永远读到 `0` → **`disableWaterReflection()` 从不执行** |
| `env-water.ts:944` | 水面 observer 每帧仍 `_mirrorRT.render()` | 开启地面反射时，水面 RT 不被销毁、继续渲染 → 地面反射 + 水面反射**同时渲染**，违背 ADR-083 §5.1 互斥，且双倍 GPU；关闭地面反射时亦不恢复水面 |

第⑨轮审计（round-9-mirror-reflection.md:175）判"互斥守卫 ✅"，系未察觉 line 853/944 的**顺序清零**使守卫恒假。

**修复**：将互斥裁决上移到 `applyGround` 顶部，在清零 `planarReflectBlend` **之前**读取原始值决定是否 `disableWaterReflection()`；或给 `buildGroundReflection` 传独立标志（如 `disableWater: boolean`）而非依赖已被清零的 `envState.planarReflectBlend`：
```typescript
// applyGround 顶部（在其它逻辑之前）
if (state.groundReflectionQuality !== 'off' && state.groundReflectionBlend > 0) {
    if (envState.planarReflectBlend > 0) disableWaterReflection();
}
```

### C2 🟡 P3 — 即便守卫触发，`planarReflectBlend=0` 也关不掉无 env 纹理时的水面反射
| 文件:行 | 观察 | 影响 |
|---------|------|------|
| `env-water.ts:413-423` | `#ifdef PLANAR_REFLECTION` 内，当**无** `ENV_TEXTURE` 时走 `#else reflection = planarRefl;`（line 421），**未用 `planarReflectBlend` 混合** | 场景无 environmentTexture 时，即便 `planarReflectBlend=0`，水面 shader 仍直接采用 `planarRefl` → 水面反射不关闭。互斥的"关水"机制在无 env 纹理下失效 |

**修复**：无 `ENV_TEXTURE` 分支也应用 `planarReflectBlend`（`reflection = mix(vec3(0), planarRefl, planarReflectBlend)`），或直接用 `disableWaterReflection()` 真正销毁 RT。

---

## D. 健壮性 / 资源

### D1 🟡 P3 — `_groundMirrorRT.render()` / `_mirrorRT.render()` 无异常保护
| 文件:行 | 观察 | 影响 |
|---------|------|------|
| `env-impl.ts:1082` / `env-water.ts:944` | 显式 `rt.render()` 无 try-catch | 若 renderList 中某 mesh 在渲染前被 dispose（模型快速切换），异常会中断整个 `onBeforeRenderObservable` 回调 → 后续 `updateUnderwaterTransition`、scene tick 回调（env-impl.ts:1098-1102）全部跳过 |

**修复**：`try { rt.render(); } catch (e) { console.warn(...) }`（参考 renderer.ts:134 ReflectionProbe 已有的 try-catch 保护）。

### D2 🟢 P4 — RT 双重驱动（customRenderTargets + 显式 render）
| 文件:行 | 观察 | 影响 |
|---------|------|------|
| `env-impl.ts:745` + `:644` | RT 入 `scene.customRenderTargets` 且 `refreshRate = REFRESHRATE_RENDER_ONCE`，同时每帧显式 `rt.render()` | RENDER_ONCE 使自动路径仅首帧渲染一次（多为空帧），稳态靠显式调用，存在一次冗余自动渲染。与水面同款模式，建议统一澄清 |

### D3 🟡 P3 — 不可挂载材质仍创建/渲染 RT
| 文件:行 | 观察 | 影响 |
|---------|------|------|
| `env-impl.ts:720-746` | grid 等非 StandardMaterial 地面，`buildGroundReflection` 仍创建 RT 并每帧渲染，仅挂载步被跳过 | 无谓 GPU 开销；应在 `shouldEnable` 阶段先判断材质可挂载性 |

---

## 风险全景

| 级别 | 数量 | 条目 |
|------|------|------|
| 🔴 P1 | 1 | B1 镜像平面投影缺失（反射错根因） |
| 🟠 P2 | 4 | A1 grid 不反射、A2 地形反射脆弱、B2 倾斜平面错位、C1 互斥守卫死代码 |
| 🟡 P3 | 5 | A3 沉地消失、B3 maxZ 截断、C2 无 env 时关不掉水、D1 无异常保护、D3 不可挂载仍渲染 |
| 🟢 P4 | 1 | D2 RT 双重驱动 |

---

## 与第⑨轮审计的差异说明

第⑨轮（round-9-mirror-reflection.md）判定「互斥策略正确」「StandardMaterial.reflectionTexture.level 语义正确」「几何正确」。本审计在更细的代码顺序与投影配置层面发现：

1. **互斥守卫实为空转**（C1）：`applyGround` 在守卫求值前已清零 `planarReflectBlend`，故 `disableWaterReflection()` 永不触发 —— 第⑨轮"互斥 ✅"不成立。
2. **地面反射投影未配置**（B1）：代码偏离 ADR-083 声明的 MirrorMaterial 方案，未设 `mirrorPlane`，StandardMaterial planar 反射矩阵退化为单位阵 —— 第⑨轮未检视投影矩阵，默认其正确。
3. **grid / terrain 地面反射路径缺口**（A1/A2）：第⑨轮未覆盖具体地面风格的材质分支差异。

以上三项构成「地面不反射角色 / 反射错误」的主要代码落点。

---

## 建议修复优先级

| 优先级 | 条目 | 修复动作 |
|--------|------|---------|
| 🔴 立即 | B1 | 设 `_groundMirrorRT.mirrorPlane` + `coordinatesMode=PLANAR`（或改用 MirrorMaterial）；groundLevel 变化时同步更新 plane |
| ⚠️ 短期 | C1 | 互斥裁决上移 `applyGround` 顶部，先于 `planarReflectBlend=0` 清零 |
| ⚠️ 短期 | A1 / A2 | grid 风格反射兼容 / terrain 分支补调 `buildGroundReflection` |
| ⚠️ 短期 | B2 | 镜像平面随地面 pitch/roll 构造 |
| 中期 | C2 / D1 / D3 | 无 env 时关水用 `disableWaterReflection`；render 包 try-catch；不可挂载材质不建 RT |
| 低 | B3 / D2 | `maxZ` 调大；澄清 RT 驱动方式 |

---

## 修复落地记录（2026-07-12）

> 文件：`frontend/src/scene/env/env-impl.ts`

| 条目 | 修复手段 | 关键改动 |
|------|---------|---------|
| **B1（核心）** | 地面反射 RT 由 `RenderTargetTexture` 改为 **`MirrorTexture`** | `MirrorTexture` 原生按 `mirrorPlane` 推导 planar 反射投影矩阵，根除「投影退化为单位阵」。原审计报告「方案 A」（`rt.mirrorPlane` 直挂 `RenderTargetTexture`）不可行——普通 RT 无该属性/投影逻辑，故采用 ADR-083 §2 声明的 `MirrorTexture` 路线 |
| **B2** | 镜像平面随地面世界变换构造 | 新增 `_computeGroundMirrorPlane()`：`Plane.FromPositionAndNormal(getAbsolutePosition(), TransformNormal(Up, worldMatrix))`，每帧同步至 `rt.mirrorPlane`，倾斜地面亦对齐 |
| **B3** | 移除独立镜像相机 `_groundMirrorCam`（其 `maxZ=200` 截断远处角色） | `MirrorTexture` 直接复用 `scene.activeCamera` 做反射，继承主相机 `maxZ`，远端角色不再截断 |
| **C1** | 互斥守卫死代码废除 | `buildGroundReflection` 中改为**无条件** `disableWaterReflection()`（`disableWaterReflection` 幂等，内部先判 `_mirrorRT`）；不再依赖已被清零的 `envState.planarReflectBlend` |
| **A1 / D3** | GridMaterial 等非 StandardMaterial 地面短路 | `buildGroundReflection` 在 `shouldEnable` 后先判材质可挂载性；不可挂载则 `disposeGroundReflection()` 并返回 + 一次性 `console.warn`，不再空转建/渲染 RT |
| **A2** | 地形分支补挂反射 | `applyGround` 的 `terrain` 分支 `onReady` 回调内、`applyTerrainMaterial` 之后补调 `buildGroundReflection(state)`（此前直接 `return` 致反射永久丢失） |
| **D1** | `_groundMirrorRT.render()` 包 try-catch | 渲染异常仅 `console.warn` 并跳过本帧，不再中断整条 `onBeforeRenderObservable` |

**已删除**：`_createGroundMirrorCam`、`_updateGroundMirrorCamera`、`_groundMirrorCam` 变量及其全部引用（手动相机反射已由 `MirrorTexture` 内部接管）。

### 仍需运行时验证（无法静态判定）
1. **镜像平面符号/方向**：`MirrorTexture.mirrorPlane` 的符号约定（当前用 `FromPositionAndNormal` 取地面世界上法线）需实际渲染确认反射未上下翻转或错位。若异常，调整为向下法线 `new Plane(0,-1,0, groundLevel)` 变体。
2. **双渲染问题**：`MirrorTexture` 挂在 `material.reflectionTexture` 后引擎可能自动渲染，叠加手动 `rt.render()`（受 `RT_REFRESH_ONCE` + 分帧控制）。若存在可见双渲染开销，可考虑移除 `scene.customRenderTargets.push` 改由引擎自动驱动。
3. **互斥恢复**：关闭地面反射时不自动恢复此前的水面反射（行为与原实现一致，属 ADR-083 互斥的「不同存」边界，非本次回归）。是否需要「关地即开水」建议另立 ADR 决策。

### 修复后编译
- `npx tsc --noEmit` 通过（无类型错误）。
- 未改动 `env-water.ts`（水面反射保持现状，仅被 `disableWaterReflection` 正确关闭）。
