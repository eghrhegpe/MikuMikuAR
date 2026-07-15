# ADR-113: 体积云延展地平线与画质/性能升级

## 状态

**状态**: 规划

**开始日期**: 2026-07-15

**关联**: ADR-012（Perlin 双分层，已被取代）、ADR-032（体积云调查，结论保留自定义 shader）、ADR-013（Skybox）

---

## 背景与问题

参考竞品截图（宽幅铺满、蓬松、延展到地平线、性能损耗小）与当前 `env-clouds.ts`（ShaderMaterial-on-Sphere raymarch + 256³ 3D value noise + 3-octave FBM）对照，差距集中在三点：

### 1. 🔴 云到不了地平线（"不宽"的根因）

当前射线用**固定步长**：

```glsl
#define CLOUD_MAX_STEPS 200
#define CLOUD_FIXED_STEP 8.0
```

最大可覆盖深度 = `200 × 8.0 = 1600` 世界单位。而球壳直径 `min(20000, farZ*1.8)`、地平线在数万单位外。后果：

- 远处的云**根本采样不到**，天边永远是空的 → 视觉上"云不宽、不延展"。
- `env-clouds.ts:294` 的 early-exit 正是这个瓶颈的体现：相机在云层下方、仰角小时 `stepsNeeded > 200` 直接 `discard`，低空俯瞰地平线时云被整片裁掉。

**结论**：固定步长与"延展到地平线"在数学上互斥。必须改为**自适应步长（近密远疏）**，用同等步数预算覆盖几十倍深度。

### 2. 🟠 画质：云均匀、边缘糊（"不好看"）

ADR-032 已列明且至今未改：

| 缺陷 | 现状（代码位置） | 视觉后果 |
|------|------------------|----------|
| 无 weather map | `getDensity` 全局 FBM 均匀 | 云平铺，无"哪里密哪里疏" |
| 无 erosion | 三层 FBM 直接加权（`env-clouds.ts:265-268`） | 边缘棉絮状，无卷曲细节 |
| 相位函数单瓣 | `CLOUD_PHASE_G 0.8` 单向 HG（L324） | 无背光银边，日落逆光无通透感 |
| 无 powder 效应 | 仅 Beer 衰减（L329） | 云体缺暗部层次，发"平" |
| 着色恒定 | `cloudCol = vec3(0.78,0.82,0.92)`（L304） | 无日落暖顶/冷底渐变 |

### 3. 🟡 性能：固定步长既浪费又不足

固定 8.0 单位在近处过采样（浪费 fill rate），在远处又覆盖不足。无 temporal / blue-noise 累积，jitter 为固定 seed（L308），无法靠时序降步数。

---

## 目标

复刻截图观感：**宽幅铺满 + 蓬松细节 + 延展地平线 + 性能不劣化**。分阶段落地，每阶段独立可验证、可回滚。

---

## ADR-032 问题对照

| ADR-032 列出的问题 | 解决 Phase | 具体措施 |
|--------------------|-----------|----------|
| 噪声太简单（3 octaves FBM + 256³ value noise） | Phase B | erosion 减法侵蚀 + weather map 低频覆盖控制 |
| 无 weather map（云密度全局均匀） | Phase B | 低频次 FBM 生成覆盖图，乘入 `getDensity` |
| 无 erosion/sharpen（边缘模糊） | Phase B | 最高频 `n3` 做减法侵蚀，雕出卷曲边缘 |
| 步进固定（200 步 × 8.0 单位） | Phase A | 自适应步长 `dt = STEP_MIN + t × GROWTH`，近密远疏 |
| 无 temporal reprojection（闪烁） | Phase D1/D2 | D1: blue-noise dither；D2: temporal reprojection（可选） |
| 光照简陋（单次散射 + 固定 ambient） | Phase C | 双瓣 HG + powder + 高度着色 + 太阳高度角色彩 |
| 性能（200 步 raymarch/fragment） | Phase A + D | A: 平板相交跳过空白段；D1: blue-noise 降步数至 ~96 |

