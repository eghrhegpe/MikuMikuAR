# ADR-114: 地面反射增强 — 从平面近似到 PBR 材质

## 状态

**状态**: 部分实现（Phase 1 ✅ 2026-07-16 — PBR 材质 + 程序化木纹 + UI 面板 + i18n + Go/TS 状态同步；Phase 2 ✅ 2026-07-16 — 反射模糊(mipmap+roughness) + 法线扭曲(bumpTexture) + 低质量守卫；Phase 3 待启动）

**开始日期**: 2026-07-15

**关联**: `docs/research/ue5-ground-reflection-analysis.md`、ADR-092（PlanarReflection 统一引擎）、`frontend/src/scene/env/env-impl.ts`（地面系统）、`frontend/src/scene/env/env-texture.ts`（统一贴图工厂）、`frontend/src/scene/env/planar-reflection.ts`（平面反射引擎）、`frontend/src/menus/env-feature-levels.ts`（环境菜单面板）、`frontend/src/core/types.ts`（EnvState 定义）

---

## 背景与问题

当前项目地面系统（`env-impl.ts` + `planar-reflection.ts`）已实现基础平面反射，但与 UE5 Lumen 风格截图对比，差距集中在：

| 差距 | 现状 | 视觉后果 |
|------|------|----------|
| **反射模糊** | MirrorTexture/screenSpace 锐利反射 | 地面像镜子，缺少湿润/粗糙质感 |
| **材质单一** | StandardMaterial + canvas 程序化纹理 | 无木纹细节、无凹凸感、无粗糙度变化 |
| **接触阴影** | 仅方向光阴影 | 角色脚底无接触阴影，悬浮感 |
| **间接光照** | hemiLight 全局照明 | 地面颜色不反弹到角色底部 |

---

## 目标

在 **不引入新依赖、不重写 PlanarReflection 架构** 的前提下，分阶段增强地面视觉质量：

1. **Phase 1**：PBR 材质 + 程序化木纹（材质增强）
2. **Phase 2**：反射模糊 + 法线扭曲（采样端增强）
3. **Phase 3**：接触阴影后处理（可选，长期）

---

## 状态变更（新增/修改字段）

以下字段加入 `EnvState`（`frontend/src/core/types.ts`），并同步到 Go 端 `EnvState` 结构体与 `models.ts` 生成类型：

| 字段 | 类型 | 默认值 | 说明 | Phase |
|------|------|--------|------|-------|
| `groundPbrEnabled` | `boolean` | `false` | PBR 材质开关（false 时回退 StandardMaterial） | 1 |
| `groundProceduralTexture` | `'none' \| 'wood' \| 'marble' \| 'concrete'` | `'none'` | 程序化纹理类型；与外部贴图二选一（外部贴图优先） | 1 |
| `groundProceduralSeed` | `number` | `42` | 程序化纹理随机种子 | 1 |
| `groundProceduralScale` | `number` | `1.0` | 程序化纹理平铺缩放 | 1 |
| `groundRoughness` | `number` | `0.6` | 基础粗糙度（PBR 生效时） | 1 |
| `groundMetallic` | `number` | `0.0` | 金属度（PBR 生效时） | 1 |
| `groundNormalStrength` | `number` | `1.0` | 法线贴图强度（已有字段，PBR 下复用） | 1（复用） |
| `groundReflectionBlur` | `number` | `0.0` | 反射模糊强度 0–1（Phase 2 采样端高斯 kernel 大小） | 2 |
| `groundReflectionDistort` | `number` | `0.3` | 法线扭曲强度 0–1（用 bumpTexture 扰动反射方向） | 2 |

**与现有字段的关系**：
- `groundStyle: 'texture'` + `groundTextureEnabled: true` + 外部贴图 → 外部贴图作为 albedo，PBR 开关独立控制是否用 PBR 渲染
- `groundProceduralTexture !== 'none'` 且无外部贴图 → 程序化纹理作为 albedo
- `groundStyle: 'solid' / 'grid' / 'checker'` → 纯色/图案模式，PBR 下用 `groundColor` 作为 albedo 色，无纹理

