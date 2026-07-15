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

#### 4.1.1 程序化法线贴图生成方案（零资源依赖）

采用 `createCanvasTexture` 在运行时生成 512×512 双通道噪声法线图，避免引入外部 bundled 资源。生成算法：

```typescript
// env-water.ts — ensureNormalTexture(scene, waterColor)
// 缓存为单例，随 waterColor 变化时重建
function generateNormalMap(size: number = 512): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(size, size);

    // 多层 Simplex/Value noise 叠加（octaves），
    // 用中心差分从高度图推导法线，避免直接存 RGB 法线的色彩偏移问题
    const heights = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let h = 0, amp = 1, freq = 1;
            for (let oct = 0; oct < 4; oct++) {
                h += valueNoise(x * freq / size, y * freq / size) * amp;
                amp *= 0.5; freq *= 2;
            }
            heights[y * size + x] = h;
        }
    }
    // 中心差分求法线
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const xl = heights[y * size + ((x - 1 + size) % size)];
            const xr = heights[y * size + ((x + 1) % size)];
            const yl = heights[((y - 1 + size) % size) * size + x];
            const yr = heights[((y + 1) % size) * size + x];
            const nx = (xl - xr) * 0.5;  // 水平梯度 → 法线 X
            const ny = (yl - yr) * 0.5;  // 垂直梯度 → 法线 Z（Y是上）
            const nz = 1.0;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            const i = (y * size + x) * 4;
            img.data[i]     = Math.floor((nx / len * 0.5 + 0.5) * 255);  // R → X
            img.data[i + 1] = Math.floor((ny / len * 0.5 + 0.5) * 255);  // G → Z
            img.data[i + 2] = Math.floor((nz / len * 0.5 + 0.5) * 255);  // B → Y
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}
```

**备选方案**（画布质量不足时回退）：直接在 shader 内用 `snoise()` 函数计算噪声法线，省去纹理采样但 ALU 开销更高。

#### 4.1.2 Shader 集成与参数

在 `WATER_FRAG_SRC` 中叠加两张不同尺度、不同速度的法线采样（制造视差流动感）：

```glsl
uniform sampler2D uNormalTex;
uniform float uNormalStrength;    // 整体强度，默认 0.3
uniform float uNormalTiling1;     // 第一层平铺，默认 0.1
uniform float uNormalTiling2;     // 第二层平铺，默认 0.3
uniform float uNormalSpeed1;      // 第一层滚动速度，默认 0.05
uniform float uNormalSpeed2;      // 第二层滚动速度，默认 -0.08

// —— 在 normal 计算（Gerstner 之后，涟漪之前）插入 ——
vec2 nUV1 = vWorldPos.xz * uNormalTiling1 + time * uNormalSpeed1;
vec2 nUV2 = vWorldPos.xz * uNormalTiling2 + time * uNormalSpeed2;
vec3 n1 = texture2D(uNormalTex, nUV1).rgb * 2.0 - 1.0;
vec3 n2 = texture2D(uNormalTex, nUV2).rgb * 2.0 - 1.0;
vec3 detailNormal = normalize(n1 + n2 * 0.5);  // 第二层权重减半

// 与 Gerstner 法线混合（去重策略，见 4.1.3）
float gerstnerScale = 0.7;  // Gerstner 法线衰减系数，避免大尺度波峰过陡
normal = normalize(
    normal * gerstnerScale +
    vec3(detailNormal.x * uNormalStrength, 1.0, detailNormal.y * uNormalStrength)
);
```

需配套新增 `EnvState` 字段：
- `waterNormalStrength: number`（默认 0.3，范围 0–1.5）
- 其余 tiling/speed 参数暂不暴露 UI，在预设中固定，降低面板复杂度

#### 4.1.3 Gerstner 去重策略

**问题**：我方 Gerstner 波法线已包含全频段贡献（包括高频段），再叠法线贴图会导致高频段 double-count，出现"波浪过密 / 高光发糊"。