---

## 参数清单与默认值

> 序列化方式：`scene-serialize.ts` 直接存储 `env: envState`，新增字段自动随场景文件持久化，无需修改序列化逻辑。`env-bridge.ts` 的 `cloudKeys` 数组需同步扩展以触发响应式更新。

### 现有参数（保持不变）

| 字段 | 类型 | 默认值 | UI 范围 | 说明 |
|------|------|--------|---------|------|
| `cloudsEnabled` | boolean | `false` | toggle | 体积云开关 |
| `cloudCover` | number | `0.5` | 0–1, step 0.01 | 云覆盖量 |
| `cloudScale` | number | `0.55` | 0.1–1, step 0.05 | 噪声缩放 |
| `cloudHeight` | number | `80` | 50–800, step 5 | 云层中心高度 |
| `cloudThickness` | number | `15` | 10–50, step 1 | 云层厚度 |
| `cloudVisibility` | number | `3000` | 500–8000, step 100 | 云渲染距离 |
| `cloudGap` | number | `0.1` | 0–1, step 0.01 | 云间隙 |

### Phase A 调整

| 字段 | 变更 | 说明 |
|------|------|------|
| `cloudVisibility` | 默认值 `3000→6000`，UI max `8000→12000` | 配合自适应步长延展地平线，保留用户降距能力 |

### Phase B 新增

| 字段 | 类型 | 默认值 | UI 范围 | 说明 |
|------|------|--------|---------|------|
| `cloudErosion` | number | `0.4` | 0–1, step 0.01 | 侵蚀强度，控制边缘卷曲程度 |
| `cloudWeatherStrength` | number | `0.6` | 0–1, step 0.05 | weather map 对密度的影响权重 |

### Phase C 新增

| 字段 | 类型 | 默认值 | UI 范围 | 说明 |
|------|------|--------|---------|------|
| `cloudBacklight` | number | `0.5` | 0–1, step 0.05 | 双瓣 HG 后向瓣混合比（0=纯前向，1=纯后向） |
| `cloudPowder` | number | `0.8` | 0–2, step 0.1 | powder 糖粉效应强度 |

### Phase D 新增

| 字段 | 类型 | 默认值 | UI 范围 | 说明 |
|------|------|--------|---------|------|
| `cloudQuality` | `'standard' \| 'high'` | `'standard'` | modeRow | `high` 启用 blue-noise + 降步数；`standard` 保持 Phase A-C 行为 |

> **UI 布局**：Phase B/C 新增控件追加到 `buildCloudLevel()` 的 `cloudSchema` 数组末尾，按 Phase 分组用 `sectionTitle` 分隔。`cloudQuality` 作为 modeRow 放在面板顶部。

---

## 决策

保留 ShaderMaterial-on-Sphere 架构（ADR-032 结论仍成立：Babylon 9.14.0 无内置体积云，第三方均不兼容），**在现有 shader 上做增量升级**，不重写、不引依赖。按价值/成本排序分 4 阶段。

### Phase A — 自适应步长 + 延展地平线（🔴 核心，解决"宽"）

将固定步长改为随射线深度线性增长（近密远疏），覆盖到 `cloudVisibility`；同时用**解析式平板相交测试**取代原基于固定步长的 `stepsNeeded` early-exit，使仰角 0° 等极端角度稳健、不崩溃。

