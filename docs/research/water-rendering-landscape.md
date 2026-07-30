# 水面渲染技术调研 — 自研方向评估与开源参考

> **调研日期**: 2026-07-30
> **背景**: 对自研 Gerstner 水面系统的方向质疑，经联网调研后确认方向正确，此文记录结论并整理开源参考项目。

---

## 一、核心结论：自研方向正确，非闭门造车

**自研水体（Gerstner 4 层 + 平面反射 RT + 泡沫/焦散/水下）在 MMD 舞台场景下是合理选择，不是错误方向。**

| 论证维度 | 说明 |
|---------|------|
| **场景规模** | MMD 舞台是有限水体（池/湖），非开放海洋。Gerstner 在有限水体上视觉优于 FFT（FFT 的重复平铺在有限区域更明显，Spectral Gerstner 是更好的折中） |
| **硬件覆盖** | 可能跑在集显/旧显卡上。Gerstner 在顶点着色器完成，零 GPU 计算开销。FFT 需要 Compute Shader，GTX 1080 以下吃力 |
| **艺术可控** | MMD 需要不同风格（卡通/写实/赛博）。Gerstner 每层参数可独立调节，FFT 只有风速/方向等宏观参数 |
| **竞品对标** | DanceXR 的水也是 Unity 内置方案（Gerstner 级别），并非 FFT 海洋级别 |
| **功能完整度** | 泡沫、焦散、法线细节、平面反射、涟漪、水下效果俱全，功能完整度高于同类开源项目 |

### 行业共识

| 来源 | 原话 |
|------|------|
| Oceanology Pro 2.0 (Galidar Studio) | Gerstner 适合 "Mobile, low-spec hardware, stylized water, simple lake/pool"；FFT 适合 "cinematic oceans, RTX 3080+" |
| NVIDIA GPU Gems 第1章 | "The sum of sines gives a continuous function describing the height and surface orientation of the water at all points" — 是游戏水体渲染的标准教材 |
| GodotOceanWaves | "Gerstner waves work well for modeling the lower-frequency details in calmer waters" |
| Oculus NorthStar (Meta) | "Early tests with Gerstner waves in the vertex shader were inefficient for realistic ocean simulation" — 他们选了 iFFT，但那是 VR 开放海洋场景，与 MMD 舞台场景不同 |

---

## 二、自研水体实际短板（调研后修正）

| 短板 | 具体表现 | 优先级 |
|------|---------|--------|
| **着色器膨胀** | frag 333 行，涟漪上限 256（实际只用几个）、5-tap 反射采样 | P3 可优化 |
| **焦散视觉** | 程序化焦散纹理质量有限，双层叠加后仍显"塑料感" | P2 可提升 |
| **泡沫细节** | 仅波高阈值，无湍流/次级泡沫/噪声扰动 | P3 可优化 |
| **缺少 SSR** | 平面反射在屏幕边缘露黑边，缺屏幕空间反射 | P4 未来可期 |
| **缺少远近模糊** | 远处水面细节与近处相同，视觉不自然 | P3 可优化 |
| **无物理交互** | 模型/角色不产生船尾迹/水花 | P4 功能可暂缓 |

---

## 三、开源参考项目整理

### 3.1 Babylon.js 生态（直接相关）