**分层方案**（推荐）：
- **Gerstner 负责大尺度波向与形状**（保留 70% 法线强度，即 `gerstnerScale = 0.7`），衰减其高频贡献
- **法线贴图仅接管高频细节**（`uNormalStrength` 控制，默认 0.3）
- 实测校准：在 `waveHeight = 1.0`（海浪预设）下，将 Gerstner 衰减系数从 1.0 逐步降到 0.6–0.8，找到"波形感保留 + 波光细节充足"的平衡点

**简化判定**：若 `uNormalStrength == 0`，则 `gerstnerScale` 自动回到 1.0（关闭细节层时完全恢复 Gerstner 原貌），保证关闭新功能后行为零变化。

#### 4.1.4 涟漪系统兼容性（莫尔纹防护）

当前 `env-water.ts:479-482` 涟漪法线在 Gerstner 之后、焦散之前写入 `normal`，新增法线层插入**涟漪之前**，顺序为：

```
Gerstner 法线 → 高频细节法线（新增） → 涟漪法线 → 计算反射/折射
```

**加权融合策略**：涟漪激活区域自动压低细节法线强度，避免两层高扰动叠加产生莫尔纹：

```glsl
// 在涟漪计算之后，对细节法线强度做涟漪加权
float rippleInfluence = clamp(abs(rippleSum) * 2.0, 0.0, 1.0);
// rippleSum 大的地方，细节法线减弱，让涟漪主导高频
float detailBlend = mix(uNormalStrength, uNormalStrength * 0.2, rippleInfluence);
```

> 简化版（更省性能）：直接按 `rippleSum` 衰减细节法线，涟漪中心区域细节层权重降至 20%，边缘区域保持 100%。实测若莫尔纹不明显，可直接跳过防护，两层独立叠加。

### 4.2 加入 Sun Glitter 项（P1，待资源解锁）

在水面漫反射计算之后、泡沫混合之前，叠加一层随视角和光照变化的闪烁高光。

#### 4.2.1 实现方案

**噪声策略**：使用 shader 内 `hash()` 函数生成伪随机值，无需额外纹理采样（零资源依赖）。hash 函数基于屏幕空间坐标 + 时间，保证每帧闪烁但空间上连续不跳变。

```glsl
// 简易 hash 函数，返回 0-1 随机值
float hash12(vec2 p) {
    vec3 p3  = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// —— 插入位置：diffuse 之后、泡沫混合之前（env-water.ts 第 464 行之后）——
uniform float uGlintStrength;    // 整体强度，默认 0.4
uniform float uGlintPower;       // 高光锐利度，默认 96
uniform float uGlintScale;       // 噪声尺度，默认 80.0
uniform float uGlintSpeed;       // 闪烁速度，默认 2.0

// 以世界坐标 + 时间驱动噪声，模拟水面微闪
vec2 glitterUV = vWorldPos.xz * uGlintScale + time * uGlintSpeed;
float noiseVal = hash12(floor(glitterUV));
// 叠加两层不同尺度噪声，让闪烁既有大颗粒也有细闪
float noiseVal2 = hash12(floor(glitterUV * 3.7 + 13.0));
float glitterNoise = mix(noiseVal, noiseVal2, 0.3);

// 计算高光：用 reflectDir 与 lightDir 的夹角，窄域 specular
float spec = pow(max(dot(reflectDir, normalize(lightDir)), 0.0), uGlintPower);
// 乘以现有 diffuse 作为 mask：仅在迎光面闪烁
float glitterMask = diff * spec;
// 噪声调制：在高光基础上叠加随机衰减，制造"跳动"感
float glitter = glitterMask * (0.6 + 0.8 * glitterNoise) * uGlintStrength;

color += lightColor * glitter;
```

#### 4.2.2 参数定义