```glsl
// 替换 #define CLOUD_FIXED_STEP 8.0
#define CLOUD_STEP_MIN 8.0        // 近处精细步长
#define CLOUD_STEP_GROWTH 0.012   // 步长随距离线性增长率

// —— main() 顶部：解析平板相交（方向无关，仰角 0° 安全）——
float baseStep = CLOUD_STEP_MIN;
float tEnter, tExit;
if (abs(rd.y) < 1e-4) {
    // 水平射线：仅当相机已在云层高度内才可能相交
    if (ro.y < cloudBaseY || ro.y > cloudTopY) { discard; return; }
    tEnter = 0.0; tExit = maxT;
} else {
    float tA = (cloudBaseY - ro.y) / rd.y;
    float tB = (cloudTopY  - ro.y) / rd.y;
    tEnter = max(0.0, min(tA, tB));
    tExit  = min(maxT, max(tA, tB));
    if (tEnter >= tExit) { discard; return; } // 射线在 maxT 内从不进入云层
}

// 原 L289 方向 early-exit 已被上述平板测试涵盖（删除）；
// 原 L293 基于固定步长 stepsNeeded 估算在自适应步长下失效（删除），改由 tExit 自然收口。

// 从云层入口起步进，跳过射线进入前的空白段（额外性能收益）
float jitter = hash13(vec3(gl_FragCoord.xy, 1.0));
float startT = tEnter + jitter * baseStep;
float t = startT;
float T = 1.0;
vec3 L = vec3(0.0);
...
for (int i = 0; i < CLOUD_MAX_STEPS; i++) {
    // ⭐ dt 在循环内逐迭代计算，作用域严格限制于本次迭代
    float dt = CLOUD_STEP_MIN + t * CLOUD_STEP_GROWTH;
    t += dt;
    if (t > tExit) break;                 // 离开云层即停
    vec3 p = ro + rd * t;
    float d = getDensity(p, cloudDensity, windDirection);
    if (d > CLOUD_DENSITY_THRESHOLD) {
        float ct = max(dot(Ldir, rd), 0.0);
        float g = CLOUD_PHASE_G;
        float phase = (1.0 - g*g) / (4.0 * 3.14159 * pow(1.0 + g*g - 2.0*g*ct, 1.5));
        float od = d * dt;                // ✅ 使用循环内局部 dt，光学深度自洽
        vec3 S = cloudCol * sceneLightColor * brightness * d * phase * dt * CLOUD_SCATTER_INTENSITY;
        L += T * S;
        T *= max(0.0, 1.0 - od * CLOUD_LIGHT_ATTEN);
        if (T < 0.02) break;
    }
}
```

#### 数值验证与参数标定（修正原 ~288k 估算错误）

原 ADR 估算 `Σ dt ≈ 288k (180×)` 为**手算推导错误**——自适应步长是复利式递推 `t_{n+1} = (1+GROWTH)·t_n + STEP_MIN`，增长为**指数**而非二次。按用户数值验证（循环模型 `dt = STEP_MIN + t·GROWTH`，200 步）：

| GROWTH | 总覆盖 | 倍率(对固定1600) | 末步 dt |
|--------|--------|------------------|---------|
| 0.012（原 ADR） | 6,578 | 4.1× | 86 |
| 0.020 | 20,594 | 12.9× | 412 |
| 0.030 | 98,228 | 61.4× | 2,869 |
| 0.035 | 222,149 | 138.8× | 7,520 |
| 0.036 | 288,000 | 180× | ≈10,000 |

**关键补充发现：真正的地平线闸门是 `cloudVisibility`，不是步长。** 代码 `env-clouds.ts:365/438` 默认 `cloudVisibility ?? 2000`，且 `maxT = cloudVisibility`（`env-clouds.ts:285`）——云只在相机 **2000 单位内**渲染，而球壳直径 `min(20000, farZ*1.8)` 半径达 10000。即**当前云到不了地平线的主因是 2000 的渲染距离上限**，固定步长 1600 仅为次要限制。

达成"云铺到地平线"需**两处协同修改**：① 提高 `cloudVisibility`（建议默认 8000，可随球壳半径缩放）；② 选足够 GROWTH 使 200 步覆盖该距离。

- GROWTH=0.012（审查选项 A）：总覆盖仅 6,578 < 球壳半径 10000，即便提 `cloudVisibility` 也只能到 6000 量级，远地平线仍空白 → **不足以真正到达地平线**。
- GROWTH=0.030（**推荐**）：覆盖 98k ≫ 任何合理地平线距离，200 步末步 dt 2,869（约跨 14× 云层厚度，轻微条带，Phase D blue-noise 兜底），性价比最佳。
- GROWTH=0.036（审查选项 B 原始目标）：覆盖 288k，末步 dt≈10,000 跨整层 → 条带风险高，需 Phase D 先落地。

