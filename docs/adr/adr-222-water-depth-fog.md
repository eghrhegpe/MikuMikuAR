# ADR-222: 水面深度差雾（Depth-Difference Fog）—— 从相机距离雾迁移至水柱厚度雾

- **状态**: 规划
- **日期**: 2026-08-01
- **相关**: ADR-216（移除死字段 underwaterFogDensity/underwaterFogMultiplier）、ADR-115（水面视觉效果增强）、ADR-211（水面功能开关体系）
- **参考**: Unity 水体渲染实践（GrabPass + CameraDepthTexture → 水柱厚度 = backgroundDepth - surfaceDepth）
- **源码锚点**: `frontend/src/scene/env/shaders/water.frag.glsl`（水面 fragment shader）、`frontend/src/scene/env/env-water.ts`（水面材质创建与 uniform 同步）

---

## 一、问题陈述

### 1.1 当前方案：相机距离雾

水面 fragment shader 第 318-320 行：

```glsl
float depth = length(vWorldPos - cameraPosition);
float waterFog = smoothstep(waterFogStart, waterFogEnd, depth);
color = mix(color, finalFogColor * lightExposure, waterFog);
```

此公式以**相机到水面顶点的直线距离**驱动雾化。语义错误在于：水面雾应由**该像素下方的水柱厚度**决定，而非相机距离。

### 1.2 具体反例

| 场景 | 当前行为（相机距离雾） | 期望行为（水柱厚度雾） |
|------|----------------------|----------------------|
| 相机平视岸边 | 近处水面顶点距离小 → 无雾 → 透明见底 | 岸边水薄 → 透底；远处水厚 → 蓝/不透明 |
| 相机俯视湖心 | 俯角小、顶点距离近 → 可能无雾 | 深处水厚 → 应蓝/不透明 |
| 浅滩 vs 深水区 | 相机距离无法区分两者 | 水柱厚度天然区分 |

水下雾（`uUnderwater*`）有同样问题——它也是 `length(vWorldPos - cameraPosition)` 驱动的 LINEAR 雾，同样不区分水深。

### 1.3 因果链

相机距离雾的本质缺陷：**它问的是"相机离水面顶点有多远"，而应该问的是"水面顶点下方有多少水"**。在平面水面（无 Gerstner 波）下，俯视时两者恰好重合（距离 = 水厚），但在平视/斜视时完全无关。

---

## 二、目标方案：深度差雾

### 2.1 核心公式（对标 Unity 实践）

```glsl
// 1. 采样场景深度纹理（水面渲染前已写入的 opaque pass 深度）
float backgroundDepth = texture2D(sceneDepthTexture, screenUV).r;
// 2. 转为世界空间线性深度
float bgWorldDepth = linearizeDepth(backgroundDepth, cameraNear, cameraFar);
float surfaceWorldDepth = length(vWorldPos - cameraPosition); // 水面顶点到相机距离
// 3. 水柱厚度 = 背景深度 - 水面深度
float waterThickness = bgWorldDepth - surfaceWorldDepth;
// 4. 指数雾：浅水透明，深水不透明
float waterDepthFog = 1.0 - exp(-waterDepthFogDensity * max(waterThickness, 0.0));
// 5. 在 alpha 和 color 上用
color = mix(color, waterDepthFogColor, waterDepthFog);
alpha = mix(alpha, 1.0, waterDepthFog * waterDepthFogOpacityInfluence);
```

### 2.2 与 Unity GrabPass 方案的关键区别

| 维度 | Unity 方案 | 本项目方案 |
|------|-----------|-----------|
| 背景颜色获取 | GrabPass 捕获渲染帧缓冲 → `lerp(fogColor, background, fogFactor)` | **不需要**——水面是 alpha 混合的 ShaderMaterial，底色由 Babylon 场景自动合成 |
| 深度获取 | `CameraDepthTexture` → `LinearEyeDepth()` | Babylon `scene.depthRenderer.getDepthMap()` → GLSL 采样 + 手动线性化 |
| 效果 | 水面完全替代背景（tex2D 读背景色 + 雾混合） | 水面叠加在背景上（alpha 混合），深度差只驱雾色/透明度 |

这意味着我们**比 Unity 方案更简单**——不需要 GrabPass，不需要两个 pass。只需要一个深度纹理 uniform + 约 20 行 GLSL。

### 2.3 与现有雾体系的关系

