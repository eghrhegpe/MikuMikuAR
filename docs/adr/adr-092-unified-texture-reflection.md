# ADR-092: 贴图与反射统一 —— 单一纹理工厂 + 单一平面反射引擎

> **状态**: 已完成

## 1. 背景

ADR-091 将地面 3 条渲染路径合并为 `canvas → StandardMaterial.diffuseTexture` 单一路径，解决了地面**纹理**的混乱。但环境子系统在更广层面仍有两处分叉，正是 `env-impl.ts` 当前 345 行未提交改动的「混乱期」根源：

### 1.1 贴图创建散点（11 处，无统一工厂）

| # | 位置 | 路径 |
|---|------|------|
| 1 | env-impl:442 | 天空兜底 1×1 `toDataURL→Texture` |
| 2 | env-impl:517 | `_generateGroundTexture` 512 canvas |
| 3 | env-impl:614 | `getGroundEdgeFadeTexture` 256 canvas（按 fade 缓存）|
| 4 | env-particles:65 | 粒子 canvas |
| 5 | env-water:245 | 焦散 canvas |
| 6 | env-terrain:75→142 | 高度图 canvas |
| 7–10 | impl:679/960, terrain:142/152 | 外部贴图 `resolveStaticAsset` |
| 11 | env-impl:231 | 天空 `DynamicTexture`（已最优）|

#1–6 均为 `document.createElement('canvas') → getContext('2d') → draw → toDataURL → new Texture`，**无统一工厂、无统一释放登记**，重复模式 + 泄漏风险 + 调试黑洞。天空已用 `DynamicTexture`（避开 PNG 编码，ADR-091 §6 本就建议地面也走这条）。

### 1.2 反射引擎两套互斥机制，双双失效

| 维度 | 水面反射 (env-water) | 地面反射 (env-impl) |
|------|---------------------|---------------------|
| 投影机制 | `RenderTargetTexture` + 手写 `_mirrorCam`（`_worldMatrix`/`_isWorldMatrixFrozen` 黑魔法）| `MirrorTexture`（靠 `mirrorPlane` 推导）|
| 采样方式 | ShaderMaterial 屏空 UV（自写，正确）| `StandardMaterial.reflectionTexture`（引擎接管）|
| 渲染驱动 | `customRenderTargets` + 手动 `.render()` | `customRenderTargets` + 手动 `.render()` |
| 互斥 | — | `buildGroundReflection` **无条件** `disableWaterReflection()` |

**根因（静态分析 + 运行时审计佐证）：**
- 🔴 地面 `MirrorTexture.mirrorPlane` 符号/朝向**未经运行时验证**；且挂在 `mat.reflectionTexture` 后引擎自动渲染，代码又手动 `.render()` + push `customRenderTargets` → **双重驱动**，稳态反射错乱/错位。
- 🔴 水面**互斥单向**：地面启用反射时销毁水 RT 并 `planarReflectBlend=0`，但**关闭地面反射时不恢复水面**（审计 D 项已标注）→ 用户开过地面反射后水面永久死。
- 🟠 水面 `_mirrorCam` `_worldMatrix` 黑魔法脆弱：主相机切换/FOV 变化时不更新。

## 2. 决策

照搬 ADR-091 的「单一路径」哲学，做两层统一：

### 2.1 统一贴图工厂 `createCanvasTexture`（env-texture.ts）

- 单一入口：`createCanvasTexture({ size, draw, scene, name?, wrap?, getAlphaFromRGB?, generateMipMaps? })`。
- **优先 `DynamicTexture`**（无 PNG 编码开销，复用天空已验证路径）；构造或 `getContext()` 失败时回退 `toDataURL→Texture`，保证 NullEngine 测试环境不崩。
- 缓存封装 `getOrCreateCanvasTexture(key, opts)`：按 key 缓存，`key` 变化时 dispose 旧贴图，消除散点泄漏。
- 释放登记 `disposeTextureCache()`：供 `disposeEnv` 统一清理。
- #1–6 全部改走工厂（地形高度图保留 `toDataURL` 因异步 onReady 特殊性，但经工厂回退路径）。

### 2.2 统一平面反射引擎 `PlanarReflection`（planar-reflection.ts）

参数化单一类，两种模式复用同一套基础设施：

