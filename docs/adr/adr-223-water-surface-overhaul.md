# ADR-223: 水面视觉效果整顿 —— 法线混合、深度泡沫、折射扭曲、SSS、渐变颜色

- **状态**: 规划
- **日期**: 2026-08-01
- **相关**: ADR-222（深度差雾——前置依赖）、ADR-115（水面视觉效果增强）、ADR-211（水面功能开关体系）、ADR-216（移除死字段）
- **参考文献**:
  - Ref A — CSDN `2301_81522229`（保姆级水体 Shader，2026-05-29）：深度 / 泡沫 / 折射扭曲 / 法线扰动 / 高光 / 反射 / 菲涅耳 / 焦散 / Ramp 渐变纹理
  - Ref B — CSDN `misaka12807`（水下透视效果，2023-09-06）：深度差雾（GrabPass + CameraDepthTexture）→ 水柱厚度驱动颜色与透明度
  - Ref C — Yuumu 博客（水体渲染，2025-04-26）：屏幕空间法线投影折射 / 深度遮罩折射修正 / SSS 次表面散射 / Blinn-Phong 高光 / 顶点位移贴图
- **源码锚点**: `frontend/src/scene/env/shaders/water.frag.glsl`、`frontend/src/scene/env/shaders/water.vert.glsl`、`frontend/src/scene/env/env-water.ts`、`frontend/src/core/env-state-schema.ts`

---

## 一、问题陈述

### 1.1 现有水面视觉效果的差距矩阵

对照三份 Unity 水体渲染最佳实践，识别如下差距：

| 差距 | 现状 | 参考方案 | Ref | 严重度 |
|------|------|---------|-----|--------|
| **法线扰动互扰** | 三系统独立加法叠加（细节法线 + 焦散梯度 + ripple 正弦环），运动不和谐 | 单源统一扰动（法线纹理乘法混合），下游全部复用 | A | 🔴 "波纹诡异"根因 |
| **泡沫仅波峰驱动** | `smoothstep(foamStart, foamEnd, vHeight - waterLevel)` | `waterDepth * _FoamRange` + `step` 裁剪，岸线自然起沫 | A | 🔴 |
| **水下物体无折射** | 水面 alpha 混合，水下透明穿透 | `_CameraOpaqueTexture` + 屏幕空间法线投影 UV 偏移 + 深度遮罩 | A, C | 🟡 |
| **无 SSS 次表面散射** | 水面无半透明透光效果 | `pow(dot(viewDir, -H), _Power) * waveHeight` 光包裹模拟 | C | 🟡 |
| **单色 waterColor** | 单一 `waterColor` + skyBlend | Ramp 渐变纹理 / 数学梯度 `lerp(shallow, deep, depthNorm)` | A, C | 🟢 |

### 1.2 "波纹诡异"的精确根因（Ref A 佐证）

水面 frag shader 中，`normal` 在同一帧被三个独立系统依次叠加（L152-155 → L263-264 → L314）：

```glsl
// 系统 1: 细节法线 (addition blending)
normal = normalize(normal * gerstnerScale +
    vec3(detailNormal.x * s, 1.0, detailNormal.y * s));

// 系统 2: 焦散梯度 → 法线偏移 (addition)
vec3 causticNormalOffset = vec3(dcdx, 1.0, dcdy) * uCausticIntensity * 0.5;
normal = normalize(normal + causticNormalOffset);

// 系统 3: ripple 正弦环 (addition)
vec3 rippleN = vec3(rippleSum * rippleNormalStrength, 0.0, ...);
normal = normalize(normal + rippleN);
```

三者的运动频率、相位和方向没有谐波关系，视感表现为不和谐的抖动。

Ref A 的正确做法（第 5 节"法线扰动"）——**乘法混合，单源驱动**：