| uniform 变量 | `EnvState` 字段 | 默认值 | 范围 | 说明 |
|-------------|----------------|--------|------|------|
| `uGlintStrength` | `waterGlintStrength` | 0.4 | 0–2.0 | 整体闪烁强度 |
| `uGlintPower` | —（预设固定） | 96 | 32–256 | 高光锐利度，值越大光斑越小越亮 |
| `uGlintScale` | —（预设固定） | 80.0 | 20–200 | 噪声颗粒大小 |
| `uGlintSpeed` | —（预设固定） | 2.0 | 0.5–5.0 | 闪烁动画速度 |

> UI 仅暴露 `waterGlintStrength` 一个滑块（放在"基础参数"或"高级"中待定），其余参数在预设中固定，降低调节复杂度。

#### 4.2.3 与法线细节层的关系

> **架构性观察**：glitter 本质上是高频法线扰动在 specular 上的体现。如果 §4.1 的法线细节层质量足够好，`reflectDir` 本身已经包含了高频变化，自然会产生 specular 闪烁。
>
> **实施建议**：先做 §4.1 法线层，观察现有 specular（`diff` 项 + 法线扰动）是否已经产生足够的"波光粼粼"感。如果自然闪烁已达标，glitter 项可：
> - 方案 A：**省略不做**，减少 shader 复杂度
> - 方案 B：保留但默认 `uGlintStrength = 0`，作为额外微调手段
>
> 本 ADR 暂保留 glitter 项作为 P1 备选，实测后决定是否启用。

> ✅ **光照数据可用性（已核实）**：`WATER_FRAG_SRC` 中 `uniform vec3 lightDir;`（`env-water.ts:364`）已存在，并由 `mat.setVector3('lightDir', dirLight.direction)`（`:536`，无方向光时 fallback `(-0.5,-1,-0.5)` 见 `:539`）传入。Sun Glitter 可直接复用 `lightDir`，**无需新增光照数据通路**——原「可能未传入方向光方向」担忧已化解。

### 4.3 焦散强度暴露给用户（P2，优先排期）

将 `env-water.ts:547` 的 `mat.setFloat('uCausticIntensity', 0.15)` 改为读 `state.causticIntensity`，并在 `EnvState`（`types.ts`）与水面 UI（`env-feature-levels.ts` 的 `buildWaterLevel`）增加滑块。

#### 4.3.1 参数规范

| 项目 | 值 |
|------|----|
| `EnvState` 字段 | `causticIntensity: number` |
| 默认值 | `0.15`（与当前硬编码一致，零行为变化） |
| 范围 | `0 – 0.5`，步长 `0.01` |
| 滑块位置 | `env:water:basic` folder 内，`波高` 之后，`动画速度` 之前 |
| 标签 | `env.causticIntensity`（焦散强度） |
| 图标 | `lucide:sun` |

#### 4.3.2 预设同步

5 个 `WATER_PRESETS` 均补充 `causticIntensity` 字段，按预设风格差异化取值：

| 预设 | causticIntensity | 理由 |
|------|-----------------|------|
| 平静 calm | 0.1 | 水清澈但平静，焦散弱 |
| 涟漪 ripple | 0.15 | 默认值，中等强度 |
| 海浪 ocean | 0.2 | 波浪大，水下光斑更明显 |
| 风暴 storm | 0.25 | 高反差，强焦散增强戏剧感 |
| 热带 tropical | 0.2 | 热带水透亮，焦散鲜明 |

同时更新 `buildWaterPresetEnvState` 和 `applyWaterPresetToCurrent` 同步写入该字段，确保预设切换后值持久化到 `envState`（参考现有 `rippleNormalStrength` 的预设同步模式，`env-water.ts:1183-1187`）。

#### 4.3.3 状态链路变更清单（P2 焦散部分）