**Phase A 标定结论：采用 GROWTH=0.030 + 提高 `cloudVisibility` 默认至 8000**（而非原 0.012 或激进 0.036），待 Phase D blue-noise 落地后再视情况上调 GROWTH。
- **early-exit 处理（回应审查建议）**：原 L293 的 `stepsNeeded > CLOUD_MAX_STEPS → discard` 依赖固定步长，自适应后既失效又会误裁地平线云。不采用"简单删除"——改为解析平板相交测试 `tEnter/tExit`，方向无关，在**仰角 0°**（水平射线）等极端角度下通过 `abs(rd.y) < 1e-4` 分支安全判离，绝不崩溃；原 L289 方向 early-exit 已被此测试涵盖。
- **附加性能收益**：从 `tEnter` 起步进、`tExit` 收口，跳过射线进入云层前的空白段，减少无效 `getDensity` 调用。
- 球壳直径同步放大：`SPHERE_DIAMETER = Math.min(40000, farZ * 1.8)`（`env-clouds.ts:352`），确保远处顶点不被裁。

#### Phase A 远距离雾衰减（大气透视）

> **问题**：云延展到 6000+ 单位后，远处云若不做距离衰减，地平线处会出现硬边剪影——远处云与天空色不融合，非常假。

现有 `env-impl.ts:applyFog()` 通过 `scene.fogMode/fogDensity/fogColor` 控制 Babylon 内置雾，但云 shader 使用 `depthFunction = ALWAYS` 且 `disableDepthWrite = true`，**不参与 scene fog 管线**。需在云 shader 内手动实现距离衰减。

```glsl
// —— main() 末尾，fragColor 赋值前 ——
// 远距离雾衰减：在 cloudVisibility*0.6 ~ cloudVisibility 区间线性 fade 到雾色
float fogStart = cloudVisibility * 0.6;
float fogFactor = smoothstep(fogStart, cloudVisibility, length(vWorldPos - cameraPosition));
// 雾色：优先用 scene fogColor（TS 传入），否则退回天空色
vec3 fogCol = sceneFogColor; // 新增 uniform，TS 侧从 scene.fogColor 同步
color = mix(color, fogCol, fogFactor);
alpha *= (1.0 - fogFactor * 0.85); // alpha 同步衰减但保留 15% 避免硬边
```

**TS 侧集成**：在 `env-clouds.ts` 的 `onBeforeRenderObservable` 回调中，读取 `scene.fogColor` 并 `setVector3('sceneFogColor', ...)` 传入 shader。若 `fogEnabled = false`，则传天空底色（可从 `env-impl.ts` 的天空 shader 取或用固定 `Color3(0.53, 0.7, 0.92)`）。

新增 uniform：`sceneFogColor`（`vec3`）。

#### Phase A 地面交界处理

> **问题**：当前云 shader 使用 `depthFunction = ALWAYS`，不进行深度测试。低空云（`cloudHeight` 较低时）的向下射线会穿过地面，在地面下方渲染出云——延展到地平线后这个问题会被放大。

```glsl
// —— raymarch 循环内，计算 p 之后 ——
// 地面裁剪：射线穿过地面后不再采样
uniform float groundLevel; // TS 传入 state.groundLevel

// 在循环内，计算 vec3 p = ro + rd * t; 之后：
if (rd.y < 0.0 && p.y < groundLevel) break;
```

**平滑过渡**（避免硬切）：在 `groundLevel` 附近 10 单位内用 smoothstep 衰减密度：

```glsl
float groundFade = 1.0 - smoothstep(groundLevel, groundLevel + 10.0, p.y);
// groundFade 在地面处=0，地面上 10 单位=1，乘入密度
float d = getDensity(p, cloudDensity, windDirection) * (1.0 - groundFade);
```

