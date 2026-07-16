# 水面反射边界情况审核报告

> 审核时间：2026-07-16 21:50
> 审核范围：`env-water.ts` + `water.vert.glsl` + `water.frag.glsl` + `planar-reflection.ts` + `env-terrain.ts`
> 关联 ADR：ADR-114（地面反射增强）、ADR-092（统一平面反射引擎）

---

## 一、架构概览

| 子系统 | 反射机制 | 投影方式 | 模糊策略 | 默认状态 |
|--------|---------|---------|---------|---------|
| 地面反射 | `MirrorTexture`（Babylon 自动渲染） | planar projection（跟随地面倾斜） | mipmap 三线性（PBR roughness 驱动） | medium（开） |
| 水面反射 | `RenderTargetTexture` + 手动渲染 | screenSpace UV 采样 | 5-tap 手动模糊（shader 内） | off（关） |

---

## 二、边界情况审核

### 🔴 P1 — 水面反射材质重建后 RT 未同步重建

**现象**：`_rebuildWaterMaterial` 重建材质后，`_setupMirrorRT` 在惰性路径末尾调用 `waterReflection.update()`，但 `waterReflection.update()` 的 `create` 路径（planar-reflection.ts:226）会检查 `quality !== 'off' && blend > 0`。如果此时 `reflectionQuality` 刚切换为非 off，RT 会被正确创建。

**但**：`_rebuildWaterMaterial` 在 `_setupMirrorRT` 之前调用，新材质的 `options.defines` 已含 `PLANAR_REFLECTION`，`mount` 回调会正确设置 `reflectionTexture`。

**结论**：时序正确，**非真实 bug**。但代码可读性差——重建材质和设置 RT 耦合在同一路径，建议分离。

### 🟠 P2 — 水面反射 RT 分辨率过低导致锯齿

**现象**：`resolutionMap: { high: 512, medium: 256, low: 128 }`。512px 的 RT 在 1920×1080 屏幕上采样，反射区域仅占 ~27% 的像素宽度。

**影响**：角色/建筑在水面反射中呈明显锯齿，尤其 `reflectionQuality='high'` 时仍不够清晰。

**根因**：水面反射 RT 分辨率硬编码为 512，远低于地面反射的 1024。

**建议**：水面反射分辨率提升至 `high: 1024, medium: 512, low: 256`（与地面一致）。

### 🟡 P3 — 水面反射无深度缓冲

**现象**：`planar-reflection.ts:267` 创建 `RenderTargetTexture` 时 `generateDepthBuffer` 默认 `true`，但水面反射的镜像相机 `minZ=0.5, maxZ=5000`。

**影响**：RT 有深度缓冲，但水面本身（`disableDepthWrite=true`）不参与深度测试。如果水面下方有物体（如角色潜入水中），反射中可能出现"水面下方物体被水面遮挡"的视觉错误。

**实际概率**：低。水面 `disableDepthWrite=true` 意味着水面网格本身不写入深度，但反射渲染时水面网格在 renderList 中被 predicate 排除（`!mesh.name.startsWith('envWater')`）。

**结论**：理论上有深度冲突可能，实际被 predicate 排除，**低风险**。

### 🟡 P3 — 水面反射 RT 的 `activeCamera` 与主相机 FOV 不一致

**现象**：`planar-reflection.ts:270-273` 创建 `FreeCamera` 时仅设 `minZ/maxZ`，**未复制主相机的 FOV/aspect ratio**。

**影响**：镜像相机的视锥体与主相机不同，导致反射画面出现**拉伸/裁剪**。尤其当主相机是 `ArcRotateCamera` 或有自定义 FOV 时，反射画面会变形。

**根因**：`new FreeCamera(...)` 使用默认 FOV（HFOV=Math.PI/3 ≈ 60°），而主相机可能是 45°/75° 等不同值。

**建议**：镜像相机应克隆主相机的 `fov`、`aspectRatio` 属性。

### 🟡 P3 — 水面 LOD 切换时反射 RT 不感知

**现象**：`_applyWaterLOD` 切换水面网格可见性（48/16/6 subdivisions），但反射 RT 的 `populateRenderList` 使用固定分辨率（512/256/128）。

**影响**：近景 48-subdiv 水面反射用 512 RT，远景 6-subdiv 水面反射仍用 512 RT。LOD 切换不影响反射质量。

**实际影响**：低。LOD 切换是每帧 `_waterUpdateCallback` 中调用，反射也是每帧更新（high 模式），两者同步。

### 🟠 P2 — 水面反射镜像相机矩阵每帧 `new Plane`

**现象**：`env-water.ts:105` 在 `getMirrorCameraMatrix` 中每帧 `new Plane(0, 1, 0, -s.waterLevel)`。

**影响**：每帧分配一个 `Plane` 对象。虽然 Babylon 有 GC 压力优化，但高频分配仍可能触发 GC。