---

## 决策

**采用混合方案：PBR 材质 + PlanarReflection 采样端增强，分阶段落地。**

### Phase 1 — PBR 材质 + 程序化木纹（🟢 低风险，立竿见影）

将地面从 `StandardMaterial` 升级为 `PBRMaterial`，支持粗糙度/法线/金属度贴图。PBR 开关可随时切回 StandardMaterial 回退。

#### 1.1 材质切换逻辑

```typescript
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';

// 在 applyGround() 创建材质时
function createGroundMaterial(state: EnvState, scene: Scene): PBRMaterial | StandardMaterial {
    if (!state.groundPbrEnabled) {
        return new StandardMaterial('envGroundMat', scene);
    }
    const mat = new PBRMaterial('envGroundPBR', scene);
    mat.metallic = state.groundMetallic;
    mat.roughness = state.groundRoughness;
    // 复用天空环境光立方体贴图（无天空盒时回退 null，PBR 用漫反射近似）
    if (scene.environmentTexture) {
        mat.environmentTexture = scene.environmentTexture;
    }
    // 禁用 specular anti-aliasing 等高级特性保性能
    mat.useSpecularOverAlpha = false;
    mat.useRadianceOverAlpha = false;
    return mat;
}
```

#### 1.2 程序化纹理生成（经统一贴图工厂）

木纹/粗糙度/法线三张贴图全部通过 `createCanvasTexture`（`env-texture.ts`）创建，走 DynamicTexture 优先路径，与地形高度图、边缘淡出贴图共用创建/缓存/释放体系。

```typescript
// env-ground-procedural.ts（新文件，或放 env-impl.ts 内）
import { createCanvasTexture } from './env-texture';
import { fbm, hash2 } from './env-terrain';
import type { Texture, Scene } from '@babylonjs/core';

const PROCEDURAL_SIZE = 512; // 256 太低频细节不足，512 是性能/质量平衡点

interface ProceduralTextures {
    albedo: Texture;
    roughness: Texture;
    normal: Texture;
}

function generateWoodAlbedo(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    const img = ctx.createImageData(size, size);
    const data = img.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // 木纹年轮：低频 FBM 沿 Y 轴拉伸 + 高频噪点扰动
            const nLow = fbm(x * 0.02, y * 0.005, seed, 4, 1.0);     // ~[-1, 1]
            const nHigh = fbm(x * 0.2, y * 0.2, seed + 100, 2, 1.0); // 高频细纹理
            const n = (nLow + nHigh * 0.2 + 1) * 0.5;                // 归一化到 ~[0, 1]

            // 深浅棕色交替（亮=浅棕，暗=深棕）
            const r = Math.round(139 + n * 40 - 10);  // 129–169
            const g = Math.round(69 + n * 25 - 5);    //  64– 89
            const b = Math.round(19 + n * 12 - 2);    //  17– 29

            const i = (y * size + x) * 4;
            data[i] = Math.max(0, Math.min(255, r));
            data[i + 1] = Math.max(0, Math.min(255, g));
            data[i + 2] = Math.max(0, Math.min(255, b));
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

function generateWoodRoughness(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    const img = ctx.createImageData(size, size);
    const data = img.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // 低频 FBM 控制粗糙度变化（年轮凹槽处更粗糙）
            const n = (fbm(x * 0.015, y * 0.004, seed, 3, 1.0) + 1) * 0.5; // [0,1]
            // 基础 roughness 0.4，变化范围 ±0.2 → [0.2, 0.6]
            const roughness = 0.4 + n * 0.2;
            const v = Math.round(roughness * 255);

            const i = (y * size + x) * 4;
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

function generateWoodNormal(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    const img = ctx.createImageData(size, size);
    const data = img.data;
    const eps = 1.0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // 用高度图梯度求法线（高度 = albedo 亮度 FBM）
            const c = fbm(x * 0.02, y * 0.005, seed, 4, 1.0);
            const cx = fbm((x + eps) * 0.02, y * 0.005, seed, 4, 1.0);
            const cy = fbm(x * 0.02, (y + eps) * 0.005, seed, 4, 1.0);

            const dx = (cx - c) * 20.0; // 加强凹凸感
            const dy = (cy - c) * 20.0;
            const nz = 1.0;
            const len = Math.sqrt(dx * dx + dy * dy + nz * nz);

            const i = (y * size + x) * 4;
            // DirectX 法线格式（RGB = XYZ，+0.5 偏置）
            data[i] = Math.round((dx / len * 0.5 + 0.5) * 255);
            data[i + 1] = Math.round((dy / len * 0.5 + 0.5) * 255);
            data[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

export function generateProceduralGroundTextures(
    type: string,
    seed: number,
    scene: Scene
): ProceduralTextures {
    const genAlbedo = (ctx: CanvasRenderingContext2D, size: number) =>
        generateWoodAlbedo(ctx, size, seed);
    const genRoughness = (ctx: CanvasRenderingContext2D, size: number) =>
        generateWoodRoughness(ctx, size, seed);
    const genNormal = (ctx: CanvasRenderingContext2D, size: number) =>
        generateWoodNormal(ctx, size, seed);

    const albedo = createCanvasTexture({
        size: PROCEDURAL_SIZE,
        draw: genAlbedo,
        scene,
        name: `groundProcedural_${type}_albedo`,
        wrap: 'wrap',
        generateMipMaps: true,
    });
    const roughness = createCanvasTexture({
        size: PROCEDURAL_SIZE,
        draw: genRoughness,
        scene,
        name: `groundProcedural_${type}_roughness`,
        wrap: 'wrap',
        generateMipMaps: true,
    });
    const normal = createCanvasTexture({
        size: PROCEDURAL_SIZE,
        draw: genNormal,
        scene,
        name: `groundProcedural_${type}_normal`,
        wrap: 'wrap',
        generateMipMaps: true,
    });
    return { albedo, roughness, normal };
}
```

