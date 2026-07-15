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

1. **Weather map**：新增 2D 低频噪声（可复用 3D noise 的一个切片，零新纹理）控制云覆盖区域，令云成团、留出蓝天缝隙。乘入 `getDensity` 的 `hf` 项。
2. **Erosion**：用最高频 `n3` 做减法侵蚀而非加法，雕出卷曲边缘：
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
3. **高度渐变着色**：`cloudCol` 由底部暖色（受太阳色影响）→ 顶部冷色，按 `pos.y` 在 `cloudBaseY..cloudTopY` 插值，日落场景自动出暖顶冷底。

### Phase D — Blue Noise + Temporal（🟡 降步数保性能）

- jitter 由 `hash13`（固定 seed）改为 **blue-noise 纹理 + 帧序号偏移**，配合半分辨率渲染 + temporal reprojection 累积，`CLOUD_MAX_STEPS` 可从 200 降至 ~96，净性能提升。
- temporal 依赖历史帧缓冲，若与现有后处理链冲突则降级为纯 blue-noise（仍优于当前固定 seed）。

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 自适应步长远处欠采样致条带 | 🟠 | Phase A 定标 GROWTH=0.030（末步 dt≈2,869，跨 ~14× 云层厚度，轻微条带）；Phase D blue-noise dither 兜底；激进 0.036 末步 dt≈10,000 条带显著，故不采用 |
| 光学深度 `od = d*dt` 的 dt 作用域 | 🟢 | dt 严格为循环内局部变量，`od` 直接使用该 `dt`；单测断言 shader 字符串含 `float dt = CLOUD_STEP_MIN + t` |
| early-exit 替换后极端角度崩溃（审查建议） | 🟢 | 解析平板相交测试（`abs(rd.y)<1e-4` 分支）覆盖仰角 0°，见 Phase A 验证矩阵；`env-sky.spec.ts` 增 `rd.y≈0` 用例 |
| 球壳放大 40000 触碰 `camera.maxZ` 远平面 | 🟡 | `SPHERE_DIAMETER` 仍以 `farZ*1.8` 为上界联动 |
| `cloudVisibility` 默认值 2000 构成地平线硬闸门 | 🟠 | 与自适应步长**协同修改**：Phase A 将默认提至 8000（可随球壳半径缩放），否则仅改步长仍到不了地平线（已定位为主因） |
| Weather map 复用 3D 切片相关性伪影 | 🟡 | 切片坐标加大偏移解相关；必要时退化为独立 2D RawTexture |
| Temporal 与后处理链冲突 | 🟡 | Phase D 设计为可降级（纯 blue-noise），不阻塞 A/B/C |
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

- [ ] Phase A：自适应步长（GROWTH=0.030）+ 解析平板相交 early-exit + `cloudVisibility` 默认提至 8000 + 球壳放大；验证低空俯瞰地平线有云
- [ ] Phase B：weather map + erosion；验证云成团、边缘卷曲
- [ ] Phase C：双瓣 HG + powder + 高度着色；验证日落逆光银边与暖顶冷底
- [ ] Phase D：blue-noise + temporal + 降步数；验证帧率不劣于当前
- [ ] 全程 `npm run check` 通过，`frontend/e2e/env-sky.spec.ts` 绿
