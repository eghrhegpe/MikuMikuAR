# ADR-114: 地面反射增强 — 从平面近似到 PBR 材质

## 状态

**状态**: 规划

**开始日期**: 2026-07-15

**关联**: `docs/research/ue5-ground-reflection-analysis.md`、ADR-092（PlanarReflection 统一引擎）、`frontend/src/scene/env/env-impl.ts`（地面系统）、`frontend/src/scene/env/env-texture.ts`（统一贴图工厂）

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
2. **Phase 2**：反射模糊 + 法线扭曲（反射增强）
3. **Phase 3**：接触阴影后处理（可选，长期）

---

## 决策

**采用混合方案：PBR 材质 + PlanarReflection 增强，分阶段落地。**

### Phase 1 — PBR 材质 + 程序化木纹（🟢 低风险，立竿见影）

将地面从 `StandardMaterial` 升级为 `PBRMaterial`，支持粗糙度/法线贴图：

```typescript
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';

// 在 applyGround() 中
const mat = new PBRMaterial('envGroundPBR', scene);
mat.albedoTexture = proceduralWoodTexture;     // 程序化木纹
mat.bumpTexture = woodNormal;                   // 法线贴图
mat.roughnessTexture = woodRoughness;           // 粗糙度贴图
mat.environmentTexture = scene.environmentTexture; // 复用天空 HDR
```

**程序化木纹生成方案（优化版）**：

```typescript
// 复用 env-terrain.ts 已有的 fbm/hash2/valueNoise，零新增依赖
import { fbm, hash2 } from './env-terrain';

function generateWoodTexture(ctx: CanvasRenderingContext2D, size: number): void {
    const img = ctx.createImageData(size, size);
    const data = img.data;
    
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // 木纹年轮：低频 FBM 沿 Y 轴拉伸
            const n = fbm(x * 0.02, y * 0.005, seed, 4, 1.0);
            
            // 基础色：深浅棕色交替
            const r = Math.round(139 + n * 40);
            const g = Math.round(69 + n * 20);
            const b = Math.round(19 + n * 10);
            
            const i = (y * size + x) * 4;
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}
```

**粗糙度贴图生成**（控制反射强度）：

```typescript
function generateRoughnessTexture(ctx: CanvasRenderingContext2D, size: number): void {
    const img = ctx.createImageData(size, size);
    const data = img.data;
    
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // 低频噪声控制粗糙度变化
            const n = fbm(x * 0.01, y * 0.01, seed, 3, 1.0);
            // 湿润区域 roughness=0.2，干燥区域 roughness=0.8
            const v = Math.round(0.2 + n * 0.6);
            
            const i = (y * size + x) * 4;
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}
```

**法线贴图生成**（模拟木纹凹凸）：

```typescript
function generateNormalTexture(ctx: CanvasRenderingContext2D, size: number): void {
    const img = ctx.createImageData(size, size);
    const data = img.data;
    
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // 计算 FBM 梯度
            const eps = 1.0;
            const nCenter = fbm(x * 0.02, y * 0.005, seed, 4, 1.0);
            const nRight = fbm((x + eps) * 0.02, y * 0.005, seed, 4, 1.0);
            const nDown = fbm(x * 0.02, (y + eps) * 0.005, seed, 4, 1.0);
            
            const dx = (nRight - nCenter) * 10.0;
            const dy = (nDown - nCenter) * 10.0;
            
            // 法线 = (-dx, -dy, 1) 归一化
            const nx = -dx;
            const ny = -dy;
            const nz = 1.0;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            
            const i = (y * size + x) * 4;
            data[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
            data[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
            data[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}
```

**约束**：
- 保留 `StandardMaterial` 作为回退（无贴图时）
- 木纹贴图通过 canvas 程序化生成（零外部资源依赖）
- 粗糙度贴图控制反射强度（湿润=0.2，干燥=0.8）
- 使用 `ImageData` 批量写入（非 `fillRect` 逐像素），性能与地形高度图生成一致

### Phase 2 — 反射模糊 + 法线扭曲（🟡 中等成本）

在 PlanarReflection 后加 `BlurPostProcess`，使反射更自然：