#### 1.3 材质辅助函数类型适配

现有 4 个辅助函数参数类型写死 `StandardMaterial`，需放宽：

| 函数 | 位置 | 适配方案 |
|------|------|----------|
| `applyGroundEdgeFade` | `env-ground.ts:348` | 参数改为 `PBRMaterial \| StandardMaterial`；两者都有 `opacityTexture`，直接赋值 |
| `_updateGroundTexture` | `env-ground.ts:368` | PBR 下更新 `albedoTexture`（而非 `diffuseTexture`）；用类型守卫分支 |
| `_syncGroundNormalTexture` | `env-ground.ts:379` | 两者都有 `bumpTexture`，PBR 下额外设置 `bumpTexture.level = groundNormalStrength`，行为一致 |
| `_syncGroundTextureOffset` | `env-ground.ts:352` | 两者都有 `diffuseTexture?` / `albedoTexture?`；改为先取「当前 albedo 纹理」辅助函数 |

**统一材质适配层**（新增内部工具函数，集中处理差异）：

```typescript
function _getAlbedoTex(mat: PBRMaterial | StandardMaterial): Texture | null {
    if (mat instanceof PBRMaterial) return mat.albedoTexture as Texture | null;
    return mat.diffuseTexture as Texture | null;
}
function _setAlbedoTex(mat: PBRMaterial | StandardMaterial, tex: Texture | null): void {
    if (mat instanceof PBRMaterial) { mat.albedoTexture = tex; return; }
    mat.diffuseTexture = tex;
}
function _getAlbedoColor(mat: PBRMaterial | StandardMaterial): Color3 {
    if (mat instanceof PBRMaterial) return mat.albedoColor;
    return mat.diffuseColor;
}
function _setAlbedoColor(mat: PBRMaterial | StandardMaterial, color: Color3): void {
    if (mat instanceof PBRMaterial) { mat.albedoColor = color; return; }
    mat.diffuseColor = color;
}
```

