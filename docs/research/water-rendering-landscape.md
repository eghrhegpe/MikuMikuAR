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