新增 uniform：`groundLevel`（`float`，TS 侧从 `state.groundLevel` 同步）。

#### Phase A 球壳几何精度

> **问题**：24 段球体放大到直径 40000 后，地平线附近顶点间距过大，多边形边缘可见；且大尺度球体浮点数精度下降。

**方案**：segments 从 24 提到 **48**。性能影响可忽略（顶点数 24→48，球壳只渲染背面且不参与光照计算）。

```typescript
// env-clouds.ts createClouds() 内
const mesh = MeshBuilder.CreateSphere(
    'volCloud',
    { diameter: SPHERE_DIAMETER, segments: 48, sideOrientation: Mesh.BACKSIDE },
    scene
);
```

> 不采用圆柱壳+半球顶盖方案——收益不足以抵消几何拼接复杂度，48 段球体已足够。

#### Phase A jitter 计算修正

> **问题**：原方案 `startT = tEnter + jitter * baseStep` 只偏移第一步，自适应步长下远处采样点仍对齐，条带集中在远处。

```glsl
// 修正：jitter 偏移量应匹配入口处的预期步长
float firstDt = CLOUD_STEP_MIN + tEnter * CLOUD_STEP_GROWTH;
float t = tEnter + jitter * firstDt;
```

#### Phase A 极端相机角度验证矩阵

| 相机场景 | `rd.y` | 预期行为 | 不崩溃保障 |
|----------|--------|----------|-----------|
| 云层内，仰视地平线 | ≈0+ | 从 `tEnter=0` 步进，远云出现 | 平板测试 `tEnter=0` |
| 云层下方，平视（0°） | =0 | 不相交 → `discard` | `abs(rd.y)<1e-4` 分支 |
| 云层下方，仰视 | >0 | `tEnter` 大，远云出现 | `tA/tB` 正常 |
| 云层上方，俯视 | <0 | `tEnter` 大，地云出现 | `tA/tB` 正常 |
| 云层内，俯视地面 | <0 | 从 `tEnter=0` 步进 | 平板测试 `tEnter=0` |

验证方式：`npm run test -- env-sky.spec.ts` + 手动相机摆位（含 `rd.y≈0`）截图比对；建议为 shader 字符串增加断言 `float dt = CLOUD_STEP_MIN + t`。

### Phase B — Weather Map + Erosion（🟠 解决"不好看"之分布与边缘）

1. **Weather map（低频覆盖控制）**：用**低频次 FBM** 生成大尺度覆盖图，控制云成团分布、留出蓝天缝隙。**不直接复用 3D 切片**——256³ value noise 的原始切片是高频噪声，直接当 weather map 会导致云分布细碎（像雀斑而不是云团）。改为对同一张 3D 纹理以**极低频率**采样（降 5 倍 + 只取 xz 平面），效果完全不同：

   ```glsl
   // weather map：低频 FBM，控制大尺度云团分布
   vec3 wp = vec3(p.xz * 0.001 * cloudScale, 0.0); // 只用 xz 平面，频率降 5 倍
   float weather = fbm(wp + 100.0); // 偏移解相关
   // weather ~ [0,1]，值高的地方允许生云，低的地方强制清空
   float coverage = mix(1.0, smoothstep(0.3, 0.7, weather), cloudWeatherStrength);
   density *= coverage;
   ```

   > 若效果仍不够大尺度，退化为独立 128×128 2D `RawTexture`（JS 侧用低频 Perlin 生成，开销可忽略）。

2. **Erosion（边缘侵蚀）**：用最高频 `n3` 做**减法侵蚀**而非加法，雕出卷曲边缘：
   ```glsl
   float base = n1 * 0.65 + n2 * 0.35;
   float eroded = base - (1.0 - base) * n3 * cloudErosion; // 边缘处侵蚀强
   ```

### Phase C — 双瓣散射 + Powder + 日落着色（🟠 解决"不好看"之光照）