所有辅助函数通过适配层读写 albedo，不再直接访问 `diffuseTexture` / `albedoTexture`。

#### 1.4 地形模式的 PBR 覆盖范围

`groundType === 'terrain'` 时，地形材质同样走 PBR 升级路径：
- `applyTerrainMaterial`（`env-ground.ts` 内部函数）创建材质时调用 `createGroundMaterial`
- 地形高度图的纹理（`material.diffuseTexture`）在 PBR 下改为 `albedoTexture`
- 地形的「草地/泥土」未来可通过多层纹理混合扩展（Phase 后续）

**当前 Phase 1 范围**：地形仅升级材质类型（StandardMaterial → PBRMaterial），程序化木纹等只在 flat 模式可用。

#### 1.5 Phase 1 约束

- 保留 `StandardMaterial` 作为回退（`groundPbrEnabled === false`）
- 程序化纹理通过 `createCanvasTexture` 工厂生成（零外部资源依赖、统一释放）
- 三张贴图尺寸统一 512²（生成耗时 < 10ms，内存占用 3 × 512² × 4B ≈ 3MB）
- mipmap 开启（远距离不闪烁）
- `environmentTexture` 无天空盒时置 null，PBR 自动回退漫反射近似

---

### Phase 2 — 反射模糊 + 法线扭曲（🟡 中等成本）

**技术路线：采样端增强（在地面材质 shader 里做），不修改 PlanarReflection 引擎，不引入 BlurPostProcess。**

原因：
- `BlurPostProcess` 是屏幕空间后处理，不能作用于单个 RenderTargetTexture
- RT ping-pong 模糊需要额外 RT + 后处理链，复杂度高
- 采样端模糊可与法线扭曲合并在同一次采样里，性能最优
- 模糊 kernel 可随 roughness 变化（PBR 物理正确做法）

#### 2.1 实现方案：PBRMaterial + 自定义反射采样

利用 Babylon PBRMaterial 的 `onBindObservable` 注入自定义 uniform，配合 `customShaderName` / 钩子扩展反射采样逻辑。

**备选方案 A（推荐）：自定义 PBR 材质扩展**

```typescript
// 用 PBRMaterial 的 albedo/roughness/normal 标准管线，但覆写 reflection 采样
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';

function setupGroundPBRReflection(mat: PBRMaterial, scene: Scene): void {
    // 法线扭曲强度 uniform
    mat.onBindObservable.add(() => {
        const effect = mat.getEffect();
        if (!effect) return;
        effect.setFloat('groundReflectBlur', envState.groundReflectionBlur);
        effect.setFloat('groundReflectDistort', envState.groundReflectionDistort);
    });

    // 注入自定义 shader 片段（在反射采样前扰动 UV / 做多次采样模糊）
    // Babylon PBR 支持 CustomMaterial 或 ShaderMaterial 继承
    // 此处用更轻量的方案：反射纹理采样阶段做 PCF 风格多采样
}
```

**备选方案 B（更简单，但精度略低）：直接用 roughness 驱动 Mipmap**

`MirrorTexture` 开启 mipmap 后，PBR 材质的 `reflectivityTexture` / `roughness` 会自动采样不同 mip 层级实现模糊。这是最简方案：

```typescript
// 开启反射纹理 mipmap（在 PlanarReflection 引擎创建 MirrorTexture 时）
const mirrorRT = new MirrorTexture(name, { width: res, height: res }, scene, true); // 第3个参数 generateMipMaps
mirrorRT.updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);

// PBR 材质中 roughness 直接控制反射模糊程度（物理正确）
mat.roughness = state.groundRoughness;
mat.reflectivityTexture = woodRoughness; // 用粗糙度贴图驱动反射强度+模糊
```