| 变更点 | 文件 | 说明 |
|--------|------|------|
| 新增字段 | `core/types.ts` | `causticIntensity: number`，默认 `0.15` |
| 读取状态 | `scene/env/env-water.ts` `_syncWaterUniforms` | `mat.setFloat('uCausticIntensity', state.causticIntensity)` 替换硬编码 |
| 绑定列表 | `scene/env/env-bridge.ts` | 确认 `causticIntensity` 在绑定列表中 |
| 预设定义 | `scene/env/env-water.ts` `WATER_PRESETS` | 5 个预设补充 `causticIntensity` 字段 |
| 预设映射 | `scene/env/env-water.ts` `buildWaterPresetEnvState` | 输出 `causticIntensity` |
| 预设应用 | `scene/env/env-water.ts` `applyWaterPresetToCurrent` | 写入材质 uniform |
| UI 滑块 | `menus/env-feature-levels.ts` `buildWaterLevel` | 在 basic folder 内增加 slider |
| i18n | 语言文件 | 补充 `env.causticIntensity` 键值 |
| 序列化兼容 | 场景加载 | 旧场景无此字段时取默认值 `0.15` |

### 4.4 UI 预设化（P2，优先排期）

顶层以预设 chip 驱动，默认仅显示核心 6 项参数；其余高级参数收进折叠组，降低面板复杂度。复用现有 `addSliderRow`/`headerToggle`/`folder` 与 `WATER_PRESETS` 体系，不引入新 UI 范式。

#### 4.4.1 面板分层结构

`buildWaterLevel()` 重构后的层级（由上至下）：

```
水面板
├── 预设 chip 行（5 个：平静 / 涟漪 / 海浪 / 风暴 / 热带）
├── 基础参数「展开」（默认展开，6 项核心）
│   ├── 水面高度（waterLevel）
│   ├── 水面范围（waterSize）
│   ├── 波高（waterWaveHeight）
│   ├── 动画速度（waterAnimSpeed）
│   ├── 焦散强度（causticIntensity） ← 新增
│   └── 水色（waterColor）
├── 颜色与雾「折叠」（默认折叠）
│   ├── 透明度（waterTransparency）
│   ├── 雾色（waterFogColor）
│   └── 雾密度（waterFogDensity）
├── 泡沫「折叠」（默认折叠）
│   ├── 泡沫阈值（foamThreshold）
│   ├── 泡沫强度（foamIntensity）
│   └── 泡沫透明度（foamOpacity）
├── 高级参数「折叠」（默认折叠，原 basic 中非核心项 + 所有杂项）
│   ├── Fresnel 偏移（fresnelBias）
│   ├── Fresnel 幂次（fresnelPower）
│   ├── Fresnel Alpha 影响（fresnelAlphaInfluence）
│   ├── 漫反射强度（diffuseStrength）
│   ├── 环境强度（ambientStrength）
│   ├── 泡沫过渡范围（foamTransitionRange）
│   ├── 涟漪法线强度（rippleNormalStrength）
│   ├── 涟漪光泽强度（rippleGlintStrength）
│   ├── 焦散颜色1（causticColor1）
│   ├── 焦散颜色2（causticColor2）
│   ├── 焦散滚动 X（causticScrollX）
│   ├── 焦散滚动 Y（causticScrollY）
│   ├── 雾不透明度影响（waterFogOpacityInfluence）
│   └── 水面翻转（waterFlip）
├── 反射「折叠」（默认折叠，已有）
└── 水下效果「折叠」（默认折叠，已有）
```

#### 4.4.2 设计原则

- **核心参数 ≤ 8 项**：默认展开的"基础参数"控制在 6–8 项，一屏可见，减少滚动
- **预设 chip 置顶**：5 个预设按钮（preset-chip 样式，28px 高）放在面板最顶端，作为"快速入口"
- **折叠组用 folder 组件**：复用现有 `folder` kind（带箭头展开/收起），不新增 `headerToggle`
- **功能分组清晰**：颜色/泡沫/高级/反射/水下，每类 3–7 项，既不太碎也不太满
- **P1 新参数接入位置**：`waterNormalStrength` 和 `waterGlintStrength`（P1 做了之后）放入"基础参数"，放在"焦散强度"之后，保持核心参数区 8 项以内