```hlsl
// Ref A L5: 两个方向相反的法线纹理 → 乘积混合
float4 DisNormal = SAMPLE_TEXTURE2D(_DisNormal, sampler_DisNormal, i.waterDisUV.xy);
float4 DisNormal01 = SAMPLE_TEXTURE2D(_DisNormal, sampler_DisNormal, i.waterDisUV.zw);
DisNormal.xyz *= DisNormal01.xyz * 4;  // 乘法：零交叉区天然压制 → 有机织网图案
```

Ref A 也解释了为什么不用加法——"高光的流向是单一的，这是不对的，应该是不确定的流向，我们要让法线的流动从单一流动变为对着互相流动"。乘法混合的零交叉区天然产生"织网"式干涉，比加法更接近真实水面的多尺度波纹叠加。

---

## 二、分阶段方案

### Phase 0: 法线混合加法→乘法（P0，无依赖）

**目标**：根除"波纹诡异"，零回归兼容。

**参考**：Ref A 第 5 节（法线扰动）+ 第 6 节（高光，用扰动后的法线计算 Blinn-Phong）。

**GLSL 改动** (`water.frag.glsl` L145-155)：

```glsl
// ======== ADR-223 P0: 法线混合加法→乘法 ========
// 参考 Ref A: DisNormal.xyz *= DisNormal01.xyz * 4
// 参考 Ref C: 高光用扰动后的法线计算 Blinn-Phong

// 旧（加法）：
// vec3 detailNormal = normalize(n1 + n2 * 0.5 + n3 * uLowFreqNormalStrength);

// 新（乘法）：双层反向法线相乘 → 有机织网图案
vec3 dn = n1.xyz * n2.xyz * 2.0;
// 零回归：strength=0 → 单位法线
dn = mix(vec3(0.0, 1.0, 0.0), dn, uDetailNormalStrength);

// n3 低频层保留加法（大尺度滚动光带 ≠ 高频细节，语义不同）
vec3 lowFreqOffset = vec3(n3.x, 0.0, n3.y) * uLowFreqNormalStrength;

// 最终合成
normal = normalize(normal * gerstnerScale * dn + lowFreqOffset);
```

**审查下游影响**：

| 下游 | 影响 | 处置 |
|------|------|------|
| Sun Glitter (L282-299) | `n1` 在 glitter 中单独使用，不受改动影响 | ✅ 无变更 |
| 焦散梯度法线偏移 (L263-264) | 乘法混合后大概率冗余（织网图案已模拟焦散起伏） | P0 后 A/B 对比，预期移除 |
| ripple 法线叠加 (L314) | 乘法后 ripple 可见度变化 | P0 后验证 |
| 反射 (L218-221) | `reflected = reflection * foamDamp` 不直接依赖 normal | ✅ 无变更 |
| Fresnel (L200) | 使用 `dot(viewDir, normal)`，normal 变化影响 Fresnel 边缘 | 需验证边缘衰减是否仍自然 |

**零回归**：`uDetailNormalStrength=0` → `dn = vec3(0,1,0)` → `normal = normal * gerstnerScale + lowFreqOffset` → `uLowFreqNormalStrength=0` 时完全恢复 Gerstner 原貌。

---

### Phase 1: 深度驱动岸线泡沫（P1，依赖 ADR-222 深度纹理）

**前置条件**：ADR-222 的 `sceneDepthTexture` uniform 已接入水面 shader，`waterThickness` 可用。

**目标**：泡沫从"仅波峰"升级为"波峰 + 岸线"。

**参考**：Ref A 第 3 节（水的泡沫）、Ref B（深度差驱动）。

Ref A 的泡沫核心逻辑：

```hlsl
// Ref A L3: 世界空间 UV（防拉伸）+ step 裁剪 + pow 调节密度
half foamTex = SAMPLE_TEXTURE2D(_FoamTex, sampler_FoamTex, i.foamUV).r;
foamTex = pow(foamTex, _FoamArea);           // 密度调节
float foamRange = waterDepth * _FoamRange;    // 深度缩放
half foamShape = step(foamRange, foamTex);    // 阈值裁剪
half4 foamColor = foamShape * _FoamColor;
```