**建议**：缓存 `Plane` 对象（类似 `env-ground.ts:303-308` 的 `_groundPlaneNormal` 等复用向量）。

### 🟢 P4 — 水面反射 `skipWhenUnderwater: true` 导致水下无反射

**现象**：`planar-reflection.ts:187-192` 当 `skipWhenUnderwater=true` 且相机在水面以下时跳过反射渲染。

**影响**：潜水时水面反射不更新，水面呈现"冻结"的旧反射画面。

**实际体验**：潜水时水面在头顶，反射画面不重要，可接受。但如果相机在水面附近上下移动，反射会出现"跳帧"。

**建议**：水下模式可考虑使用简化反射（低分辨率 RT 或跳过反射但保留焦散）。

### 🟢 P4 — 水面反射 blend=0 时 RT 保活但 shader 不采样

**现象**：`planar-reflection.ts:142` `shouldEnable = quality !== 'off' && blend > 0`。blend=0 时 `disable()` 销毁 RT。

**影响**：`planarReflectBlend=0` 时 RT 被销毁，下次 blend>0 时需重新创建 RT（耗时 ~1-5ms）。

**实际体验**：blend 滑块从 0 调到 >0 时水面反射有短暂闪烁（RT 重建）。

**建议**：RT 创建后不因 blend=0 销毁，仅 `mount(null)` 清引用。blend 变化走 `setBlend` 路径（不重建 RT）。

---

## 三、地面反射边界情况（对比）

### 🟡 P3 — 地形模式 `applyTerrainMaterial` 不含反射挂载

**现象**：`env-terrain.ts:139-212` 的 `applyTerrainMaterial` 创建 PBR/Standard 材质后，**未设置 `reflectionTexture`**。反射挂载由 `buildGroundReflection` 在 `env-impl.ts` 的 terrain 分支中通过 `groundReflection.mount(rt)` 完成。

**影响**：如果 `applyTerrainMaterial` 在 `buildGroundReflection` 之后调用（如地形参数变化触发重建），反射纹理引用被覆盖为 `null`。

**实际概率**：低。`applyGround` 中 terrain 分支先 `createHeightmapGround`（触发 `onReady`→`applyTerrainMaterial`），再 `buildGroundReflection`（line 691），时序正确。

### 🟡 P3 — 高程着色模式（`groundElevationColoring`）跳过反射挂载

**现象**：`env-terrain.ts:167-170` 当 `groundElevationColoring=true` 时 `applyTerrainMaterial` 直接 `return`，不调用 PBR/Standard 材质创建。

**影响**：`_envSys.ground.mesh.material` 为 `null`，`groundReflection.mount(rt)` 在 `env-ground.ts:259-282` 中 `if (!mat) return;` 静默跳过 → **地面反射失效**。

**建议**：高程着色模式也应创建 StandardMaterial 并赋值给 mesh，使反射挂载可用。

---

## 四、修复建议汇总

| 优先级 | 问题 | 文件:行号 | 修复方案 |
|--------|------|----------|---------|
| 🔴 P1 | 水面反射材质重建后 RT 同步 | `env-water.ts:564-566` | 已修复，但建议分离材质重建与 RT 同步 |
| 🟠 P2 | 水面反射 RT 分辨率过低 | `env-water.ts:96` | `resolutionMap: { high: 1024, medium: 512, low: 256 }` |
| 🟡 P3 | 镜像相机 FOV/aspect 不一致 | `planar-reflection.ts:270-273` | 克隆主相机 `fov`/`aspectRatio` |
| 🟡 P3 | 水面反射 `new Plane` 每帧分配 | `env-water.ts:105` | 缓存 `Plane` 对象 |
| 🟡 P3 | 高程着色模式跳过反射挂载 | `env-terrain.ts:167-170` | 创建 StandardMaterial 供反射挂载 |
| 🟢 P4 | blend=0 时销毁 RT | `planar-reflection.ts:142` | RT 保活，仅清材质引用 |

---

## 五、与地面反射对比

| 维度 | 地面反射 | 水面反射 |
|------|---------|---------|
| 反射机制 | MirrorTexture（自动） | RT + 手动渲染（screenSpace） |
| 投影正确性 | planar projection 跟随地面倾斜 ✅ | screenSpace UV 正确 ✅ |
| 分辨率 | 1024/512/256 ✅ | 512/256/128 🔴 偏低 |
| 模糊策略 | mipmap 三线性（PBR roughness 驱动）✅ | 5-tap 手动模糊（刚修复）✅ |
| 镜像相机 | Babylon 内部管理 ✅ | FreeCamera 无 FOV 同步 🟡 |
| 材质重建 | Standard/PBR 重建时反射自动挂载 ✅ | ShaderMaterial 需手动重建 define 🔴 已修复 |
| 高程着色 | 支持 ✅ | N/A |
| 水下跳过 | N/A | 支持 ✅ |
| 互斥协调 | 与水面互斥（关地开水）✅ | 与地面互斥（关水开地）✅ |