#### 4.4.3 现有 UI 迁移映射

| 当前位置 | 迁移后位置 | 说明 |
|----------|-----------|------|
| `env:water:presets` custom | 面板最顶端（独立行） | 预设 chip 从 folder 中移出，置顶 |
| `env:water:colorF` folder | 颜色与雾 folder | 合并 waterColor 到基础参数，雾色/密度单独成组 |
| `env:water:basic` folder | 基础参数 folder（默认展开） | 仅保留 6 项核心，其余迁出 |
| 高级散项 | 高级参数 folder | Fresnel/扩散/环境/涟漪/焦散色等统一收纳 |
| 反射 folder | 反射 folder（不变） | 保持原状 |
| 水下 folder | 水下效果 folder（不变） | 保持原状 |

### 4.5 无限水面 + 地平线雾融合（P3，地平线视觉）

解决我方水面"方块硬边"问题，让水面延伸到视觉地平线。

#### 4.5.1 两种实现方案对比

| 维度 | 方案 A：独立径向淡出（推荐） | 方案 B：复用场景雾 |
|------|---------------------------|------------------|
| **原理** | Shader 内计算水面像素到相机的水平距离，按 `horizonStart/horizonEnd` 与天空色混合并淡出 alpha | 直接复用 `scene.fogMode` / `scene.fogColor`，让水面在远处自动融入全局雾 |
| **控制粒度** | 水面独立可控（独立参数、独立颜色） | 与全局雾绑定，水面不能单独调 |
| **视觉一致性** | 需手动匹配天空色，可能有断层 | 与全局雾天然一致，零色差 |
| **实现复杂度** | 中：新增 2–3 个 uniform + shader 计算 | 低：几乎不用改 shader（Babylon 内置雾自动生效） |
| **性能开销** | 略高（每 fragment 一次距离计算 + smoothstep） | 零额外开销（Babylon 内置） |
| **适用场景** | 场景无全局雾 / 水面需特殊效果 | 场景已开雾且水面雾效与全局一致 |
| **风险** | 天空色匹配不准时出现硬边 | 全局雾模式变化（如关闭雾）时水面硬边重现 |

**推荐方案 A**：独立径向淡出。理由：
1. 我方当前场景默认不开启全局雾，方案 B 无依托
2. 水面作为独立子系统，参数应独立可控，不与全局设置强耦合
3. 天空色可从环境贴图或天空系统读取，匹配成本不高

#### 4.5.2 方案 A 具体实现

**几何扩展**：
- 把现有 3 级 LOD（`meshHigh`/`meshMid`/`meshLow`，`env-water.ts:697-699`）的 `meshLow` 范围扩大，或新增第 4 级远景平面 `meshFar`（低细分、大尺寸）
- 远景平面仅作颜色填充，不计算精细波形（顶点 shader 中降低波高贡献）

**Shader 实现**：

```glsl
uniform float uHorizonStart;     // 地平线淡出起始距离，默认 waterSize * 0.7
uniform float uHorizonEnd;       // 地平线淡出结束距离，默认 waterSize * 0.95
uniform vec3 uHorizonColor;      // 地平线融合色（取自天空底部或 fog 色）

// 在 fragment shader 末尾（gl_FragColor 之前）插入
float radialDist = length(vWorldPos.xz - cameraPosition.xz);
float horizonFade = 1.0 - smoothstep(uHorizonStart, uHorizonEnd, radialDist);
color = mix(uHorizonColor, color, horizonFade);
alpha *= horizonFade;  // 配合透明队列，远处渐隐
```

