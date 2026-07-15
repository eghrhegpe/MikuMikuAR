# ADR-115: 风格化水体竞品调研与波光粼粼增强方向

> **状态**: 规划（调研，暂无实施排期）— 本 ADR 为技术对比与方向评估，不锁定具体实现 PR。
> **背景**: 评审了某竞品（风格化水体）的水系统截图，其设计思路与我方自研 Gerstner 物理水面（ADR-062 / `frontend/src/scene/env/env-water.ts`）完全不同：对方以「少参数、强预设、重法线」的美术水体路线实现"波光粼粼"，而我方以「多参数、强物理、重波形」的可控路线实现。本文档记录参数映射、技术拆解、差异对比与可借鉴方向，供后续增强水面视觉效果时拍板。
> **范围**: 仅水面视觉风格与交互复杂度对比；不涉及反射 RT 重构（ADR-062）、地面反射（ADR-114）等已立项工作。

---

## 一、竞品水系统参数映射

截图 UI 仅 9 项，语义明确、预设驱动。逐条翻译为我方技术术语：

| 竞品参数 | 技术含义 | 我方对应项 |
|----------|----------|------------|
| 类型：河流 | 预设模板（河流/海洋/池塘），一键切换法线贴图 + 波长集 | `WATER_PRESETS`（平静/涟漪/海浪/风暴/热带，`env-water.ts:1049`） |
| 高度 0.400 | 水面 Y 高度 | `waterLevel`（`types.ts:424`） |
| 波纹 3.000 | 小尺度高频法线扰动强度（制造细碎反光） | **无直接对应**；我方用 `waterWaveHeight` 统一控制 Gerstner 波高 |
| 大波 30.00 | 大尺度低频波浪/位移强度 | `waterWaveHeight`（`types.ts:428`），但对方量程更大、偏美术夸张 |
| 折射最大距离 0.350 | 折射/透射有效距离（水面下景物扭曲范围） | **无直接对应** |
| 吸收距离 5.000 | 水体颜色按 Beer-Lambert 吸收的距离 | 接近 `waterFogDensity` / `waterTransparency` |
| 焦散 0.500 | 水下焦散强度 | 我方程序化焦散，强度固定 `uCausticIntensity=0.15`（`env-water.ts:547`），未暴露 |
| 吸收倍数 2.000 | 颜色吸收系数（越深越偏水色） | **无直接对应** |
| 有效范围 0.100 | 波浪/效果影响范围或地平线衰减范围 | 接近 `waterSize`（`types.ts:429`） |

**关键观察**：
- 竞品把"波纹/大波"拆成**两层独立尺度**（高频法线 + 低频波形），而非我方单一 `waterWaveHeight`。
- 截图 2（类型：海洋）显示水面与远处地平线融合，说明存在**地平线淡出/无限水体**处理。
- 星空被反射在水面，说明反射源是**cubemap 环境贴图**（场景 `environmentTexture`），而非平面反射 RT。

---

## 二、"波光粼粼"技术拆解

竞品水面亮点并非来自复杂波形，而是以下四项组合：

1. **法线贴图扰动（Normal Map）**
   - 两张/多张法线贴图以不同速度滚动，制造高频表面起伏。
   - 法线变化使太阳光/环境光在微小 fragment 上产生快速变化的镜面高光 —— 这是"波光"主来源。

2. **Sun Glitter / 高光闪烁**
   - fragment shader 中按 `normal`/`lightDir`/`viewDir` 计算窄域 specular highlight。
   - 叠加时间噪声或随机纹理，使亮点闪烁而非稳定一片。

3. **反射 + Fresnel**
   - 边缘用 Fresnel 反射天空/环境；中心看透射 + 焦散。
   - 平面反射 RT 可反射场景物体，形成动态高光。

4. **焦散（Caustics）**
   - 水下光斑滚动，强化"水在动"的感知。

### 2.5 地平线扩展与星空反射

新增截图（类型：海洋）显示两个关键特征：

1. **水面延伸至地平线**
   - 通常不是单张无限大平面，而是：
     - **远距离 LOD 降级**：近处高细分，远处用低细分或 billboard 平面。
     - **地平线雾/颜色融合**：远处水面与天空颜色通过雾统一，消除硬边。
     - **径向边缘淡出**：类似我方 `groundEdgeFade`，但作用于水面。
   - 实现成本低，且能改善"方块水面"感。

