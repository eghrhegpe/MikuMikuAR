# ADR-115: 风格化水体竞品调研与波光粼粼增强方向

> **状态**: 规划（调研 → 方案已优化）— P2 排期就绪、P1 待资源解锁；尚未进入实施 PR。本 ADR 为技术对比与方向评估，不锁定具体实现。
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

### 4.1 在 shader 加入高频法线扰动层（P1，待资源解锁）
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

> ⚠️ **涟漪系统兼容性（P1 实施前置）**：当前 `env-water.ts:374/479-482` 已有 `rippleNormalStrength`/`rippleGlintStrength` 涟漪法线（由 `addRipple` 注入），同样在高频段修改 `normal`。新增法线层若直接相加，两者高频扰动叠加会产生**莫尔纹**。P1 实施前须确认新法线层与涟漪法线是**叠加还是替换**；建议按 `rippleSum` 加权融合或仅在 `abs(rippleSum) < eps` 时启用新层（见 §六）。

### 4.2 加入 Sun Glitter 项（P1，待资源解锁）
```glsl
float spec = pow(max(dot(reflectDir, lightDir), 0.0), 128.0);
float glitter = spec * noise(vWorldPos.xz * 50.0 + time);
color += lightColor * glitter * uGlintStrength;
```

> ✅ **光照数据可用性（已核实）**：`WATER_FRAG_SRC` 中 `uniform vec3 lightDir;`（`env-water.ts:364`）已存在，并由 `mat.setVector3('lightDir', dirLight.direction)`（`:536`，无方向光时 fallback `(-0.5,-1,-0.5)` 见 `:539`）传入。Sun Glitter 可直接复用 `lightDir`，**无需新增光照数据通路**——原「可能未传入方向光方向」担忧已化解。

### 4.3 焦散强度暴露给用户（P2，优先排期）
将 `env-water.ts:547` 的 `mat.setFloat('uCausticIntensity', 0.15)` 改为读 `state.causticIntensity`，并在 `EnvState`（`types.ts`）与水面 UI（`env-feature-levels.ts` 的 `buildWaterLevel`）增加滑块。

### 4.4 UI 预设化（P2，优先排期）
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
- 增加一个 `waterSkyColorBlend` 参数（0=完全自定义/不联动，1=完全跟随天空），**默认 0（不联动）**——避免覆盖用户已手动调好的水色。
- 此改动与 ADR-024 的环境/天空系统天然联动，不引入新依赖。

---

## 五、实施路径与排序（优化版）

按「成本-收益-可行性」重新排序：**P2 成本最低、收益明确、零资源依赖 → 立即排期**；**P1 视觉收益高但被法线资源门槛与 double-count 风险卡住 → 先解决资源与去重再实施**；P3/P4 留作后续评估。

| 优先级 | 阶段 | 内容 | 可行性 | 成本 | 收益 | 状态 |
|--------|------|------|--------|------|------|------|
| ① 立即 | P2 | 焦散强度 UI 暴露 + 水面 UI 预设化折叠 | 高（仅状态链路 + 滑块） | 低 | 中（可调性 + 降低面板复杂度） | 可立即实施 |
| ② 待解锁 | P1 | shader 高频法线扰动层 + Sun Glitter 项 | 中（需法线资源：程序化 or 外部） | 中 | 高（直接出波光粼粼） | 阻塞于资源与去重 |
| ③ 后续 | P3 | 无限水面 + 地平线雾融合 + 天空-水面颜色联动 | 中 | 中 | 高（解决方块硬边、强化氛围） | 待 P2 完成后评估 |
| ④ 后续 | P4 | "波纹/大波"双层尺度拆分 | 中 | 中 | 中（贴近竞品手感，需重测预设） | 待定 |

**P1 解锁前置条件（必须先解决）**：
1. **法线资源来源**：程序化生成（`createCanvasTexture` 噪声法线）or 引入贴图。优先程序化，避免新增 bundled 资源依赖。
2. **Gerstner 去重**：法线扰动与现有 Gerstner 法线叠加存在 double-count 风险（见 §六）。须明确分工——Gerstner 负责大尺度波向、法线贴图仅接管高频细节（或降低 Gerstner 高频段波高贡献），实测校准后方可合入。
3. **涟漪系统兼容性**：确认新法线层与现有 `addRipple` 涟漪法线（`env-water.ts:374/479-482`）是叠加还是替换；两者均在高频段改 `normal`，直接相加产生莫尔纹，须做加权融合或条件启用（见 §六）。