```typescript
import { BlurPostProcess } from '@babylonjs/core/PostProcesses/blurPostProcess';

// 反射 RT 后加模糊
const blur = new BlurPostProcess(
    'groundBlur',
    [1/512, 1/512],  // 水平+垂直 kernel
    1.0,             // strength
    scene
);
// 注意：BlurPostProcess 构造函数第二个参数是 kernel 数组，
// Babylon 9.14.0 API：new BlurPostProcess(size, kernels, strength, target)
// 需确认 target 是否为第四个参数（非 inputTexture）
```

**约束**：
- 模糊强度由 `groundReflectionBlend` 滑块控制
- 低质量模式（low/off）跳过模糊
- 性能预算：<1% FPS 影响

### Phase 3 — 接触阴影（🟠 可选，长期）

编写自定义后处理实现 Contact Shadow（脚底 AO）：

```glsl
// 伪代码
uniform sampler2D depthTexture;
uniform vec2 resolution;

void main() {
    float depth = texture(depthTexture, uv).r;
    float contactShadow = 0.0;
    
    // 向下采样深度
    for (int i = 1; i <= 8; i++) {
        float sampleDepth = texture(depthTexture, uv + vec2(0, -i * 0.001)).r;
        if (sampleDepth < depth) {
            contactShadow += 1.0 / float(i);
        }
    }
    
    gl_FragColor = vec4(contactShadow * 0.5, 1.0);
}
```

**约束**：
- 仅在高/中质量模式启用
- 性能预算：<3% FPS 影响
- 若与 SSR 后处理冲突，降级为简单深度阴影

---

## 替代方案

| 方案 | 否决理由 |
|------|----------|
| **SSR 后处理（路径 B）** | Babylon 9.14.0 无原生 SSR；自研成本高（~500 行 GLSL），非短期刚需 |
| **Lumen 近似（路径 D 长期）** | 需导出深度+法线缓冲，与现有后处理链集成复杂度高 |
| **光线追踪** | Babylon.js 无硬件 RT 支持；WebGPU RT 仍在实验阶段 |
| **第三方 GI 库** | 依赖 Three.js，不兼容 Babylon |

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| PBR 材质性能开销 | 🟡 | 仅地面使用，角色/道具仍用 StandardMaterial；低端设备降级 |
| 程序化木纹视觉质量不足 | 🟠 | 保留外部贴图加载路径（`groundTexture`）；canvas 生成作为零依赖回退 |
| 反射模糊与现有后处理链冲突 | 🟡 | BlurPostProcess 挂载到 DefaultRenderingPipeline 末尾 |
| 法线贴图 UV 不匹配 | 🟢 | 统一 `uScale/vScale` 与地面纹理一致 |
| **BlurPostProcess API 兼容性** | 🟠 | Babylon 9.14.0 `BlurPostProcess` 构造函数为 `(name, kernels, strength, samplingRadius, devicePixelRatio, scene)`，**无 `inputTexture` 参数**；需通过 `targetCamera` 或 `RenderTargetTexture` 挂载 |

---

## 落地检查清单

- [ ] Phase 1：PBR 材质接入 `applyGround()`；验证程序化木纹/法线/粗糙度贴图加载
- [ ] Phase 2：BlurPostProcess 挂载到 PlanarReflection；验证反射模糊效果
- [ ] Phase 3：Contact Shadow 后处理（可选）；验证脚底阴影
- [ ] 全程 `npm run check` 通过，`frontend/e2e/env-sky.spec.ts` 绿
- [ ] 低端设备降级策略验证（StandardMaterial 回退）

---

## 后续（可选增强）

若 Phase 1-2 效果满意，未来可考虑：

| 增强 | 说明 |
|------|------|
| **多层纹理混合** | 地面不同区域混合草地/泥土/石板（基于 heightmap 或 mask texture） |
| **SSR 后处理** | 真正屏幕空间反射，替代 PlanarReflection 平面近似 |
| **动态湿润效果** | 雨天时地面 roughness 降低，反射增强 |
| ** puddle 系统** | 低洼区域积水，局部启用 PlanarReflection |