```ts
interface PlanarReflectionConfig {
  name: string;
  mode: 'mirrorTexture' | 'screenSpace';   // 地面 / 水面
  getQuality(s): string;                    // 'off'|'low'|'medium'|'high'
  getBlend(s): number;                      // 反射强度
  getSurfaceLevel(s): number;               // 反射面高度
  getMirrorPlane(s, scene): Plane;          // mirrorTexture 模式
  getMirrorCameraMatrix?(s, scene): Matrix;// screenSpace 模式
  predicate(mesh, level): boolean;          // renderList 过滤
  getMaterial(): Material | null;           // 挂载目标
  mount(rt: BaseTexture): void;             // 挂到材质
  setBlend(blend: number): void;            // 强度写入材质
  skipWhenUnderwater?: boolean;             // 水面专用
}
```

- **集中实现**（两种模式共用）：RT 创建、BFC 存取（`onBefore/AfterRenderObservable`）、renderList 脏标记（mesh 数 + 面高度变化）、帧跳过（`frameSkipMap`）、`try/catch` 渲染、dispose（移出 `customRenderTargets` + 清材质引用 + 清 BFC map）。
- **模式差异**：
  - `mirrorTexture`（地面）：`MirrorTexture`，**不手动 `.render()`、不 push `customRenderTargets`**（消除双重驱动），由 Babylon 随材质自动渲染；每帧仅更新 `mirrorPlane`（跟随倾斜/pitch/roll）。
  - `screenSpace`（水面）：`RenderTargetTexture` + 镜像相机（保留既有 `_worldMatrix` 镜像矩阵逻辑，移入引擎），手动 `.render()` + `customRenderTargets`，cam 水下跳过。
- **可恢复互斥**（修复「双双失效」）：模块级 `_activeEngine` 协调器 + 每面注册 `onExclusionReleased` 回调。启用某面时 `requestExclusive` 关闭另一面；某面关闭时 `releaseExclusive` 触发另一面按各自 `envState` 重建 → 关地即开水、关水即开地，不再单向死锁。

### 2.3 弃用项

- `env-impl.ts`：`_createGroundMirrorRT` / `_computeGroundMirrorPlane` / `_populateGroundMirrorRenderList` / `buildGroundReflection` / `disposeGroundReflection` 中的手写 RT/BFC/帧跳过逻辑 → 移入 `PlanarReflection` 引擎。
- `env-water.ts`：`_setupMirrorRT` / `_updateMirrorCamera` / `_createMirrorCam` / `_populateMirrorRenderList` / 模块级 `_mirrorRT`/`_mirrorCam`/`_mirrorOrigBFC`/`_mirrorRenderListDirty` → 移入引擎。
- `env-impl.ts` / `env-particles.ts` / `env-water.ts` 中 `canvas→toDataURL→new Texture` 散点 → `createCanvasTexture` 工厂。

## 3. 优点

1. **单一贴图路径**：沿用 ADR-091 思路，canvas 生成的散点（地面纹理/边缘淡出/粒子/焦散/地形高度图）收敛为 1 工厂（或 data-URL 辅助工厂），泄漏与重复归零；外部贴图 URL 加载（resolveStaticAsset）保留原路径（属 URL 输入，非 canvas 生成，不在统一范围）。
2. **单一反射引擎**：两套机制共用 BFC/脏标记/帧跳过/dispose/互斥，消除 4 处重复 boilerplate。
3. **根除双重驱动**：地面 `MirrorTexture` 改由引擎自动渲染，稳态反射正确。
4. **互斥可恢复**：关地即开水、关水即开地，根治「双双失效」体验。
5. **运行时健壮**：所有 `rt.render()` 包 `try/catch`；工厂 `DynamicTexture` 失败回退，NullEngine 不崩。
6. **易测**：引擎与表面配置解耦，单测可分别验证 `mirrorTexture` / `screenSpace` 行为。

## 4. 测试验证（实施后）

- `npx tsc --noEmit` 通过。
- `npm run test` 全量 env 套件通过（env-bridge 72 + env-state 16 + env-water 26 + integration）。
- 运行时（Wails/WebView2）需人工确认：地面反射随倾斜对齐、水面反射随相机正确、互斥切换可恢复、无双重渲染开销。