**天空色来源**：
- 优先读取 `skyColorBot`（天空系统底部色，若 ADR-026 环境系统已提供）
-  fallback：从 `scene.environmentTexture` 的最底部像素采样平均色
- 再 fallback：用 `waterFogColor` 代替

#### 4.5.3 参数字段

| `EnvState` 字段 | 默认值 | 范围 | 说明 |
|----------------|--------|------|------|
| `waterHorizonFade` | `0.0` | 0–1 | 地平线淡出强度，0=关闭（硬边），1=完全淡出到地平线 |
| — | — | — | `horizonStart/End` 不暴露 UI，按 `waterSize` 自动计算（70% 开始，95% 结束） |

> 仅暴露一个强度滑块，放入"高级参数"或独立"地平线"折叠组，避免参数过多。

### 4.6 天空-水面颜色联动（P3，氛围统一）

让水面颜色随天空/时间变化自动调整，实现"天光水色"的氛围统一。

#### 4.6.1 天空色来源

| 优先级 | 来源 | 获取方式 | 说明 |
|--------|------|---------|------|
| 1（优先） | 天空系统底部色 | `skyColorBot` / `envState.skyColorBottom` | 若 ADR-026 环境系统已提供天空色状态字段，直接读取 |
| 2（备选） | 环境贴图平均色 | `scene.environmentTexture` 最底层 mip 采样 | 取 cubemap 下半部分像素平均值，近似水平面反射色 |
| 3（兜底） | 雾色近似 | `waterFogColor` | 无环境贴图时用水体自身雾色代替 |

**推荐实现方式**：在 TS 端（`_syncWaterUniforms` 或独立的 `_updateSkyBlendColor` 函数）计算好天空基准色后，作为 uniform 传入 shader，避免 shader 内做复杂的 mip 采样。

#### 4.6.2 混合公式

在 shader 中混合自定义水色与天空色：

```glsl
uniform vec3 uSkyBlendColor;    // TS 端计算好的天空基准色
uniform float uSkyColorBlend;   // 混合比例，0=完全自定义，1=完全跟随天空

// 在 waterColor 使用前混合
vec3 finalWaterColor = mix(waterColor, uSkyBlendColor, uSkyColorBlend);
vec3 finalFogColor = mix(waterFogColor, uSkyBlendColor * 0.8, uSkyColorBlend);
// 用 finalWaterColor / finalFogColor 替换后续的 waterColor / waterFogColor
```

**TS 端更新时机**：
- 环境贴图变化时（`scene.environmentTexture` 变更）
- 天空色状态变化时（`envState.skyColor*` 变更）
- `waterSkyColorBlend` 参数变化时

**更新频率控制**：天空色变化缓慢（时间过渡），无需每帧更新，可在每 5 帧或变化超过阈值时更新一次，降低 CPU 开销。

#### 4.6.3 参数字段

| `EnvState` 字段 | 默认值 | 范围 | 说明 |
|----------------|--------|------|------|
| `waterSkyColorBlend` | `0.0` | 0–1 | 天空-水面颜色联动强度，0=不联动（保持用户自定义），1=完全跟随天空 |

- UI 位置："颜色与雾" folder 内，透明度滑块之后
- 默认值 0：确保不破坏用户已调好的水色，用户须主动开启
- 图标：`lucide:sunrise`

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

### 5.1 P2 完整状态链路变更清单

P2（焦散强度 + UI 预设化）涉及的所有变更点，实施时逐项打勾：

#### 5.1.1 状态与类型

| # | 变更点 | 文件 | 说明 |
|---|--------|------|------|
| 1 | 新增 `causticIntensity` 字段 | `core/types.ts` `EnvState` | 类型 `number`，默认 `0.15` |
| 2 | FNV method ID 更新 | — | 若状态结构影响序列化 hash，需重新计算（通常自动生成） |

#### 5.1.2 水面子系统