1. **双瓣 HG**：前向瓣（`g=0.8`）+ 后向瓣（`g=-0.2`）混合，逆光产生银边：
   ```glsl
   float phase = mix(hg(ct, 0.8), hg(ct, -0.2), 0.5);
   ```
2. **Powder 糖粉效应**：`powder = 1.0 - exp(-d * dt * 2.0)`，乘入散射项，补回暗部层次。
3. **高度渐变着色 + 太阳高度角驱动**：`cloudCol` 由底部暖色（受太阳色影响）→ 顶部冷色，按 `pos.y` 在 `cloudBaseY..cloudTopY` 插值；同时引入**太阳高度角因子**，太阳越低云色整体越暖（模拟阳光穿过更厚大气层的瑞利散射）：

   ```glsl
   // 高度梯度：顶亮底暗
   float heightFactor = smoothstep(cloudBaseY, cloudTopY, pos.y);
   vec3 dayTopCol = vec3(0.85, 0.88, 0.95);
   vec3 dayBotCol = vec3(0.65, 0.68, 0.78);

   // 太阳高度角因子：sunHeight=1 正午，sunHeight≈0 日落
   float sunHeight = max(0.0, -sceneLightDir.y);
   vec3 sunsetTopCol = vec3(0.95, 0.55, 0.25); // 暖橙顶
   vec3 sunsetBotCol = vec3(0.80, 0.30, 0.20); // 深红底
   float sunsetMix = pow(1.0 - sunHeight, 2.0); // 太阳越低 mix 越强

   vec3 topCol = mix(dayTopCol, sunsetTopCol, sunsetMix);
   vec3 botCol = mix(dayBotCol, sunsetBotCol, sunsetMix);
   vec3 cloudCol = mix(botCol, topCol, heightFactor);
   ```

   > 日落着色不再仅依赖高度，而是**高度梯度 × 太阳角度**双因子驱动，自动适配正午/日落/夜间场景。

### Phase D1 — Blue Noise Dither（🟡 降条带，低风险）

jitter 由 `hash13`（固定 seed）改为 **blue-noise 纹理 + 帧序号偏移**，利用 blue-noise 的频谱特性将采样误差分散为高频噪声（人眼不易感知），显著降低远处条带伪影。

```glsl
// 替换 hash13 jitter
uniform sampler2D blueNoiseTex; // 256×256 RGBA8
uniform float frameIndex;
vec2 bnUv = gl_FragCoord.xy / 256.0 + vec2(frameIndex * 0.6180339, 0.0);
float jitter = texture(blueNoiseTex, bnUv).r; // golden ratio 偏移每帧变化
float firstDt = CLOUD_STEP_MIN + tEnter * CLOUD_STEP_GROWTH;
float t = tEnter + jitter * firstDt;
```

**资源管理**：
- blue-noise 纹理：256×256 `RawTexture`，JS 侧预生成（使用内置 blue-noise 算法或从常量数组加载），全局缓存（同 `_noiseTex3D` 模式），在 `disposeClouds()` 中释放。
- `frameIndex`：TS 侧维护帧计数器，每帧 `setFloat('frameIndex', ...)` 传入。
- 不降步数（`CLOUD_MAX_STEPS` 保持 200），仅改善画质。

### Phase D2 — Temporal Reprojection（🟡 降步数，高复杂度，可选）

> **标记为可选高级特性**，独立评估工作量后再决定是否实施。temporal reprojection 比普通后处理复杂一个量级，需要 velocity buffer、历史帧深度重建、disocclusion 填充、鬼影 clamp。

- 半分辨率渲染 + temporal reprojection 累积，`CLOUD_MAX_STEPS` 可从 200 降至 ~96。
- 需要 velocity buffer（云随风动态移动，每帧位置不同）。
- 需要历史帧缓冲 + disocclusion 检测 + clamp 防鬼影。
- 与现有后处理链的集成成本高，需评估是否冲突。

**降级策略**：若与后处理链冲突或实施成本超预期，保持 D1 blue-noise only（仍优于当前固定 seed），跳过 D2。