关键设计：Ref A 的泡沫使用**世界空间坐标**采样（`o.foamUV = speed + o.positionWS.xz * _FoamTex_ST.xy`），防止模型拉伸时 UV 被拉扯导致泡沫纹理变形。这是我们当前缺失的——我们当前泡沫无纹理采样，纯高度阈值。

**GLSL 改动**：在现有泡沫计算（L185-197）前插入深度泡沫层：

```glsl
// ======== ADR-223 P1: 深度驱动岸线泡沫 ========
// 参考 Ref A: step(foamRange, foamTex) + 世界空间 UV
// 参考 Ref B: waterDepth = backgroundDepth - surfaceDepth
// waterThickness 来自 ADR-222（单位 babymmd unit，1 unit = 0.1m）

float shorelineFoam = 0.0;
if (uShorelineFoamDensity > 0.0) {
    // 世界空间 UV 采样泡沫纹理（防拉伸，同 Ref A）
    // camXZ 已在 detail normal 段计算（相机相对坐标）
    vec2 foamWorldUV = camXZ * 0.05 + wavePhase * 0.02; // tiling 可调
    float foamTexVal = texture2D(uDetailNormalTex, foamWorldUV).r; // 复用 detailNormalTex 作为泡沫噪声源
    foamTexVal = pow(foamTexVal, uShorelineFoamArea);              // 密度调节
    float foamDepthRange = waterThickness * uShorelineFoamDensity;  // 深度 → 泡沫范围
    float foamShape = step(foamDepthRange, foamTexVal);             // 阈值裁剪（Ref A）
    shorelineFoam = foamShape;
}

// 原有波高泡沫 + 岸线泡沫取 max
float totalFoam = max(foam, shorelineFoam * foamNoise);
foam = totalFoam;
```

**设计决策**：复用 `uDetailNormalTex` 作为泡沫噪声源，而非新增纹理槽位。理由：泡沫噪声纹理语义上等同于高频噪声纹理，新增纹理增加管线复杂度而收益有限。

**新增 uniform / 状态**：

| 字段 | 类型 | 默认值 | 分组 | 说明 |
|------|------|--------|------|------|
| `shorelineFoamEnabled` | `boolean` | `false` | `water` | 总开关 |
| `uShorelineFoamDensity` | `float` | `0.3` | — | 岸线泡沫密度 |
| `uShorelineFoamArea` | `float` | `2.0` | — | 泡沫噪声密度（pow 指数，Ref A 的 `_FoamArea`） |

**零回归**：`shorelineFoamEnabled=false` → `uShorelineFoamDensity=0` → `shorelineFoam=0`。

---

### Phase 2: 水面折射扭曲（P2，独立 RT 依赖）

**目标**：水面下物体产生法线驱动的折射扭曲。

**参考**：
- Ref A 第 4 节：`_CameraOpaqueTexture` + 法线扰动 UV + `waterDepth01 < 0 ? screenUV : distortUV`
- Ref C 第 1 节：**屏幕空间法线投影**——将世界空间法线投影到屏幕右/上方向

**Ref C 的屏幕空间法线投影（关键改进）**：

```hlsl
// Ref C: 屏幕空间法线投影
// 将世界空间法线投影到屏幕的右方向和上方向，而非简单用 normal.xz
float3 screenRight = normalize(cross(float3(0, 1, 0), viewDir));
float3 screenUp = normalize(cross(viewDir, screenRight));
float2 distortion;
distortion.x = dot(normal, screenRight);
distortion.y = dot(normal, -screenUp);       // 负号：采样时 UV 向下偏移，得正确折射方向
distortion *= _NormalStrength;
float2 refractionUV = screenUV + distortion + _Offset.xy;
```

**为什么比 `normal.xz` 更正确**：`normal.xz` 假设水面法线在 XZ 平面上的偏移直接映射到屏幕 XY——这只在水面法线垂直（相机俯视）时成立。当相机倾斜/平视时，世界 XZ 与屏幕 XY 不对齐，需投影到相机局部坐标系。

**Ref A + Ref C 的深度遮罩**：