| # | 变更点 | 文件 | 说明 |
|---|--------|------|------|
| 3 | 读取 `causticIntensity` | `scene/env/env-water.ts` `_syncWaterUniforms` | `mat.setFloat('uCausticIntensity', state.causticIntensity)` 替换硬编码 `0.15` |
| 4 | `WaterPreset` 类型扩展 | `scene/env/env-water.ts` | 新增可选字段 `causticIntensity?: number` |
| 5 | 5 个预设补充值 | `scene/env/env-water.ts` `WATER_PRESETS` | 按 §4.3.2 表格取值 |
| 6 | 预设映射函数 | `scene/env/env-water.ts` `buildWaterPresetEnvState` | 输出 `causticIntensity` |
| 7 | 预设应用函数 | `scene/env/env-water.ts` `applyWaterPresetToCurrent` | 写入材质 uniform |
| 8 | 绑定列表确认 | `scene/env/env-bridge.ts` | 确认 `causticIntensity` 在 `WATER_BINDINGS` 中 |

#### 5.1.3 UI 层

| # | 变更点 | 文件 | 说明 |
|---|--------|------|------|
| 9 | 新增焦散强度滑块 | `menus/env-feature-levels.ts` `buildWaterLevel` | 放在 `basic` folder 内，波高之后 |
| 10 | UI 结构重构 | `menus/env-feature-levels.ts` `buildWaterLevel` | 按 §4.4.1 分层结构重组：预设置顶 + 基础参数展开 + 颜色与雾/泡沫/高级/反射/水下折叠 |
| 11 | i18n 新增键 | 语言文件 | `env.causticIntensity`（焦散强度） |
| 12 | 预设 chip 样式确认 | `menus/env-feature-levels.ts` | 使用 `preset-chip` class，28px 高，6px gap |

#### 5.1.4 序列化与兼容

| # | 变更点 | 文件 | 说明 |
|---|--------|------|------|
| 13 | 场景加载兼容 | 场景反序列化逻辑 | 旧场景无 `causticIntensity` 时取默认值 `0.15` |
| 14 | 场景保存 | 场景序列化逻辑 | 新字段自动纳入保存 |

### 5.2 验收标准

每项功能实施完成后，须满足以下标准方可视为通过：

#### 5.2.1 P2 焦散强度

- [ ] 滑块从 0 滑到 0.5，水下光斑亮度线性变化，无跳变
- [ ] 默认值 0.15 与当前硬编码效果完全一致（零视觉回归）
- [ ] 切换 5 个预设时，焦散强度同步变化为预设值
- [ ] 保存场景后重新加载，焦散强度值保持不变
- [ ] 旧场景文件加载后，焦散强度自动取默认值 0.15，无报错

#### 5.2.2 P2 UI 预设化

- [ ] 默认展开的"基础参数"≤8 项，一屏可见（1080p 分辨率下）
- [ ] 预设 chip 置顶，点击切换预设后所有参数同步更新
- [ ] 颜色与雾 / 泡沫 / 高级参数 / 反射 / 水下 5 个折叠组均可独立展开收起
- [ ] 折叠状态不随预设切换而改变（用户展开的保持展开）
- [ ] 移动端（窄屏）布局不溢出，可滚动

#### 5.2.3 P1 法线扰动 + Glitter（待实施时验证）

- [ ] 阳光入射角 30°–60° 时，水面出现明显闪烁高光点，随视角移动而流动
- [ ] `waterNormalStrength = 0` 时，水面效果与当前版本完全一致（零回归）
- [ ] 涟漪触发时，涟漪区域无莫尔纹（无规则横向/纵向条纹）
- [ ] 切换预设时，法线强度与 glitter 强度同步变化
- [ ] FPS 下降 ≤ 5%（1080p 中端 GPU 下，从 60fps 降至 ≥ 57fps）

#### 5.2.4 P3 地平线淡出 + 天空联动（待实施时验证）