2. **反射星空贴图**
   - 水面反射的是环境 cubemap（`scene.environmentTexture`），即天空盒/星空球。
   - 这是**环境反射**，我方当前在 `WATER_FRAG_SRC` 中已采样 `envTexture`（当 `ENV_TEXTURE` define 启用时），但受限于：
     - 需要环境贴图已设置（ADR-024 ReflectionProbe 提供）。
     - 我方水面默认可能未启用/不明显。
   - 对方效果强的原因：天空-水面-雾统一 color grading，反射率与 Fresnel 调得高。

3. **水光联动**
   - 天空颜色/时间变化自动驱动水面颜色与反射。
   - 我方可通过让 `waterColor`/`waterFogColor` 从天空色派生，或加强 `envIntensity` 调制来实现类似联动。

**结论**：波光粼粼 = 高频法线 + specular glitter + 动态反射 + 焦散；
**地平线/星空感 = 无限水体 + 环境 cubemap 反射 + 天空-水面统一颜色分级**。

---

## 三、与我方系统的核心差异

| 维度 | 竞品系统 | 我方系统 |
|------|----------|----------|
| 设计哲学 | 风格化、美术预设驱动 | 物理程序化、参数可精细微调 |
| 波浪实现 | 法线贴图/高度图叠加 | 自研 Gerstner 顶点/片元着色器（`WATER_VERT_SRC`/`WATER_FRAG_SRC`） |
| 参数数量 | 9 个，语义明确 | 20+，覆盖颜色/泡沫/水下/反射/Fresnel 等 |
| 波光粼粼 | 靠法线贴图 + specular 直接出 | 靠 Gerstner 法线 + 涟漪 + 焦散，缺高频 glitter |
| 焦散 | 单一滑块暴露 | 程序化生成，强度固定 0.15，未暴露 UI |
| 反射 | 默认开启的简单混合 | 可选平面反射 RT（高/中/低/关，ADR-062） |
| 地平线扩展 | 无限水体 + 边缘雾融合 | `waterSize` 有限方形，远处硬边 |
| 环境反射/星空联动 | cubemap 环境反射强，天空-水色统一 | 已采样 `envTexture`，但强度受环境贴图与 `envIntensity` 限制 |
| 泡沫 | UI 未暴露 | 独立阈值/强度/透明度三参数 |
| 水下 | UI 未暴露 | 完整雾 + 色调 + 色散后处理（`updateUnderwaterTransition`） |

---

## 四、可借鉴方向（代码级建议）

### 4.1 在 shader 加入高频法线扰动层（P1，低成本）
在 `WATER_FRAG_SRC` 中叠加一张噪点法线贴图采样（独立于 Gerstner 法线）：

```glsl
uniform sampler2D uNormalTex;
uniform float uNormalStrength;

vec2 nUV1 = vWorldPos.xz * 0.1 + time * 0.05;
vec2 nUV2 = vWorldPos.xz * 0.3 - time * 0.08;
vec3 n1 = texture2D(uNormalTex, nUV1).rgb * 2.0 - 1.0;
vec3 n2 = texture2D(uNormalTex, nUV2).rgb * 2.0 - 1.0;
normal = normalize(normal + (n1 + n2) * uNormalStrength);
```
需配套：法线贴图资源（可在 `createCanvasTexture` 程序化生成或引入贴图）、`uNormalTex`/`uNormalStrength` uniform 与 `EnvState` 字段。

### 4.2 加入 Sun Glitter 项（P1）
```glsl
float spec = pow(max(dot(reflectDir, lightDir), 0.0), 128.0);
float glitter = spec * noise(vWorldPos.xz * 50.0 + time);
color += lightColor * glitter * uGlintStrength;
```

### 4.3 焦散强度暴露给用户（P2，极低风险）
将 `env-water.ts:547` 的 `mat.setFloat('uCausticIntensity', 0.15)` 改为读 `state.causticIntensity`，并在 `EnvState`（`types.ts`）与水面 UI（`env-feature-levels.ts` 的 `buildWaterLevel`）增加滑块。