```hlsl
// Ref A L4: 三目运算符 → 水面之上用 screenUV，水面之下用 distortUV
float2 opaqueUV = waterDepth01 < 0 ? screenUV : distortUV;

// Ref C: lerp + step 等价写法
refractionUV = lerp(screenUV, refractionUV, step(0, DepthGap));
```

**完整方案**：

TS 侧（`env-water.ts`）：

```ts
// 场景 RT（不含水面），半分辨率，手动刷新
const refractionRT = new RenderTargetTexture(
    'waterRefraction',
    { width: 512, height: 512 },
    scene,
);
refractionRT.renderList = scene.meshes.filter(m => m !== waterPlane);
refractionRT.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
mat.setTexture('uRefractionTex', refractionRT);
```

GLSL 侧：

```glsl
// ======== ADR-223 P2: 屏幕空间法线投影折射 ========
// 参考 Ref C: screenRight/screenUp 投影
// 参考 Ref A: depth-gated refraction UV (waterDepth01 < 0 ? screenUV : distortUV)
uniform sampler2D uRefractionTex;
uniform float uRefractionStrength; // 默认 0.02，0=关闭零回归

if (uRefractionStrength > 0.0) {
    // Ref C: 屏幕空间法线投影
    vec3 screenRight = normalize(cross(vec3(0.0, 1.0, 0.0), viewDir));
    vec3 screenUp = normalize(cross(viewDir, screenRight));
    vec2 distortion;
    distortion.x = dot(normal, screenRight);
    distortion.y = dot(normal, -screenUp);
    distortion *= uRefractionStrength;

    // screenUV 用 gl_FragCoord 计算
    vec2 screenUV = gl_FragCoord.xy / vec2(textureSize(uRefractionTex, 0));
    vec2 refrUV = screenUV + distortion;

    // Ref A + Ref C: 深度遮罩 — 只扭曲水下像素
    // waterThickness 来自 ADR-222（> 0 为水下，<= 0 为水上）
    float mask = step(0.0, waterThickness);
    refrUV = mix(screenUV, refrUV, mask);

    vec3 refraction = texture2D(uRefractionTex, refrUV).rgb;
    // 混合：水深越大折射越强
    float refrBlend = 1.0 - exp(-0.1 * max(waterThickness, 0.0));
    color = mix(color, refraction, refrBlend * uRefractionStrength);
}
```

**新增状态**：

| 字段 | 类型 | 默认值 | 分组 |
|------|------|--------|------|
| `refractionEnabled` | `boolean` | `false` | `water` |
| `refractionStrength` | `number` | `0.02` | `water` |

**性能约束**：半分辨率 RT (512×512) + 手动刷新，预计 <0.3ms GPU。`refractionEnabled=false` 零开销。

---

### Phase 3: SSS 次表面散射（P3，独立增强）

**目标**：模拟光线穿透薄水层（浅滩、波峰）的透光效果，水体看起来不再是一张不透明的"彩色玻璃"。