**资源管理（若实施 D2）**：
- 历史帧 RT：`RenderTargetTexture`，半分辨率，RGBA8，2 张 ping-pong。
- velocity buffer：`RenderTargetTexture`，半分辨率，RGBA16F。
- 全部在 `disposeClouds()` 中释放，并在 `createClouds()` 中按需重建。

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 自适应步长远处欠采样致条带 | 🟠 | Phase A 定标 GROWTH=0.030（末步 dt≈2,869，跨 ~14× 云层厚度，轻微条带）；Phase D1 blue-noise dither 兜底；激进 0.036 末步 dt≈10,000 条带显著，故不采用 |
| 光学深度 `od = d*dt` 的 dt 作用域 | 🟢 | dt 严格为循环内局部变量，`od` 直接使用该 `dt`；单测断言 shader 字符串含 `float dt = CLOUD_STEP_MIN + t` |
| early-exit 替换后极端角度崩溃 | 🟢 | 解析平板相交测试（`abs(rd.y)<1e-4` 分支）覆盖仰角 0°，见 Phase A 验证矩阵；`env-sky.spec.ts` 增 `rd.y≈0` 用例 |
| 球壳放大 40000 触碰 `camera.maxZ` 远平面 | 🟡 | `SPHERE_DIAMETER` 仍以 `farZ*1.8` 为上界联动 |
| 球壳 48 段顶点数增加 | 🟢 | 24→48 段，顶点量翻倍但仍 <2k；球壳无光照计算，仅背面渲染，GPU 开销可忽略 |
| `cloudVisibility` 默认值 3000 构成地平线硬闸门 | 🟠 | 与自适应步长**协同修改**：Phase A 将默认提至 6000（UI max 扩展至 12000），否则仅改步长仍到不了地平线（已定位为主因） |
| 远处云硬边剪影（无雾衰减） | 🟠 | Phase A 新增 shader 内距离雾衰减，`cloudVisibility*0.6 ~ cloudVisibility` 区间 fade 到雾色/天空色 |
| 低空云穿透地面 | 🟠 | Phase A 新增 `groundLevel` uniform + smoothstep 密度衰减，射线穿地后 break |
| Weather map 低频 FBM 仍不够大尺度 | 🟡 | 降级为独立 128×128 2D `RawTexture`（JS 侧低频 Perlin 生成） |
| Phase D2 temporal 与后处理链冲突 | 🟡 | D2 设计为可选，降级为 D1 纯 blue-noise（仍优于当前固定 seed），不阻塞 A/B/C/D1 |
| Phase D2 temporal 鬼影/disocclusion | 🟡 | 需 velocity buffer + clamp；若实施成本超预期则跳过 D2 |
| 新增 uniform/参数未同步到 `env-bridge.ts` | 🟠 | `cloudKeys` 数组需同步扩展；每个 Phase 提交前 `npm run check` 验证类型一致性 |
| Phase 间回归 | 🟠 | 每 Phase 独立提交（scope `feat(clouds)`），`npm run check` + `env-sky.spec.ts` 逐阶段验证 |

---

## 替代方案

| 方案 | 否决理由 |
|------|----------|
| Cloud Cards / Billboard 云片（首轮讨论方案 C） | 与现有 shader 球体架构并存会造成双套云系统、状态同步复杂；地平线延展问题用自适应步长即可解决，无需引入新架构 |
| Babylon 内置 VolumetricClouds | ADR-032 已确认不存在（9.14.0） |
| 第三方云库（three-clouds 等） | 依赖 Three.js，不兼容 Babylon |
| 重写为纯 post-process 全屏 raymarch | 收益不明显，且丢弃现有可用的球壳裁剪/early-exit 优化，成本高 |

---

## 落地检查清单

### Phase A — 自适应步长 + 延展地平线