- [ ] `waterHorizonFade = 0` 时，水面边缘为硬边（与当前一致）
- [ ] `waterHorizonFade > 0` 时，水面边缘平滑过渡到天空色，无明显断层
- [ ] 相机移动时，淡出区域跟随平滑移动，无闪烁
- [ ] `waterSkyColorBlend = 0` 时，水色与当前一致（零回归）
- [ ] `waterSkyColorBlend = 1` 时，水色与天空底部色一致

---

## 六、风险与取舍

| 等级 | 风险 | 说明 | 缓解 / 决策 |
|------|------|------|------------|
| 🔴 P1 阻塞 | 法线与 Gerstner 叠加 double-count | 我方水面法线已含 Gerstner 波形贡献；再叠一层法线贴图扰动，高频段会与 Gerstner 法线重复累积，导致"波浪过密/高光发糊"而非干净波光 | **P1 实施前置条件**：分层——Gerstner 掌大尺度波向，法线贴图仅接高频细节；或降 Gerstner 高频段贡献，实测校准后合入 |
| 🟡 P1 | 法线扰动与涟漪系统冲突（莫尔纹） | `env-water.ts:374/479-482` 已有 `rippleNormalStrength`/`rippleGlintStrength` 涟漪法线（由 `addRipple` 注入），与新增高频法线层均在高频段改 `normal`，直接相加产生莫尔纹 | **P1 实施前置**：确认新法线层与涟漪是叠加还是替换；建议按 `rippleSum` 加权融合或仅 `abs(rippleSum)<eps` 时启用新层（见 §4.1 / §五） |
| 🟢 已化解 | Sun Glitter 光照方向依赖 | 原担忧 glitter 需 `lightDir` 而 shader 可能未传入方向光方向 | **已核实**：`WATER_FRAG_SRC` 中 `uniform vec3 lightDir;`（`env-water.ts:364`）已存在并由 `:536/:539` 传入方向光方向（含 fallback），可直接复用，无需新增通路 |
| 🟢 P2 | 焦散强度 UI 暴露后用户误调 | 焦散强度过高导致水下光斑过亮、失真 | 设合理上限（建议 `max ≤ 0.5`）；滑块 `max` 封顶，默认值取原硬编码 0.15 |
| 🟡 P3 | 天空-水面颜色联动破坏自定义水色 | `waterSkyColorBlend` 若默认 >0，用户手动调好的水色会被天空覆盖 | **默认值定为 0（不联动）**，用户须主动上调才生效（见 §4.6） |
| 🟡 中 | 性能 | 额外法线贴图采样 + glitter 噪声增加 fragment 开销 | **性能降级策略**：引入 `waterQuality` 三档（跟随全局画质设置）：<br>• **高（High）**：法线细节 + glitter + 双通道法线采样，全开<br>• **中（Medium）**：法线细节减半（单通道采样） + glitter 降频（scale × 0.5）<br>• **低（Low）**：关闭法线细节层与 glitter，仅保留 Gerstner + 焦散（与当前版本一致）<br>默认跟随全局 `renderQuality` 设置，用户可在高级参数中单独覆盖 |
| 🟡 中 | 资源依赖 | 法线贴图引入外部资产 | 优先程序化生成（§4.1.1），避免新增 bundled 资源；若程序化质量不足再考虑外部贴图 |
| 🟢 低 | 过度仿制 | 竞品走"美术夸张"，我方用户群更重视"物理可控" | 仅借鉴波光手段，不削弱现有参数体系；所有新参数默认值保证零视觉回归 |
| 🟢 低 | 预设兼容 | P4 的"波纹/大波"拆分可能破坏 `WATER_PRESETS` | P4 需回归 5 个预设；P1/P2/P3 均向后兼容，旧预设缺失字段取默认值 |
| 🟢 低 | UI 折叠后功能不可达 | 参数收进折叠组后，用户可能找不到高级选项 | 折叠组标题明确（如"高级参数"），且首次进入时高亮提示；搜索功能可命中折叠组内参数 |

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