**参考**：Ref C 第 3 节（次表面散射模拟）+ [GDC 2011 — Approximating Translucency](https://colinbarrebrisebois.com/2011/03/07/gdc-2011-approximating-translucency-for-a-fast-cheap-and-convincing-subsurface-scattering-look/)。

**Ref C 完整实现**：

```hlsl
// Ref C: SSS 模拟
// 思路：水越薄（waveHeight 越大）→ 透光越强
// H = normalize(lightDir + normal * _Distortion) — 光包裹（light wrapping）
// I = pow(saturate(dot(viewDir, -H)), _Power) * _SSSscale * waveHeight
// SSSColor = _SSSColor * I

float waveHeight = saturate(i.worldPos.y / _waveMaxHeight);
float3 H = normalize(lightDir + normal * _Distortion);
float I = pow(saturate(dot(viewDir, -H)), _Power) * _SSSscale * waveHeight;
half4 SSSColor = _SSSColor * I;

// 最终混合：加法（直接叠加到折射颜色上）
half4 color = lerp(underwaterColor, depthColor, DepthGap) + SSSColor;
```

**算法解析**：

| 分量 | 含义 | 作用 |
|------|------|------|
| `lightDir + normal * _Distortion` | 光源方向向法线弯曲 | 模拟光在介质内散射扩散（light wrapping） |
| `dot(viewDir, -H)` | 视线与包裹后的反向半程向量夹角 | 背光面视角下透光最亮（光穿透到观察者） |
| `pow(..., _Power)` | 锐度控制 | 高 `_Power` → 窄透光锥；低 → 宽泛透光 |
| `* waveHeight` | 厚度权重 | 波峰处薄 → 透光强；波谷处厚 → 透光弱 |
| `_SSSscale` | 全局强度 | 0=关闭零回归 |

**为什么用 `waveHeight` 近似厚度**：Ref C 明确指出——"海水越高就越薄，所以通过高度比例来模拟物体薄厚"。在我们的系统中，`vHeight - waterLevel` 可以直接作为厚度代理。

**我们的实现（适配 Babymmd unit）**：

```glsl
// ======== ADR-223 P3: SSS 次表面散射 ========
// 参考 Ref C + GDC 2011 Translucency Approximation
// uSSSIntensity=0 时零回归
uniform float uSSSIntensity;    // 默认 0（零回归）
uniform float uSSSDistortion;   // 默认 0.5（光包裹弯曲程度，Ref C 的 _Distortion）
uniform float uSSSPower;        // 默认 4.0（透光锥锐度，Ref C 的 _Power）
uniform vec3 uSSSColor;         // 默认 warm white vec3(1.0, 0.95, 0.8)

if (uSSSIntensity > 0.0) {
    // 厚度代理：波高偏离水面水平面越大 → 水越薄
    float thicknessProxy = saturate((vHeight - waterLevel) / max(waveHeight, 0.1));
    // Ref C: H = normalize(lightDir + normal * _Distortion)
    vec3 sssH = normalize(normalize(lightDir) + normal * uSSSDistortion);
    // Ref C: I = pow(saturate(dot(viewDir, -H)), _Power) * _SSSscale * waveHeight
    float sssI = pow(saturate(dot(viewDir, -sssH)), uSSSPower) * uSSSIntensity * thicknessProxy;
    // 加法叠加（同 Ref C）
    color += uSSSColor * sssI * lightExposure;
}
```

**新增状态**：

| 字段 | 类型 | 默认值 | 分组 | 说明 |
|------|------|--------|------|------|
| `sssEnabled` | `boolean` | `false` | `water` | 总开关 |
| `sssIntensity` | `number` | `0.5` | `water` | 全局强度（shader 中 `uSSSIntensity` = enabled ? value : 0） |
| `sssDistortion` | `number` | `0.5` | `water` | 光包裹弯曲度 |
| `sssPower` | `number` | `4.0` | `water` | 透光锥锐度 |
| `sssColor` | `tuple3` | `[1.0, 0.95, 0.8]` | `water` | 透光色 |

**已知局限**（Ref C 原文指出）："这个实现对于很大的波浪会有问题，同时对于一个波上会有一些深色的点"。建议 Phase 3 先落地基础版本，后续可用模糊泡沫纹理 RT 作为更精确的厚度参考（在本 ADR 中标记为未来增强项，不阻塞 P3 落地）。

---

### Phase 4: 渐变颜色（P4，增强项）

**目标**：`waterColor` 单色 → 数学梯度，通过水柱厚度索引，实现浅水透 → 深水蓝的自然过渡。

**参考**：
- Ref A 第 2 节：`saturate(waterDepth / _WaterColorRange)` → 采样 RampTex
- Ref C 第 2 节：`lerp(_ShallowColor, _DeepColor, DepthGap)`

Ref C 的双色 lerp 方案最简洁：

```hlsl
// Ref C:
half4 depthColor = lerp(_ShallowColor, _DeepColor, DepthGap);
half4 color = lerp(underwaterColor, depthColor, DepthGap) + SSSColor;
```

**我们的实现（数学梯度，无需额外纹理）**：

```glsl
// ======== ADR-223 P4: 深度渐变颜色 ========
// 参考 Ref A: colorParams = saturate(waterDepth / _WaterColorRange)
// 参考 Ref C: lerp(_ShallowColor, _DeepColor, DepthGap)
// waterThickness 来自 ADR-222

float depthColorNorm = saturate(waterThickness / uWaterColorRange);
vec3 shallowColor = mix(waterColor, uSkyBlendColor, uSkyColorBlend); // 浅水 = 天空反射
vec3 deepColor = vec3(0.02, 0.15, 0.35);                             // 深海蓝
vec3 gradientColor = mix(shallowColor, deepColor, depthColorNorm);
```

**设计决策**：数学梯度而非 RampTex（Ref A 的方案需要 C# 脚本动态生成 512×2 纹理 + `SetGlobalTexture`）。理由：
- 零纹理管线开销
- 参数化（shallow/deep 色 + 过渡范围）已足够灵活
- 浅水色自动联动 `uSkyBlendColor`（Ref A 的渐变纹理无此能力——它是静态图片）

**新增状态**：

| 字段 | 类型 | 默认值 | 分组 | 说明 |
|------|------|--------|------|------|
| `waterColorRange` | `number` | `50` | `water` | 浅→深过渡距离（babymmd unit = 0.1m，默认 50 unit = 5m） |

---

## 三、与现有系统的共存策略

### 3.1 Gerstner 波浪 vs 顶点位移贴图

Ref C 使用 `SAMPLE_TEXTURE2D_LOD(_DisplaceTex, ...)` 做顶点位移，而我们用 4 层 Gerstner 波（`water.vert.glsl` L42-59）。Gerstner 方案在物理正确性上更优（方向性、色散关系、风向联动），不做替换。

但 Ref C 的位移贴图思路可作为一个**可选的额外细节层**（未来增强项），叠加在 Gerstner 之上产生高频微扰动。本 ADR 不涉及。

### 3.2 高光系统

我们已有 Blinn-Phong 高光（L273-275）+ Sun Glitter（L282-299）。Ref A 的高光（第 6 节）和 Ref C 的高光（第 4 节）都是标准 Blinn-Phong：

```hlsl
// Ref A L6: 扰动法线驱动高光
float3 N = lerp(normalize(i.NormalWS), DisNormal.xyz, _Reflection);
float3 H = normalize(L.direction + viewWS);
float4 Specular = _SpecularColor * half4(L.color, 1) * pow(max(0, dot(N, H)), _Smoothness) * _HighLight;

// Ref C:
half3 halfDir = normalize(lightDir + viewDir);
half4 specular = _specularColor * pow(max(0, dot(halfDir, normal)), _gloss);
```

我们的实现已覆盖此功能，但 Phase 0 的乘法法线混合会改变 `normal` 的分布 → 高光位置/强度变化。需要验证。

### 3.3 焦散梯度法线偏移的去留

Phase 0 完成后 A/B 对比：
- A: 焦散梯度法线偏移保留（L258-264 `causticNormalOffset` → `normal +=`）
- B: 焦散梯度法线偏移移除，仅保留亮度叠加（L267-268）

预期 B 为优胜（乘法混合已产生类似焦散的织网图案）。若 B 确认，移除 `causticNormalOffset` 计算。Ref A 的焦散（第 9 节）是投射到水底的深度贴花方案，不影响此决策。

### 3.4 ripple 系统审查

`calcRipple` 的径向正弦环在乘法法线下游叠加。Phase 0 后验证：
- 若仍可见且自然 → 保留
- 若被压制到不可见 → 两种路径：提权（增大 `rippleNormalStrength`）或降级为纯 glint
- 若产生新的互扰 → 移除法线扰动部分，仅保留 `rippleGlint`

---

## 四、实施顺序与依赖图

```
Phase 0: 法线混合乘法 ─────────── 无依赖，即刻动工
    │
    ├─→ 验证 → A/B 焦散梯度去留
    ├─→ 验证 → ripple 系统去留
    ├─→ 验证 → 高光/Fresnel 变化
    │
    ├─→ Phase 1: 深度岸线泡沫 ────── 依赖 ADR-222 完成
    │
    ├─→ Phase 2: 折射扭曲 ────────── 独立 RT（可与 P1 并行）
    │
    ├─→ Phase 3: SSS ────────────── 独立增强（可与其他并行）
    │
    └─→ Phase 4: 渐变颜色 ────────── 依赖 ADR-222 完成
```

**建议执行节奏**：P0 先落地（~2h），效果确认后 P1+P2+P3 可并行推进。

---

## 五、零回归矩阵

| Phase | 零回归条件 | 验证方法 |
|-------|-----------|---------|
| P0 | `uDetailNormalStrength=0` + `uLowFreqNormalStrength=0` | Gerstner 原貌 |
| P1 | `shorelineFoamEnabled=false` | 岸线无额外泡沫 |
| P2 | `refractionEnabled=false` | 零开销，无视觉变化 |
| P3 | `sssEnabled=false` ← `uSSSIntensity=0` | 水面无色偏透光 |
| P4 | `waterColorRange` 极度大（如 10000）→ `depthColorNorm≈0` → 始终浅水色 | 等效当前 `waterColor` |

---

## 六、风险与未决项

| 风险 | 等级 | 缓解 |
|------|------|------|
| 乘法混合后 normal 幅度分布变化 → Fresnel/specular 过亮/过暗 | P2 | P0 后对比 Fresnel 衰减曲线；必要时 normalize `dn` |
| 岸线泡沫依赖 ADR-222 深度线性化精度 | P2 | 等 ADR-222 落地后验证厚度值量级 |
| 折射 RT 移动端/WebGL1 性能退化 | P3 | 半分辨率 + 手动刷新 + 默认关闭 |
| SSS 在 Gerstner 大波（`waveHeight` 离散度大）下的"深色点"问题 | P3 | Ref C 已知局限；先落地基础版，后续用模糊泡沫 RT 做精确厚度 |
| ripple 与乘法法线互扰 | P3 | P0 后审查 |

---

## 七、参考代码索引

| 技术点 | Ref A 节/行 | Ref C 节/行 |
|--------|-----------|-----------|
| 法线乘法混合 | §5: `DisNormal.xyz *= DisNormal01.xyz * 4` | — |
| 深度偏移 UV 泡沫 | §3: `step(foamRange, foamTex)` | — |
| 屏幕空间法线投影 | — | §1: `screenRight/screenUp` + `dot(normal, ...)` |
| 折射深度遮罩 | §4: `waterDepth01 < 0 ? screenUV : distortUV` | §2: `lerp(screenUV, refractionUV, step(0, DepthGap))` |
| SSS 光包裹 | — | §3: `H = normalize(lightDir + normal * _Distortion)` |
| 深度颜色 lerp | §2: `saturate(waterDepth / _WaterColorRange)` → RampTex | §2: `lerp(_ShallowColor, _DeepColor, DepthGap)` |
| Blinn-Phong 高光 | §6: `pow(max(0, dot(N, H)), _Smoothness)` | §4: `pow(max(0, dot(halfDir, normal)), _gloss)` |

---

## 八、验收标准

1. `npx tsc --noEmit` 零错误
2. `vitest run env-state / scene/env-water` 全通过
3. **P0 视觉**：水面法线运动自然流畅，无三系统的互扰抖动；零回归条件完全恢复 Gerstner
4. **P1 视觉**：浅水区岸线自然起沫；深水区仅波峰有泡沫；`shorelineFoamEnabled=false` 零回归
5. **P2 视觉**：水下物体边缘随波扭曲，水面上方物体不受影响；`refractionEnabled=false` 零开销
6. **P3 视觉**：波峰透光（暖白色），波谷无透光；`sssEnabled=false` 零回归
7. **P4 视觉**：浅水透明青色 → 深水深海蓝自然过渡；与 `uSkyColorBlend` 联动