- [ ] 自适应步长（GROWTH=0.030）+ 解析平板相交 early-exit
- [ ] `cloudVisibility` 默认提至 6000，UI max 扩展至 12000
- [ ] 球壳放大 `SPHERE_DIAMETER = min(40000, farZ*1.8)` + segments 24→48
- [ ] jitter 修正：`firstDt = STEP_MIN + tEnter * GROWTH`
- [ ] 远距离雾衰减：新增 `sceneFogColor` uniform，shader 内 distance fade
- [ ] 地面交界处理：新增 `groundLevel` uniform，smoothstep 密度衰减 + 穿地 break
- [ ] `env-bridge.ts` 的 `cloudKeys` 同步扩展（如需新增字段）
- [ ] **验证**：低空俯瞰地平线有云；远处云与天空融合无硬边；低空云不穿透地面；仰角 0° 不崩溃
- [ ] `npm run check` 通过

### Phase B — Weather Map + Erosion

- [ ] 低频 FBM weather map（`p.xz * 0.001 * cloudScale`），乘入 `getDensity`
- [ ] Erosion 减法侵蚀（`n3 * cloudErosion`）
- [ ] 新增 `cloudErosion`、`cloudWeatherStrength` 到 `EnvState` + UI 滑块 + `cloudKeys`
- [ ] **验证**：云成团分布、有蓝天缝隙；边缘卷曲不棉絮
- [ ] `npm run check` 通过

### Phase C — 双瓣散射 + Powder + 日落着色

- [ ] 双瓣 HG（`mix(hg(ct,0.8), hg(ct,-0.2), cloudBacklight)`）
- [ ] Powder 糖粉效应（`1.0 - exp(-d * dt * 2.0 * cloudPowder)`）
- [ ] 高度渐变着色 + 太阳高度角驱动（`sunHeight = max(0, -sceneLightDir.y)`）
- [ ] 新增 `cloudBacklight`、`cloudPowder` 到 `EnvState` + UI 滑块 + `cloudKeys`
- [ ] **验证**：日落逆光银边；正午/日落色彩自动切换；暗部有层次
- [ ] `npm run check` 通过

### Phase D1 — Blue Noise Dither

- [ ] blue-noise 纹理生成 + `RawTexture` 缓存 + `disposeClouds()` 释放
- [ ] `frameIndex` uniform 每帧更新
- [ ] `cloudQuality` modeRow（`'standard' | 'high'`）控制开关
- [ ] **验证**：远处条带显著减轻；`high` 模式帧率不劣于 `standard`
- [ ] `npm run check` 通过

### Phase D2 — Temporal Reprojection（可选）

- [ ] 评估工作量与后处理链兼容性
- [ ] 若实施：半分辨率 RT + velocity buffer + temporal 累积 + clamp
- [ ] `CLOUD_MAX_STEPS` 从 200 降至 ~96
- [ ] 资源在 `disposeClouds()` 中释放
- [ ] **验证**：帧率提升 ≥30%；无鬼影/disocclusion 伪影
- [ ] `npm run check` 通过

### 性能验收标准

| 场景 | 目标帧率 | 测量方式 |
|------|----------|----------|
| 1080p 桌面端，`cloudQuality=standard` | ≥ 60 fps | `render/performance.ts` 的 `engine.getFps()` 采样 30 帧均值 |
| 1080p 桌面端，`cloudQuality=high`（D1） | ≥ 55 fps | 同上 |
| 1080p 桌面端，D2 temporal 启用 | ≥ 60 fps（步数降 52%） | 同上 |
| 云关闭时 | 帧率不受影响（基线对比） | 开关前后 `getFps()` 差值 < 1 fps |

> 测量时相机正对地平线（最差 case），`cloudVisibility=6000`，`cloudCover=0.5`。使用 `performance.ts` 现有 FPS 采样管线（30 样本滑动窗口），无需新增测量工具。

### 全程

- [ ] `npm run check` 通过（每 Phase）
- [ ] `frontend/e2e/env-sky.spec.ts` 绿
- [ ] shader 字符串单测断言：`float dt = CLOUD_STEP_MIN + t`、`sceneFogColor`、`groundLevel`、`blueNoiseTex`（按 Phase 逐步添加）