**推荐采用方案 B（mipmap 模糊）+ 法线扭曲（方案 A 轻量注入）**，两者结合：
- 模糊：用 mipmap 自动随 roughness 变化（零额外采样成本）
- 法线扭曲：用 bumpTexture 在反射方向上做偏移（注入 shader 片段）

#### 2.2 法线扭曲实现

法线扭曲通过修改 PBR 材质的反射向量实现。在 PBR 材质中，`bumpTexture` 已经会影响法线，从而影响反射方向。只需要调大 `bumpTexture.level` 的「反射贡献」即可：

```typescript
// PBRMaterial 已有 microSurface 用法，bumpTexture 同时影响光照和反射
// 额外增强：用 reflectionTexture.level 配合 distort 强度
mat.bumpTexture = normalTex;
mat.bumpTexture.level = state.groundNormalStrength;
// 法线扭曲强度通过单独的 uniform 控制（若需独立于光照法线）
```

**独立法线扭曲的实现**（如果需要反射扭曲与光照法线强度分离）：

通过 `CustomMaterial` 或直接扩展 shader，在反射采样阶段：
1. 采样 bumpTexture 获取扰动向量
2. 用 `groundReflectionDistort` 缩放扰动
3. 偏移反射方向后再采样 reflectionTexture

#### 2.3 Phase 2 约束

- 不改动 PlanarReflection 引擎（反射计算仍由引擎负责，仅采样端增强）
- 模糊由 mipmap + roughness 驱动，零额外绘制成本
- 法线扭曲通过 bumpTexture 复用，不新增贴图
- 低质量模式（low/off）时 `groundReflectionBlur = 0`、`groundReflectionDistort = 0`，退化为锐利反射
- 性能预算：<1% FPS 影响（仅 mipmap 采样开销，可忽略）

---

### Phase 3 — 接触阴影（🟠 可选，长期）

编写自定义后处理实现 **屏幕空间接触阴影（Screen Space Contact Shadows）**，增强角色脚底与地面接触区域的阴影深度。

#### 3.1 算法原理

从每个像素出发，沿**光线方向**（方向光的反向）在屏幕空间做有限步长的 ray marching，检查深度缓冲中是否有遮挡物。与方向光阴影配合，填补阴影贴图分辨率不足导致的「悬浮感」。

```glsl
// 接触阴影后处理片段着色器（伪代码）
uniform sampler2D depthTexture;
uniform vec2 resolution;
uniform vec3 lightDirVS;       // 视图空间光线方向（方向光反向）
uniform float shadowDistance;  // 光线步进最大距离（视图空间）
uniform int stepCount;         // 步进次数（如 16）

float contactShadow(vec2 uv, float depth) {
    // 重建视图空间位置
    vec3 viewPos = getViewPosFromDepth(uv, depth);
    
    // 光线步进方向与步长
    vec3 rayStep = lightDirVS * (shadowDistance / float(stepCount));
    vec3 rayPos = viewPos;
    float shadow = 0.0;
    
    for (int i = 0; i < 16; i++) {
        rayPos += rayStep;
        // 投影回屏幕空间
        vec4 projPos = projectionMatrix * vec4(rayPos, 1.0);
        vec2 screenUV = (projPos.xy / projPos.w) * 0.5 + 0.5;
        
        if (screenUV.x < 0.0 || screenUV.x > 1.0 || 
            screenUV.y < 0.0 || screenUV.y > 1.0) break;
        
        float sampleDepth = texture(depthTexture, screenUV).r;
        float rayDepth = getLinearDepth(rayPos);
        
        // 如果采样深度比光线深度小（更靠近相机），说明被遮挡
        if (sampleDepth < rayDepth && (rayDepth - sampleDepth) < shadowDistance) {
            shadow += 1.0 / float(stepCount);
        }
    }
    return 1.0 - shadow;
}

void main() {
    float depth = texture(depthTexture, uv).r;
    float shadow = contactShadow(uv, depth);
    gl_FragColor = vec4(shadow, shadow, shadow, 1.0);
}
```