### 4.4 UI 预设化（P2，交互优化）
顶层以"类型：河流/海洋/池塘"驱动，默认仅显示：类型、高度、波纹、大波、焦散、有效范围；其余（Fresnel/泡沫/水下/反射）收进"高级"折叠组。复用现有 `addSliderRow`/`headerToggle` 与 `WATER_PRESETS` 体系，不引入新 UI 范式。

### 4.5 无限水面 + 地平线雾融合（P3，地平线视觉）
解决我方水面"方块硬边"问题：
- 把现有 3 级 LOD（`meshHigh`/`meshMid`/`meshLow`，`env-water.ts:697-699`）扩展到更大尺寸，或新增第 4 级远景平面。
- 在 shader 中加入**径向边缘雾/透明度衰减**：
  ```glsl
  float radialDist = length(vWorldPos.xz - cameraPosition.xz);
  float horizonFade = 1.0 - smoothstep(horizonStart, horizonEnd, radialDist);
  color = mix(skyColor, color, horizonFade);
  alpha *= horizonFade;
  ```
- 或复用场景雾（`scene.fogMode`/`scene.fogColor`）统一远处融合，无需额外 shader 代码。

### 4.6 天空-水面颜色联动（P3，氛围统一）
- 在 `env-water.ts` 的 `_syncWaterUniforms` 或每帧 observer 中，让 `waterColor`/`waterFogColor` 从天空色（`skyColorBot` 或 `envTexture` 平均色）派生一定比例。
- 增加一个 `waterSkyColorBlend` 参数（0=完全自定义，1=完全跟随天空），默认 0.3 左右。
- 此改动与 ADR-024 的环境/天空系统天然联动，不引入新依赖。

---

## 五、实施路径与排序

| 阶段 | 内容 | 难度 | 收益 |
|------|------|------|------|
| P1 | shader 高频法线扰动层 + Sun Glitter 项 | 中（需法线资源 + uniform 接入） | 高（直接出波光粼粼） |
| P2 | 焦散强度 UI 暴露 + 水面 UI 预设化折叠 | 低 | 中（可调性 + 降低面板复杂度） |
| P3 | 无限水面 + 地平线雾融合 + 天空-水面颜色联动 | 中 | 高（解决方块硬边、强化氛围统一） |
| P4 | "波纹/大波"双层尺度拆分（替代单一 waveHeight） | 中 | 中（更贴近竞品手感，需重测预设） |

**决策待定项**：
- 是否引入法线贴图资源，还是程序化生成（影响体积与依赖）。
- "波纹/大波"拆分是否破坏现有 `WATER_PRESETS` 兼容性（P3 需回归 5 个预设）。

---

## 六、风险与取舍

| 风险 | 说明 | 缓解 |
|------|------|------|
| 性能 | 额外法线贴图采样 + glitter 噪声增加 fragment 开销 | 复用现有 RT/纹理预算；移动端默认低强度 |
| 视觉一致性 | 法线扰动与 Gerstner 法线叠加可能 double-count | 调参时以实测为准，必要时降低 Gerstner 波高贡献 |
| 过度仿制 | 竞品走"美术夸张"路线，我方用户群更重视"物理可控" | 仅借鉴波光手段，不削弱现有参数体系 |
| 资源依赖 | 法线贴图引入外部资产 | 优先程序化生成，避免新增 bundled 资源 |

---

## 七、相关 ADR 索引

- [ADR-062](adr-062-water-reflection-render-target.md) — 水面反射 RT（本 ADR 不改动其架构）
- [ADR-114](adr-114-ground-reflection-enhancement.md) — 地面反射增强（平面反射引擎共用）
- [ADR-026](adr-026-environment-system-enhancement.md) — 环境系统增强（水面子系统所属）

---

## 八、结论

竞品是「少参数、强预设、重法线」的美术水体；我方是「多参数、强物理、重波形」的可控水体。波光粼粼技术门槛低，核心是**高频法线 + specular glitter + 反射/焦散**组合；地平线/星空感则来自**无限水体 + 环境 cubemap 反射 + 天空-水面统一颜色分级**。建议优先以 P1（法线扰动 + glitter）补强视觉，P2 暴露焦散并预设化 UI，P3 解决无限水面与颜色联动，P4 再评估"波纹/大波"双层拆分。是否进入实施，待架构评审拍板。