| 雾层 | 当前 | 本 ADR 后 |
|------|------|----------|
| `waterFog*`（相机距离雾） | 存在，驱动水面远方褪色 | **共存**：远方大气雾仍有合理性（地平线外水面该褪入天空色），但改为以深度差雾为主、距离雾为辅 |
| `uUnderwater*`（水下 LINEAR 雾） | 相机距离驱动，水下视角远水面褪入雾色 | **保持不变**——水下视角的场景 fog 仍是相机距离 LINEAR 雾，与 `scene.fog` 同源 |
| 新增 `waterDepthFog*` | — | 水面 shader 水柱厚度雾，驱动浅滩透明 / 深水蓝 |

**决策**：新增深度差雾作为水面 shader 的**主要雾源**，保留现有 `waterFog*` 作为**远方大气补充**（但默认 density 降低，让深度差雾主导）。

---

## 三、实现计划

### 3.1 TS 侧改动（`env-water.ts`）

**新增 uniform / sampler**：

```ts
// _createWaterMaterial 的 samplers 数组追加
.concat(['sceneDepthTexture'])

// WATER_UNIFORMS 追加
'waterDepthFogDensity',    // float: 深度雾密度（0=关闭，默认 0.015）
'waterDepthFogColor',      // vec3: 深度雾色（深水色，默认深蓝青）
'waterDepthFogStrength',   // float: 深度雾对最终颜色/透明度的总强度乘数（0=关闭，默认 1）
'cameraNear',              // float: 深度线性化用
'cameraFar',               // float: 深度线性化用
```

**_syncWaterUniforms 新增**：

```ts
// 每帧同步场景深度纹理
const depthMap = scene.depthRenderer.getDepthMap();
if (depthMap) {
    mat.setTexture('sceneDepthTexture', depthMap);
}
// 相机裁剪面（线性化深度用，相机变化时更新）
if (cam) {
    mat.setFloat('cameraNear', cam.minZ);
    mat.setFloat('cameraFar', cam.maxZ);
}
```

**性能约束**：深度纹理已在 `scene.depthRenderer` 中维护（Babylon 引擎层管理），无需额外 RT 开销。`getDepthMap()` 返回已有纹理引用，不触发新渲染。

### 3.2 GLSL 侧改动（`water.frag.glsl`）

在现有 `waterFog`（相机距离雾，L318-320）之前插入深度差雾计算：

```glsl
// ======== ADR-222: 深度差雾（水柱厚度驱动，替换纯相机距离逻辑）========
uniform sampler2D sceneDepthTexture;
uniform float waterDepthFogDensity;  // 默认 0.015（约 4m 半透明, 20m 近不透明）
uniform vec3 waterDepthFogColor;     // 默认 vec3(0.1, 0.35, 0.55)
uniform float waterDepthFogStrength; // 默认 1.0（0=关闭，零回归）
uniform float cameraNear;            // 用于线性化深度
uniform float cameraFar;

// 在 waterFog 计算之前（约 L317）插入：
if (waterDepthFogDensity > 0.0 && waterDepthFogStrength > 0.0) {
    vec2 screenUV = gl_FragCoord.xy / vec2(textureSize(sceneDepthTexture, 0));
    float rawDepth = texture2D(sceneDepthTexture, screenUV).r;
    // Babylon depth renderer 使用 0-1 非线性深度（perspective divide）
    // 线性化：(2.0 * near) / (far + near - rawDepth * (far - near))
    // 简化：近似线性深度（Babylon 内部公式，精度足够）
    float bgLinearDepth = (2.0 * cameraNear) / (cameraFar + cameraNear - rawDepth * (cameraFar - cameraNear));
    float surfaceDepth = length(vWorldPos - cameraPosition);
    float waterThickness = bgLinearDepth - surfaceDepth;
    // 深度差可能为负（水面顶点在背景之前），clamp 到 0
    waterThickness = max(waterThickness, 0.0);
    // 指数雾：浅水清晰 → 深水蓝（fogDensity 单位 ≈ 1/unit，w/ babymmd unit = 0.1m）
    float waterDepthFog = 1.0 - exp(-waterDepthFogDensity * waterThickness);
    waterDepthFog = clamp(waterDepthFog * waterDepthFogStrength, 0.0, 1.0);
    color = mix(color, waterDepthFogColor * lightExposure, waterDepthFog);
    alpha = mix(alpha, 1.0, waterDepthFog * 0.6); // 深水 alpha 倾向不透明（0.6x 调整）
}
```