#### 3.2 集成方式

- 后处理通过 `PostProcess` 挂到 `DefaultRenderingPipeline` 末尾（`renderer.ts` 的 `pipeline`）
- 与现有 SSR/SSAO 后处理共享深度缓冲
- 仅在 `groundContactShadowEnabled` 且质量 ≥ medium 时启用
- 输出与方向光阴影相乘

#### 3.3 Phase 3 约束

- 仅在高/中质量模式启用
- 性能预算：<3% FPS 影响（16 步 ray marching + 深度采样）
- 若与 SSR/SSAO 后处理冲突，共享深度缓冲降低开销
- 降级方案：关闭后直接用方向光阴影（当前现状）

---

## 资源管理与释放

### 创建/释放配对表

| 资源 | 创建时机 | 释放时机 | 归属 |
|------|----------|----------|------|
| PBR/Standard 材质 | `applyGround()` 创建路径 | `applyGround()` 重建路径 `oldMat.dispose()` + `disposeEnv()` | `_envSys.ground.mesh.material` |
| 程序化 albedo 贴图 | `generateProceduralGroundTextures()` | 重建时 `albedo.dispose()` + dispose 级联 | PBR/Standard material 持有 |
| 程序化 roughness 贴图 | 同上 | 同上 | PBR material 持有 |
| 程序化 normal 贴图 | 同上 | 同上 | PBR/Standard material 持有 |
| 反射纹理（MirrorTexture） | PlanarReflection 引擎 | PlanarReflection.dispose() | 引擎统一管理 |
| 接触阴影后处理 | Phase 3 启用时 | 关闭时 + disposeRenderer | `pipeline` 持有 |

### typeKey 重建指纹更新

`applyGround()` 的 `typeKey`（重建指纹）加入以下字段，变更时触发完整重建：

```typescript
const typeKey =
    state.groundType === 'terrain'
        ? `heightmap:${state.groundTerrainHeight}:...:pbr:${state.groundPbrEnabled}`
        : state.groundTextureEnabled && state.groundTexture
          ? `texture:${state.groundTexture}:...:pbr:${state.groundPbrEnabled}:rough:${state.groundRoughness}:metallic:${state.groundMetallic}`
          : state.groundProceduralTexture !== 'none'
            ? `procedural:${state.groundProceduralTexture}:${state.groundProceduralSeed}:${state.groundProceduralScale}:pbr:true`
            : `canvas:${state.groundStyle}:...:pbr:${state.groundPbrEnabled}:rough:${state.groundRoughness}:metallic:${state.groundMetallic}`;
```

**原地增量更新**（typeKey 不变时）的字段：
- `groundAlpha` → `mat.alpha`
- `groundLevel` / `groundPitch` / `groundRoll` → mesh 变换
- `groundEdgeFade` → opacityTexture
- `groundTextureScale` / `groundTextureRotation` → uScale/vOffset
- `groundRoughness` → `mat.roughness`（PBR 时）
- `groundMetallic` → `mat.metallic`（PBR 时）
- `groundNormalStrength` → `bumpTexture.level`
- 反射 blend/quality → `buildGroundReflection()`（引擎处理）

---

## UI 对接

### 面板层级

