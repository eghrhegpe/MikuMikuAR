# Research: UE5 Lumen 风格地面反射 — Babylon.js 技术可行性分析

> 日期：2026-07-15
> 作者：Riku
> 目的：对标截图（UE5 Lumen 风格地面反射 + 复杂木板纹理 + 角色阴影），评估 Babylon.js 实现路径

---

## 1. 截图视觉要素拆解

| 要素 | 描述 | 当前项目状态 |
|------|------|-------------|
| **天空贴图反射** | 地面呈现天空/云朵的模糊倒影 | ✅ PlanarReflection（MirrorTexture/screenSpace）已实现，但仅平面近似 |
| **复杂木板纹理** | 多尺度木纹、凹凸/法线细节 | ❌ 当前仅 canvas 程序化 grid/checker/solid |
| **简易光追阴影** | 角色在地面投下柔和方向阴影 | ✅ CascadedShadowGenerator 已实现 |
| **环境光遮蔽** | 角色脚底接触阴影（contact shadow） | ❌ 未实现 |
| **全局光照反弹** | 天空/地面颜色漫反射到角色底部 | ❌ 仅 StandardMaterial + hemiLight |
| **高光/粗糙度** | 地面湿润/干燥区域差异 | ❌ 无 roughness/metallic PBR 材质 |

---

## 2. 竞品技术栈判断

截图标注为 **Unreal Engine 5**，其核心技术栈为：

| 技术 | 作用 | Babylon.js 对标 |
|------|------|----------------|
| **Lumen** | 实时全局光照（GI）+ 间接反射 | ❌ 无内置 GI；需后处理近似 |
| **Screen Space Reflections (SSR)** | 屏幕空间反射（含边缘模糊） | ⚠️ Babylon 无原生 SSR；需自定义后处理 |
| **Screen Space Global Illumination (SSGI)** | 屏幕空间 GI | ❌ 无 |
| **Contact Shadows** | 接触阴影（脚底 AO） | ⚠️ PCF/CHS 方向阴影已有，接触阴影需后处理 |
| **Heightmap Terrain** | 程序化地形 + 多层材质混合 | ⚠️ CreateGroundFromHeightMap 已有，但材质系统简单 |

---

## 3. Babylon.js 实现路径评估

### 路径 A：现有 PlanarReflection 增强（低成本）

**原理**：当前 `planar-reflection.ts` 已实现平面反射（MirrorTexture/screenSpace 双模式），只需增强：

| 增强项 | 做法 | 成本 | 效果 |
|--------|------|------|------|
| **模糊反射** | 在 MirrorTexture 后加 BlurPostProcess（水平+垂直各 1 次） | 低 | 模拟 Lumen 的粗糙反射 |
| **法线贴图** | 地面 StandardMaterial.bumpTexture 已支持 | 低 | 反射扭曲更真实 |
| **反射衰减** | 利用 FresnelParameters 控制入射角反射强度 | 低 | 低角度反射更强 |
| **反射裁剪** | 反射面以上物体不反射（clipPlane） | 低 | 避免天空出现在反射中 |

**优点**：零新依赖，基于现有代码扩展
**缺点**：仍是平面反射近似，非真正的屏幕空间/光线追踪

### 路径 B：自定义 SSR 后处理（中成本）

**原理**：编写自定义 FragmentShader 实现 Screen Space Reflections：

```glsl
// 伪代码思路
uniform sampler2D albedoTexture;      // 主场景颜色
uniform sampler2D depthTexture;       // 深度缓冲
uniform sampler2D normalTexture;      // 法线缓冲
uniform vec2 resolution;
uniform float roughness;

void main() {
    vec2 uv = gl_FragCoord.xy / resolution;
    vec3 viewDir = getViewDirection(uv);
    vec3 normal = texture(normalTexture, uv).rgb;
    float depth = texture(depthTexture, uv).r;
    
    // 反射向量
    vec3 reflDir = reflect(viewDir, normal);
    
    // 屏幕空间步进采样
    for (int i = 0; i < 64; i++) {
        float sampleDepth = getDepth(uv + reflDir.xy * i * 0.01);
        if (abs(sampleDepth - depth) < threshold) {
            // 命中表面，采样颜色
            color += texture(albedoTexture, uv + reflDir.xy * i * 0.01);
        }
    }
    
    gl_FragColor = vec4(color, 1.0);
}
```