| 项目 | 链接 | 技术方案 | 可借鉴点 |
|------|------|---------|---------|
| **SimpleBabylonWaterShaders** | [99-Knots/SimpleBabylonWaterShaders](https://github.com/99-Knots/SimpleBabylonWaterShaders) | Babylon ShaderMaterial，Sine/Gerstner 切换 | 着色器结构参考，但功能远不如自研 |
| **Amank12721/Babylonjs** | [water-shader-postfx.html](https://github.com/Amank12721/Babylonjs/blob/main/water-shader-postfx.html) | Babylon ShaderMaterial + 后处理 | 后处理链 + 水面组合，但着色器简单（仅正弦波） |
| **Babylon.js WaterMaterial (内置)** | [官方文档](https://doc.babylonjs.com/typedoc/classes/babylon.watermaterial) | Mirror RT + 正弦波 | 反射 RT 实现参考，但波形不如自研 |
| **Babylon.js 官方 RTT 教程** | [Documentation](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/postProcesses/renderTargetTextureMultiPass.md) | 多 Pass RTT 焦散 | 用 RTT 做焦散叠加的思路可参考 |
| **babylon-mmd-showcase** | [noname0310/babylon-mmd-showcase](https://github.com/noname0310/babylon-mmd-showcase) | Babylon.js + mmd，高级后处理管线 | MMD 场景渲染管线配置参考，但无水系统 |

### 3.2 Three.js 生态（设计参考）

| 项目 | 链接 | 技术方案 | 可借鉴点 |
|------|------|---------|---------|
| **WAKE** | [masafykun/wake](https://github.com/masafykun/wake) | Gerstner + CPU/GPU 波参数共享 | 船体浮力与波面同步的实现（CPU 采样 + GPU 渲染同参数） |
| **threejs-water** | [threejs-water](https://gitcode.com/gh_mirrors/th/threejs-water) | WebGL 水面模拟，焦散/折射 | 焦散 + 折射系统架构参考 |
| **Sean-Bradley Gerstner Ocean** | [Sean-Bradley/three.js](https://github.com/Sean-Bradley/three.js/blob/gerstner-waves/examples/webgl_shaders_ocean_gerstner.html) | Three.js Gerstner + 反射 | Gerstner + 平面反射的完整实现 |
| **jbouny/experiments** | [jbouny/experiments](https://github.com/jbouny/experiments) | 投影网格 + LOD 水面 | 投影网格（projected grid）LOD 方案，比当前 LOD 更高级 |
| **gerstner-waves-rf3** | [lazygeekpanda/gerstner-waves-rf3](https://github.com/lazygeekpanda/gerstner-waves-rf3) | React Three Fiber Gerstner | 波参数 UI 控制参考 |

### 3.3 跨引擎/专业级方案（参考架构）

| 项目 | 链接 | 技术方案 | 可借鉴点 |
|------|------|---------|---------|
| **Oceanology Pro 2.0** | [Galidar](https://www.fab.com/sellers/galidar) | 三套波系统（FFT/Gerstner/Spectral Gerstner） | **Spectral Gerstner 概念**：用频谱分布驱动 Gerstner 参数，比纯 Gerstner 更真实，比 FFT 更轻量 |
| **GodotOceanWaves** | [2Retr0/GodotOceanWaves](https://github.com/2Retr0/GodotOceanWaves) | Godot + IFFT 海洋 | 级联法线/位移强度控制 |
| **Oculus NorthStar Ocean** | [Unity-NorthStar](https://github.com/oculus-samples/Unity-NorthStar) | Unity + CPU iFFT + Job System | 性能优化策略：CPU iFFT + Burst Compiler |
| **Crest Ocean System** | [开源](https://github.com/crest-ocean/crest) | Unity + FFT + LOD | 完整的海洋渲染架构，但太重不适合 MMD |

### 3.4 核心参考源码片段

**SimpleBabylonWaterShaders** — Gerstner 顶点着色器核心（与自研类似但更简洁）：

```glsl
// 与自研的 4 层 Gerstner 结构相同，但只用 2 层
// 自研的 4 层 + 风向联动 + 双层尺度拆分更丰富
```

**WAKE** — CPU/GPU 波参数共享模式（值得借鉴）：

```javascript
// CPU 端用同样的波参数采样高度，用于物理浮力
// GPU 端用同样的波参数在顶点着色器位移
// 自研目前缺少 CPU 侧波高采样接口
```

---

## 四、可借鉴的具体改进点

| 来源 | 可借鉴点 | 实现难度 | 预期收益 |
|------|---------|---------|---------|
| Spectral Gerstner (Oceanology Pro) | 用频谱分布代替手动调参，Beaufort 等级驱动 | 中 | 波浪更自然，用户调参更简单 |
| WAKE | CPU/GPU 波参数共享，实现浮力/交互 | 低 | 模型可漂浮水面 |
| jbouny projected grid | 投影网格 LOD，无限水面 | 高 | 远景无限水面，无 LOD 切换 |
| threejs-water | 焦散折射系统架构 | 中 | 焦散品质提升 |
| Sean-Bradley Gerstner | 完整的 Gerstner + 反射实现 | 低 | 验证自研实现正确性 |
| Babylon RTT 多 Pass | RTT 多 Pass 焦散叠加 | 中 | 焦散效果增强 |

---

## 五、生于忧患

自研水体在功能的完整度上已经超过同类开源项目（SimpleBabylonWaterShaders 只有 Sine/Gerstner 切换，无泡沫/焦散/涟漪/Glitter）。真正的差距不在"有没有"，而在"好不好"——着色器膨胀、焦散质感、泡沫细节这些打磨问题。

如果未来确实需要开放海洋级水面，建议的演进路径：

```
Gerstner 4 层 (当前)
  → Spectral Gerstner (8-16 层，频谱驱动)
    → IFFT (Compute Shader，需 WebGPU)
```

而不应该跳过中间步骤直接跳到 FFT。Spectral Gerstner 是当前性价比最高的升级方向。

---

## 六、代码级对比：自研 vs 开源方案逐帧拆解

> 本节将自研水体与 4 个开源项目的源代码逐行对比，分析每个功能子系统的具体差异和改进方向。

### 6.1 对比项目清单

| 项目 | 引擎 | 核心方案 | 代码量 | 链接 |
|------|------|---------|--------|------|
| **自研 (MikuMikuAR)** | Babylon.js | Gerstner 4 层 + 法线纹理 + 焦散/涟漪/Glitter/泡沫 | 65 行 vert + 337 行 frag + 1518 行 TS | 本仓库 `frontend/src/scene/env/` |
| **Sean-Bradley/Three.js Ocean** | Three.js | Gerstner 3 层 + 噪声法线 + 菲涅尔 | ~50 行 vert + ~80 行 frag | [GitHub](https://github.com/Sean-Bradley/three.js/blob/gerstner-waves/examples/webgl_shaders_ocean_gerstner.html) |
| **99-Knots/SimpleBabylon** | Babylon.js | Gerstner/Sine 切换 + Phong 着色 | ~50 行 vert + ~30 行 frag | [GitHub](https://github.com/99-Knots/SimpleBabylonWaterShaders) |
| **davidar/water (Seascape)** | 独立 GLSL | 噪声波 + 光线步进 + 焦散 | ~200 行 frag (纯 ray marching) | [Shadertoy](https://www.shadertoy.com/view/Ms2SD1) |
| **afl_ext Waves** | 独立 GLSL | exp(sin) 波 + 光线步进渲染 | ~150 行 frag | [Shadertoy](https://www.shadertoy.com/view/MslBz3) |
| **Tombasche Gerstner HLSL** | 通用 HLSL | GPU Gems 标准 4 层 Gerstner + 切线/副法线 | ~60 行 HLSL | [Gist](https://gist.github.com/tombasche/49395619a28446aef8aaf9eff83a5a66) |

### 6.2 顶点着色器对比：Gerstner 波参数化

**自研** `water.vert.glsl` (L17-52)：
```glsl
const int WAVE_COUNT = 4;
uniform vec2 uWindDir[4];
const float WAVE_FREQ[4] = float[4](0.07, 0.11, 0.25, 0.3);
const float WAVE_AMP[4] = float[4](0.5, 0.4, 0.32, 0.25);
const float WAVE_SPEED[4] = float[4](0.7, 0.9, 0.5, 1.2);
// 风向联动 + 风速调制 + 双层尺度缩放
```

**Sean-Bradley/Three.js GerstnerWave 函数**：
```glsl
uniform vec4 waveA, waveB, waveC; // xy=方向, z=steepness, w=wavelength
vec3 GerstnerWave(vec4 wave, vec3 p) {
    float steepness = wave.z;
    float wavelength = wave.w;
    float k = 2.0 * PI / wavelength;
    float c = sqrt(9.8 / k);  // ← 物理色散关系
    float a = steepness / k;  // ← 振幅由 steepness 自动推导
    ...
}
```

**GPU Gems 标准实现 (Tombasche)**：
```hlsl
float3 GerstnerWave(float3 position, float steepness, float wavelength,
                    float speed, float direction, inout float3 tangent, inout float3 binormal) {
    float2 d = normalize(float2(cos(PI * direction), sin(PI * direction)));
    float k = 2 * PI / wavelength;
    float f = k * (dot(d, position.xz) - speed * _Time.y);
    float a = steepness / k;
    // 同时输出 tangent/binormal，用于精确法线重建
    tangent += float3(-d.x*d.x*(steepness*sin(f)), d.x*(steepness*cos(f)), -d.x*d.y*(steepness*sin(f)));
    binormal += float3(-d.x*d.y*(steepness*sin(f)), d.y*(steepness*cos(f)), -d.y*d.y*(steepness*sin(f)));
    return float3(d.x*(a*cos(f)), a*sin(f), d.y*(a*cos(f)));
}
```

**差异分析：**

| 维度 | 自研 | Sean-Bradley | GPU Gems 标准 | 改进建议 |
|------|------|-------------|--------------|---------|
| 色散关系 | 无（硬编码 freq/speed） | `c = sqrt(9.8/k)` | `speed` 参数传入 | **P0: 引入色散关系** — 波速与波长自动耦合，物理正确 |
| 振幅推导 | 独立 WAVE_AMP | `a = steepness/k` | `a = steepness/k` | **P1: steepness 模式** — 可选，与现有振幅模式共存 |
| 陡度控制 | 无单独陡度 | steepness 统一控陡度 | steepness 统一控陡度 | **P2: 增加 steepness 参数** — 控制波峰尖锐度 |
| 方向控制 | 风向联动 + 4 层偏移 | 固定 vec4 传入 | 方向角参数 | 自研胜出（舞台场景需要） |
| 法线输出 | 中心差分（紧凑） | 无（Three.js 自动） | tangent/binormal 精确 | 自研够用，暂不改进 |

**改进方案（P0: 色散关系）：**

在 `water.vert.glsl` 中，将 WAVE_SPEED 改为由色散关系推导：

```glsl
const float G = 9.8; // 重力常数
// 可选：色散模式开关（0=旧版硬编码, 1=物理色散）
uniform float uDispersionMode;

// 在循环中
float k = 2.0 * PI / (1.0 / WAVE_FREQ[i]); // 波长 = 1/freq
float c = mix(WAVE_SPEED[i], sqrt(G / k), uDispersionMode);
```

同时 TS 端 `_GERSTNER_WAVE_SPEED` 常量保留作为旧版 fallback。

### 6.3 片段着色器对比：膨胀度 vs 专注度

**自研 fragment shader 主线** (`water.frag.glsl` L120-337) — 16 个效果子系统串联：
```
main() 执行顺序：
1. 法线方向修正（facing check）
2. 高频法线扰动（双层纹理 + 低频滚动层）
3. 环境贴图反射 + 平面反射（5-tap blur）
4. 泡沫计算（波高阈值）
5. 菲涅尔
6. 天空-水色联动
7. 光照联动（太阳角度压制）
8. 波高调制水色
9. 焦散（双层采样 + 梯度法线扰动 + 亮度叠加）
10. Sun Glitter（法线微扰 + hash 概率）
11. 泡沫混合
12. 涟漪（1024 循环）
13. 水面雾
14. 地平线淡出
15. 水下雾
16. 透明度混合 + 色调映射
```

**Sean-Bradley/Three.js fragment shader 主线** — 5 个效果：
```
main() 执行顺序：
1. 噪声法线采样（4 层 UV 滚动）
2. 太阳高光（Phong specular）
3. 反射纹理采样（UV 畸变）
4. 菲涅尔混合
5. 简单雾
```

**99-Knots/SimpleBabylon fragment shader** — 1 个效果：
```
1. Phong 着色（法线来自顶点导数）
```

**差异统计：**

| 指标 | 自研 | Sean-Bradley | 99-Knots |
|------|------|-------------|----------|
| fragment 行数 | **337 行** | ~80 行 | ~30 行 |
| 效果子系统数 | 16 | 5 | 1 |
| uniform 数量 | **57 个** | ~15 个 | ~8 个 |
| 纹理采样次数 | 8-12 次 | 5-6 次 | 0 次 |
| 循环结构 | 涟漪 1024 次 | 无 | 无 |

**建议：** 不要削减功能，而是**给每个效果更多代码空间**。当前 337 行要处理 16 种效果，平均每种只有 21 行。改善方向：

- **P1: 涟漪 1024 循环** — 当前上限 1024 但实际只用几个。改为动态上限（`min(uRippleCount, 256)`），或直接移除循环（涟漪在舞台场景中极少使用，可改为可选的 RTT 叠加）
- **P2: 5-tap 反射模糊** — 5 次纹理采样换轻微模糊，性价比低。改为可选的 3-tap 或直接使用 RT 的 mipmap 采样
- **P3: 焦散与法线采样合并** — 焦散纹理和法线纹理可用同一张纹理的不同通道，减少采样次数

### 6.4 法线系统对比：纹理层数 vs 质量

**自研法线系统**（3 层来源）：
```
1. Gerstner 导数法线（几何法线，从顶点着色器插值，低频）
2. 程序化纹理法线（1024x1024，6 层 octave value noise，双层 UV 滚动）
3. 低频滚动法线层（大尺度光带，第三层纹理采样）
```

**Sean-Bradley 法线系统**（1 层来源）：
```
1. 噪声纹理采样（4 层 UV 滚动，xz 分量缩放 1.5x）
```

**关键问题：**

自研的 6 层 octave value noise 在 CPU 生成，写入 1024x1024 纹理，再在 GPU 采样 3 次（双层 + 低频层）。相比之下，Sean-Bradley 只用 1 张 256x256 噪声纹理，采样 4 次 UV 滚动再加权平均，视觉上更自然。

**原因：** value noise 的频谱分布是低频主导的，叠加 6 层 octave 后仍然偏向平滑。而噪声纹理（如 Perlin 噪声或蓝噪声贴图）的频谱分布更均匀，产生的法线扰动更丰富。

**改进方案（P1: 纹理质量提升）：**

```glsl
// 当前（自研）：
vec3 n1 = texture2D(uDetailNormalTex, nUV1).rgb * 2.0 - 1.0;
vec3 n2 = texture2D(uDetailNormalTex, nUV2).rgb * 2.0 - 1.0;
vec3 detailNormal = normalize(n1 + n2 * 0.5 + n3 * uLowFreqNormalStrength);

// 改进（参考 Sean-Bradley 4 层 UV 滚动）：用 2 张不同纹理降低重复感
vec3 n1 = texture2D(uDetailNormalTex, nUV1).rgb * 2.0 - 1.0;
vec3 n2 = texture2D(uDetailNormalTex2, nUV2).rgb * 2.0 - 1.0; // 第二张纹理
vec3 n3 = texture2D(uDetailNormalTex, nUV3).rgb * 2.0 - 1.0; // 第三层 UV
vec3 detailNormal = normalize(n1 + n2 + n3);
```

或者更简单：**用高质量的法线贴图替换程序化生成**。预制的海浪法线贴图（如来自 Unity 资源商店或 Substance Designer 导出的法线贴图）的细节丰富度远超 6 层 value noise。

### 6.5 焦散系统对比：伪焦散 vs 纹理解析度

**自研焦散** (`water.frag.glsl` L230-259)：
```glsl
// 层1：主焦散（scale 0.15，cell ≈ 6.7 单位）
vec2 cuv1 = camXZ * 0.15 + uCausticOffset;
float c1 = texture2D(uCausticTex, cuv1).r;
// 层2：次焦散（2x scale + 旋转30° + 反向慢速滚动）
vec2 cuv2 = vec2(camXZ.x * 0.866 - camXZ.y * 0.5, ...) * 0.3;
float c2 = texture2D(uCausticTex, cuv2).r;
float caustic = c1 * 0.6 + c2 * 0.4;
// 焦散梯度 → 法线扰动
// 焦散亮度叠加
```

**davidar/water (Seascape) 焦散**：
```glsl
// 光线步进渲染焦散：通过追踪水面下光线路径计算焦散聚焦
// 真正的焦散是光线穿过水面折射后的自然结果
```

**分析：** 自研的焦散本质上是一个**亮度叠加图案**，不是物理焦散。但这对舞台场景是合理的——视觉上有光斑效果就够了。问题在于**焦散纹理质量**。

**改进方案（P2: 焦散纹理质量）：**

当前焦散纹理由 `env-caustics.ts` 的 `causticsController` 管理。建议：

1. 将焦散纹理从 256px 提升到 512px（或更高分辨率）
2. 用程序化生成更复杂的焦散图案（如 Worley 噪声+正弦干涉）
3. 增加第三层超精细焦散（scale 0.05，小尺度细节）

```glsl
// 改进：增加第三层微焦散
vec2 cuv3 = camXZ * 0.05 + uCausticOffset * 0.3;
float c3 = texture2D(uCausticTex, cuv3).r;
float caustic = c1 * 0.5 + c2 * 0.3 + c3 * 0.2;
```

### 6.6 泡沫系统对比：阈值 vs 湍流细节

**自研泡沫** (`water.frag.glsl` L184-191)：
```glsl
float foamH = vHeight - waterLevel;
float waveHeightScale = 1.0 + waveHeight * 1.0;
float foamStart = foamThreshold * waveHeightScale;
float foamEnd = foamStart + foamTransitionRange * (1.0 + waveHeight * 0.5);
float foam = smoothstep(foamStart, foamEnd, foamH);
foam = clamp(foam, 0.0, 1.0);
```

**差距：** 自研泡沫仅基于**波高阈值**，没有以下细节：
- 泡沫纹理噪声扰动（泡沫边缘有锯齿状细节）
- 次级泡沫（主泡沫外围的细小泡沫）
- 泡沫生命周期（泡沫随时间消散）
- 风向驱动的泡沫堆积

**改进方案（P2: 泡沫噪声扰动）：**

```glsl
// 改进：泡沫边缘加噪声扰动
float foam = smoothstep(foamStart, foamEnd, foamH);
// 用法线纹理的 R 通道作为泡沫噪声
float foamNoise = texture2D(uDetailNormalTex, camXZ * 0.1 + wavePhase * 0.02).r;
foam = clamp(foam + (foamNoise - 0.5) * 0.3, 0.0, 1.0);
// 次级泡沫：波高略低于阈值时也有微量泡沫
float secondaryFoam = smoothstep(foamEnd * 0.7, foamEnd * 0.9, foamH) * 0.3;
foam = max(foam, secondaryFoam);
```

### 6.7 Sun Glitter 对比：法线微扰 vs 概率闪烁

**自研 Sun Glitter** (`water.frag.glsl` L273-288)：
```glsl
if (uGlintStrength > 0.0) {
    vec3 glintReflect = reflect(-viewDir, normalize(normal + n1 * uDetailNormalStrength * 0.8));
    vec2 glitterUV = vWorldPos.xz * uGlintScale + time * uGlintSpeed;
    float spark = hash12(floor(glitterUV));
    float spec = pow(max(dot(glintReflect, normalize(lightDir)), 0.0), uGlintPower);
    float glitter = step(0.82, spark) * spec * uGlintStrength * glintWeight;
    color += lightColor * glitter;
}
```

**分析：** 自研的 Glitter 实现已经比较成熟——法线微扰 + hash 概率 + 窄域 specular。但有一个问题：**hash 概率是静态的**（基于世界坐标位置），导致闪烁点位置固定，不随波浪移动。

**改进方案（P1: 动态闪烁点）：**

```glsl
// 改进：hash 位置随波浪偏移
vec2 glitterUV = (vWorldPos.xz + vWaveOffset * 50.0) * uGlintScale + time * uGlintSpeed;
// 或者用时间扰动 hash 种子
float spark = hash12(floor(glitterUV + fract(time * 0.1)));
```

### 6.8 涟漪系统：性能优化

**自研涟漪** (`water.frag.glsl` L294-305)：
```glsl
for (int i = 0; i < 1024; i++) {
    if (i >= uRippleCount) break;
    // ... calcRipple 调用
}
```

**问题：** 循环上限 1024，但实际使用中涟漪数量通常低于 10 个。每次循环都做 `if (i >= uRippleCount) break;` 判断。

**改进方案（P1: 动态循环上限）：**

```glsl
// 改进：用 uniform 控制循环上限，避免 1024 次空转
uniform int uRippleMax;
for (int i = 0; i < 256; i++) { // 硬上限 256
    if (i >= uRippleMax) break;
    // ...
}
```

TS 端同步设置 `uRippleMax = min(uRippleCount, 256)`。

### 6.9 反射采样：5-tap blur 替代方案

**自研反射模糊** (`water.frag.glsl` L167-175)：
```glsl
vec2 blurOff = vec2(0.004, 0.0);
vec3 planarRefl = (
    texture2D(reflectionTexture, reflUV).rgb +
    texture2D(reflectionTexture, reflUV + blurOff).rgb +
    texture2D(reflectionTexture, reflUV - blurOff).rgb +
    texture2D(reflectionTexture, reflUV + blurOff.yx).rgb +
    texture2D(reflectionTexture, reflUV - blurOff.yx).rgb
) * 0.2;
```

**分析：** 5 次纹理采样做简单的 box blur。如果 RT 有关联 mipmap（`textureLod`），用 mipmap 做模糊更高效。

**改进方案（P2: mipmap 采样）：**

```glsl
// 改进：用 mipmap level 控制模糊程度
// 需要 reflectionTexture 启用 generateMipMaps
float mipLevel = 1.0; // 根据距离或设置
vec3 planarRefl = texture2DLodEXT(reflectionTexture, reflUV, mipLevel).rgb;
// 如果硬件不支持 texture2DLodEXT，退回到 3-tap
```

### 6.10 各功能改进优先级总表

| 优先级 | 功能 | 改进内容 | 改动范围 | 预期收益 | 代码量 |
|--------|------|---------|---------|---------|-------|
| **P0** | Gerstner 色散关系 | 引入 `c = sqrt(g/k)` | vert + TS 常量 | 波物理真实感提升 | ~10 行 |
| **P1** | 涟漪循环上限 | 从 1024 降到 256 | frag 数值 | 着色器编译/执行效率 | ~2 行 |
| **P1** | Sun Glitter 动态 | 闪烁位置随波浪移动 | frag 2 行 | 闪烁更自然 | ~2 行 |
| **P1** | 法线纹理质量 | 使用预制法线贴图或 2 张纹理 | TS 纹理生成 | 法线细节丰富度提升 | ~30 行 |
| **P2** | 反射 5→3 tap | 减少采样次数，可选 mipmap | frag + TS RT 配置 | 性能提升 ~40% 反射开销 | ~5 行 |
| **P2** | 焦散三层 | 增加第三层微焦散 | frag + TS | 焦散细节提升 | ~5 行 |
| **P2** | 泡沫噪声扰动 | 泡沫边缘加噪声 + 次级泡沫 | frag ~10 行 | 泡沫更自然 | ~10 行 |
| **P3** | 着色器 uniform 减负 | 合并冗余参数，删除未用 uniform | TS `_syncWaterUniforms` | 维护性提升 | ~50 行 |
| **P3** | 焦散纹理升级 | 512px + Worley 噪声 | TS 纹理生成 | 焦散视觉提升 | ~30 行 |
| **P4** | CPU 波高采样 | 暴露 CPU 侧波高计算接口 | TS 新函数 | 模型浮力交互 | ~50 行 |

### 6.11 代码对比总结

**自研不是"功能不及前人"，而是"设计哲学不同"导致的取舍：**

| 方面 | 自研 | 开源项目 | 适用场景 |
|------|------|---------|---------|
| 功能广度 | 16 种效果，一站全包 | 3-5 种，极致精简 | 自研适合舞台多样化 |
| 每个效果深度 | 60-70 分 | 80-90 分 | 开源适合场景单一 |
| 代码可维护性 | 低（337 行 frag + 57 uniform） | 高（30-80 行） | 需改善 |
| 性能开销 | 高（8-12 纹理采样 + 涟漪循环） | 低（5-6 纹理采样） | 舞台场景可接受 |
| 可配置性 | 极高（57 个 uniform 全可调） | 低-中（固定参数） | 自研胜出 |

**归根结底：** 自研水体的 337 行 fragment shader 试图在一个 pass 里完成 16 种效果，而同类项目通常只做 3-5 种。自研在"功能广度"上远超同类，但每个效果的"深度打磨"不够，因为代码量被 16 个效果子系统摊薄了。

**改进策略不是"加功能"，而是"把已有的 16 种效果逐一打磨，给每个效果更多代码空间"。**