在 [env-feature-levels.ts:250 `buildGroundLevel()`](file:///C:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/env-feature-levels.ts#L250) 内新增/调整以下 folder：

| Folder | 位置 | 内容 |
|--------|------|------|
| 基础设置（已有） | 现有 | 颜色、透明度、高度、尺寸、边缘淡出 |
| **材质模式**（新增） | 基础设置后 | PBR 开关 + 金属度/粗糙度滑块（PBR 开启时显示） |
| 程序化纹理（新增） | 材质模式后 | 类型下拉（none/wood/marble/concrete） + 种子 + 缩放 |
| 贴图（已有） | 现有 | 外部贴图预设 + 自定义 + 缩放/旋转 |
| 法线（新增，或并入贴图） | — | 法线强度滑块（已有 `groundNormalStrength`，复用） |
| 反射（新增） | — | 反射模糊 + 法线扭曲（Phase 2） |
| 装饰（已有） | 现有 | grid/checker 叠加 |
| 接触阴影（新增） | 底部 | 开关 + 强度 + 距离（Phase 3） |

### 新增翻译 key

```typescript
// zh-CN / en / ja 等 locale 文件同步新增
'env.pbr': 'PBR 材质',                  // PBR Material
'env.pbrEnabled': '启用 PBR',           // Enable PBR
'env.metallic': '金属度',               // Metallic
'env.roughness': '粗糙度',              // Roughness
'env.procedural': '程序化纹理',          // Procedural Texture
'env.proceduralType': '纹理类型',        // Texture Type
'env.proceduralSeed': '随机种子',        // Seed
'env.proceduralScale': '纹理缩放',       // Scale
'env.wood': '木纹',                     // Wood
'env.marble': '大理石',                 // Marble
'env.concrete': '混凝土',               // Concrete
'env.reflectionBlur': '反射模糊',        // Reflection Blur
'env.reflectionDistort': '法线扭曲',     // Normal Distortion
'env.contactShadow': '接触阴影',         // Contact Shadow
'env.contactShadowIntensity': '阴影强度', // Shadow Intensity
```

### 交互约束

- PBR 关闭时，金属度/粗糙度/程序化纹理等滑块折叠隐藏
- 外部贴图与程序化纹理二选一：选择外部贴图时自动禁用程序化，反之亦然
- 低质量预设自动把 `groundReflectionBlur` / `groundReflectionDistort` 置 0
- 法线强度同时影响光照法线和反射扭曲（Phase 2 如需分离再加独立滑块）

---

## 序列化与场景持久化

### 新增字段持久化

所有新增 EnvState 字段自动随场景序列化（已有的 `scene:save` / `scene:load` 机制序列化完整 envState）。

### 向前兼容

- 旧场景文件不含 `groundPbrEnabled` → 加载时默认 `false`（StandardMaterial 回退，视觉一致）
- 旧场景不含 `groundProceduralTexture` → 默认 `'none'`
- 旧场景不含 `groundRoughness` / `groundMetallic` → 使用默认值 0.6 / 0.0

### 场景格式版本

无需递增场景格式版本（缺失字段有合理默认值，不破坏旧场景）。

---

## 替代方案

| 方案 | 否决理由 |
|------|----------|
| **SSR 后处理（路径 B）** | Babylon 9.14.0 有 SSRRenderingPipeline（见 `renderer.ts`），但全局 SSR 开销大，且地面反射已经有 PlanarReflection 精确解，SSR 主要补非平面物体，非地面刚需 |
| **RT ping-pong 模糊** | 需额外 2 个 RT + 两次后处理，性能开销 > mipmap 方案，且与法线扭曲不能合并 |
| **Lumen 近似（路径 D 长期）** | 需导出深度+法线缓冲，与现有后处理链集成复杂度高 |
| **光线追踪** | Babylon.js 无硬件 RT 支持；WebGPU RT 仍在实验阶段 |
| **第三方 GI 库** | 依赖 Three.js，不兼容 Babylon |

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| PBR 材质性能开销 | 🟡 | 仅地面使用，角色/道具仍用 StandardMaterial；低端设备默认关闭 PBR |
| 程序化木纹视觉质量不足 | 🟠 | 保留外部贴图加载路径（`groundTexture`）；canvas 生成作为零依赖回退 |
| 法线贴图 UV 不匹配 | 🟢 | 统一 `uScale/vScale` 与 albedo 纹理一致（同一 `groundProceduralScale` 驱动） |
| mipmap 模糊与 PBR roughness 不匹配 | 🟡 | roughness → mip LOD 换算公式在 shader 中验证；不对时改用手动多采样 |
| 接触阴影与方向光阴影重叠过暗 | 🟡 | 接触阴影强度可调，默认 0.5；使用相乘混合而非叠加 |
| 深度缓冲精度不足导致接触阴影伪影 | 🟡 | 步进距离限制在小范围（0.5–1m），仅影响近地面区域；与方向光阴影互补 |
| 材质辅助函数类型适配遗漏 | 🟡 | 用 `_getAlbedoTex` 等适配层集中处理差异，避免散点 instanceof 判断 |
| **程序化纹理生成阻塞主线程** | 🟢 | 512² × 3 张贴图生成 < 15ms（CPU canvas 2D），可接受；如未来增大到 1024²，考虑拆帧或 Worker |

---

## 落地检查清单

### Phase 1
- [ ] 新增 `groundPbrEnabled` / `groundProceduralTexture` / `groundProceduralSeed` / `groundProceduralScale` / `groundRoughness` / `groundMetallic` 到 `EnvState`（Go + TS + models.ts 同步）
- [ ] 实现 `createGroundMaterial()` 工厂（StandardMaterial / PBRMaterial 切换）
- [ ] 实现 `generateProceduralGroundTextures()`，走 `createCanvasTexture` 工厂
- [ ] 材质适配层：`_getAlbedoTex` / `_setAlbedoTex` / `_getAlbedoColor` / `_setAlbedoColor`
- [ ] 4 个辅助函数（`applyGroundEdgeFade` / `_updateGroundTexture` / `_syncGroundNormalTexture` / `_syncGroundTextureOffset`）适配 PBR
- [ ] `applyGround()` 的 typeKey 加入 PBR / 程序化相关字段
- [ ] 地形模式（`groundType === 'terrain'`）材质走 PBR 升级路径
- [ ] dispose 路径：三张贴图 + 材质正确释放，无泄漏
- [ ] UI 面板：PBR 开关、金属度/粗糙度、程序化纹理类型/种子/缩放
- [ ] i18n：所有新增文本 key 同步到 zh-CN / en / ja / zh-TW / ko
- [ ] 低端设备降级：`groundPbrEnabled` 默认 false，或 feature-level 自动关闭

### Phase 2
- [x] 反射纹理开启 mipmap + 三线性采样（PlanarReflection 引擎端配置）
- [x] PBR 材质 roughness 驱动反射模糊程度（验证 mip LOD 正确性）
- [x] 法线扭曲：bumpTexture 影响反射方向（PBR 原生支持，验证强度）
- [x] UI 滑块：反射模糊 / 法线扭曲
- [x] 低质量模式自动关闭模糊与扭曲
- [ ] 性能验证：FPS 影响 < 1%（待人工验证）

### Phase 3（可选）
- [ ] 接触阴影后处理 shader 实现
- [ ] 集成到 DefaultRenderingPipeline
- [ ] 与方向光阴影混合验证
- [ ] UI 开关 + 强度 + 距离滑块
- [ ] 性能验证：FPS 影响 < 3%

### 全程
- [ ] `npm run check` 通过
- [ ] `frontend/e2e/env-sky.spec.ts` 绿
- [ ] `npm run test` 全量 env 套件通过
- [ ] 人工验证：PBR 开关切换无闪烁、程序化纹理正确、反射模糊可见

---

## 后续（可选增强）

若 Phase 1-2 效果满意，未来可考虑：

| 增强 | 说明 |
|------|------|
| **多层纹理混合** | 地面不同区域混合草地/泥土/石板（基于 heightmap 或 mask texture） |
| **更多程序化纹理** | 大理石、混凝土、地砖、雪地等（扩展 `groundProceduralTexture` 枚举） |
| **SSR 后处理** | 全局屏幕空间反射，补非平面物体的反射缺失 |
| **动态湿润效果** | 雨天时地面 roughness 降低，反射增强 |
| **Puddle 系统** | 低洼区域积水，局部启用 PlanarReflection |
| **地形 PBR 材质混合** | 高度驱动草地/泥土/岩石混合（splat mapping） |