**依赖**：
- Babylon.js `RenderTargetTexture` 导出深度+法线缓冲
- 自定义 `ShaderMaterial` 挂载到全屏 Quad
- 与 `DefaultRenderingPipeline` 后处理链集成

**成本**：中等（~500 行 GLSL + TS 胶水代码）
**效果**：接近 UE5 的 SSR 反射，但无光线追踪精度

### 路径 C：PBR 材质 + 环境贴图（中成本）

**原理**：将地面从 `StandardMaterial` 升级为 `PBRMaterial`，利用环境贴图产生反射：

```typescript
const groundMat = new PBRMaterial('groundPBR', scene);
groundMat.albedoTexture = woodTexture;          // 木纹漫反射
groundMat.bumpTexture = woodNormal;             // 法线贴图
groundMat.roughnessTexture = woodRoughness;     // 粗糙度贴图（湿润/干燥）
groundMat.metallicTexture = null;
groundMat.environmentTexture = cubeTexture;     // 环境反射
```

**依赖**：
- 木纹贴图资源（albedo + normal + roughness + ao 四张）
- HDR 环境贴图（已有 `skyTexture` 可复用）

**成本**：中（需美术资源 + PBR 材质接入）
**效果**：反射质量取决于环境贴图精度，无实时屏幕空间反射

### 路径 D：混合方案（推荐）

| 层级 | 技术 | 效果 |
|------|------|------|
| **基础反射** | 现有 PlanarReflection + BlurPostProcess | 天空/云朵倒影 |
| **材质增强** | PBRMaterial + 木纹贴图 | 复杂纹理 + 粗糙度变化 |
| **间接光照** | 半球光 groundColor 调暖 + 脚底 contact shadow 后处理 | 接触阴影 |
| **未来扩展** | SSR 后处理（路径 B） | 真正屏幕空间反射 |

---

## 4. 性能预算估算

| 方案 | 额外 pass 数 | 额外 RT 内存 | 预期 FPS 影响 |
|------|-------------|-------------|--------------|
| 路径 A（PlanarReflection 增强） | +1 Blur pass | ~0（复用现有 RT） | <1% |
| 路径 B（SSR 后处理） | +1 SSR pass | +1 深度+法线 RT | 5-10% |
| 路径 C（PBR 材质） | 0 | 0 | <1% |
| 路径 D（混合） | +2 | ~512KB | 1-3% |

---

## 5. 结论

| 维度 | 推荐方案 | 理由 |
|------|---------|------|
| **短期（1-2 天）** | 路径 A + C | 零新依赖，PBR 材质 + 模糊反射立竿见影 |
| **中期（1 周）** | 路径 D | 木纹贴图资源到位后混合落地 |
| **长期（技术债）** | 路径 B | SSR 后处理是 UE5 Lumen 风格的核心，但 Babylon 生态不成熟，需自研 |
| **不建议** | 光线追踪 | Babylon.js 9.14.0 无硬件 RT 支持；WebGPU RT 仍在实验阶段 |

---

## 6. 与当前系统的集成点

| 文件 | 改动 |
|------|------|
| `env-impl.ts` | `applyGround()` 中 StandardMaterial → PBRMaterial 切换 |
| `planar-reflection.ts` | 反射后加 BlurPostProcess |
| `env-terrain.ts` | 地形材质支持 PBR + 多层纹理混合 |
| `lighting.ts` | hemiLight.groundColor 暖色调增强接触感 |
| `render/performance.ts` | SSR pass 性能降级策略 |