---

## 六、风险与取舍

| 等级 | 风险 | 说明 | 缓解 / 决策 |
|------|------|------|------------|
| 🔴 P1 阻塞 | 法线与 Gerstner 叠加 double-count | 我方水面法线已含 Gerstner 波形贡献；再叠一层法线贴图扰动，高频段会与 Gerstner 法线重复累积，导致"波浪过密/高光发糊"而非干净波光 | **P1 实施前置条件**：分层——Gerstner 掌大尺度波向，法线贴图仅接高频细节；或降 Gerstner 高频段贡献，实测校准后合入 |
| 🟡 P1 | 法线扰动与涟漪系统冲突（莫尔纹） | `env-water.ts:374/479-482` 已有 `rippleNormalStrength`/`rippleGlintStrength` 涟漪法线（由 `addRipple` 注入），与新增高频法线层均在高频段改 `normal`，直接相加产生莫尔纹 | **P1 实施前置**：确认新法线层与涟漪是叠加还是替换；建议按 `rippleSum` 加权融合或仅 `abs(rippleSum)<eps` 时启用新层（见 §4.1 / §五） |
| 🟢 已化解 | Sun Glitter 光照方向依赖 | 原担忧 glitter 需 `lightDir` 而 shader 可能未传入方向光方向 | **已核实**：`WATER_FRAG_SRC` 中 `uniform vec3 lightDir;`（`env-water.ts:364`）已存在并由 `:536/:539` 传入方向光方向（含 fallback），可直接复用，无需新增通路 |
| 🟢 P2 | 焦散强度 UI 暴露后用户误调 | 焦散强度过高导致水下光斑过亮、失真 | 设合理上限（建议 `max ≤ 0.5`）；滑块 `max` 封顶，默认值取原硬编码 0.15 |
| 🟡 P3 | 天空-水面颜色联动破坏自定义水色 | `waterSkyColorBlend` 若默认 >0，用户手动调好的水色会被天空覆盖 | **默认值定为 0（不联动）**，用户须主动上调才生效（见 §4.6） |
| 🟡 中 | 性能 | 额外法线贴图采样 + glitter 噪声增加 fragment 开销 | 复用现有 RT/纹理预算；移动端默认低强度 |
| 🟡 中 | 资源依赖 | 法线贴图引入外部资产 | 优先程序化生成，避免新增 bundled 资源 |
| 🟢 低 | 过度仿制 | 竞品走"美术夸张"，我方用户群更重视"物理可控" | 仅借鉴波光手段，不削弱现有参数体系 |
| 🟢 低 | 预设兼容 | P4 的"波纹/大波"拆分可能破坏 `WATER_PRESETS` | P4 需回归 5 个预设 |

---

## 七、相关 ADR 索引

- [ADR-062](adr-062-water-reflection-render-target.md) — 水面反射 RT（本 ADR 不改动其架构）
- [ADR-114](adr-114-ground-reflection-enhancement.md) — 地面反射增强（平面反射引擎共用）
- [ADR-026](adr-026-environment-system-enhancement.md) — 环境系统增强（水面子系统所属）

---

## 八、结论

竞品是「少参数、强预设、重法线」的美术水体；我方是「多参数、强物理、重波形」的可控水体。波光粼粼本质是**高频法线 + specular glitter + 反射/焦散**组合；地平线/星空感则来自**无限水体 + 环境 cubemap 反射 + 天空-水面统一颜色分级**。

**优化后优先级（已拍板方案）**：
- **P2 立即排期**：焦散强度暴露 + 水面 UI 预设化，成本最低、收益明确、零资源依赖。
- **P1 待解锁**：法线扰动 + glitter 视觉收益高，但被「法线资源来源」与「Gerstner 法线 double-count」双重卡住，须先解决资源（程序化优先）与分层去重方可实施。
- **P3/P4 留待后续**：P3 解决方块硬边与氛围联动，P4 重测预设后评估。

是否进入实施 PR，待架构评审确认。