### 3.3 深度线性化验证

Babylon `DepthRenderer` 输出的深度值格式取决于场景是否使用对数深度缓冲。本项目场景配置需确认后再确定线性化公式。初期采用标准透视投影深度线性化公式，若与 Babylon 内置 `FOGMODE_LINEAR` 深度语义不一致，则改用 Babylon 内部 `logarithmicDepth` 路径的逆公式。

### 3.4 状态管理

现有 `env-state-schema.ts` 的水面参数组（`water` 分组）新增三个字段，均带零回归默认值：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `waterDepthFogDensity` | `number` | `0.015` | 深度雾密度（单位：1/babymmd unit，约 4m 半透明） |
| `waterDepthFogStrength` | `number` | `1.0` | 总开关/强度乘数（0=关闭，零回归） |

`waterDepthFogColor` 不暴露为独立状态——它从现有 `waterColor` + 天空色自动派生（`mix(waterColor * 0.3, skyBotColor * 0.5, 0.6)`），避免多出无意义调色滑块。

### 3.5 菜单暴露

- `waterDepthFogDensity`：在环境 → 水面 → 高级设置中新增滑块，label `env.waterDepthFogDensity`（i18n key），范围 0–0.1，步长 0.001。
- `waterDepthFogStrength`：同上，范围 0–2，步长 0.01（允许 >1 过驱动）。

---

## 四、兼容性分析

### 4.1 零回归

- `waterDepthFogDensity = 0` 或 `waterDepthFogStrength = 0` → `if` 分支条件为 false → shader 零开销跳过 → 视觉回归到当前行为。
- 新存盘含新增字段，旧版本加载时 `Object.assign` 将其当作多余属性写入 `envState`（与 ADR-216 中删除类字段兼容路径一致）：不报错、无渲染消费、无害。

### 4.2 与现有 `waterFog*` 共存

现有相机距离雾（`waterFogStart/End/OpacityInfluence`）在深度差雾**之后**继续生效，两者乘积效果。默认参数下深度差雾处理水柱厚度（浅滩透明/深水蓝），距离雾处理超远景大气褪色。用户可通过将 `waterFogOpacityInfluence` 降至 0 来完全依赖深度差雾。

### 4.3 与 `uUnderwater*` 分离

水下视角的 LINEAR 雾（`uUnderwaterFogStart/End`）保持独立，不在本次范围。它是从水下往上看水面时，远处水面顶点褪入雾色——正确语义应继续用相机距离（水下远水面确实因距离而褪色）。深度差雾只处理**水面上方**的视角。

---

## 五、风险与未决项

| 风险 | 等级 | 缓解 |
|------|------|------|
| 深度线性化公式与 Babylon 内部不一致导致厚度计算偏差 | P2 | 先与 Babylon `FOGMODE_LINEAR` 的视觉效果做 A/B 对比，偏差 >20% 则改用 Babylon 对数深度逆公式 |
| `scene.depthRenderer` 在 `disableDepthWrite=true` 的水面渲染前是否已包含全部 opaque 对象深度 | P2 | 水面在 transparent pass（alpha blending），opaque pass 深度已写入；如存在顺序问题，改用 `scene.enableDepthRenderer()` 显式控制 |
| 移动端/WebGL1 不支持 `textureSize` | P3 | 用 uniform 传入纹理尺寸（`mat.setFloat('depthTexWidth', w); mat.setFloat('depthTexHeight', h)`），fallback 到手动传入 |
| 深水区域 alpha 不透明后，远处背景（如天空）被水面完全遮挡 | P3 | 地平线淡出（`uHorizonFade`）已在 alpha 计算中叠加，远处水面仍融合天空色 |

---

## 六、验收标准

1. `npx tsc --noEmit` 零错误（schema 新字段 + GLSL uniform 声明一致性）
2. `vitest run env-state / env-feature-levels.contract / scene/env-water` 全通过
3. 视觉回归：`waterDepthFogDensity=0` 时视觉效果与当前完全一致（截图对比，delta ≤ 1%）
4. 视觉验证：浅滩水面（水面靠近地面/角色脚下区域）透明见底；深水区水面渐变蓝色不透明
5. `scene.depthRenderer` 启用后无额外 GPU 帧耗时（`getDepthMap()` 零 RT 拷贝开销）
