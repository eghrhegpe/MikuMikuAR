# 体积云地平线延展渲染技术研究

> 配套 ADR-113。本文聚焦"云为何到不了地平线"以及业界解决"宽幅铺满 + 低损耗"的工程路线，为 ADR-113 的分阶段方案提供背景与取舍依据。

## 1. 背景：从一张竞品截图说起

竞品截图呈现的典型特征：

- 云层**大范围铺展**，横向延展到地平线无边界断裂
- 云体**蓬松有体积感**，边缘有卷曲细节而非棉絮
- 地平线处云海**低密度渐隐**，与天空无缝融合
- 复杂光照（日落逆光银边、暖顶冷底）下**性能损耗仍小**

对照联邦当前实现 `frontend/src/scene/env/env-clouds.ts`：ShaderMaterial-on-Sphere raymarch + 256³ 3D value noise + 3-octave FBM。视觉差距集中在"宽""好看""不卡"三点，根因是**采样预算分配方式**，而非算法本质错误。

## 2. 核心矛盾：固定步长 vs 地平线

当前 shader 关键常量（`env-clouds.ts:228-238`）：

```glsl
#define CLOUD_MAX_STEPS 200
#define CLOUD_FIXED_STEP 8.0
```

**最大可覆盖深度 = 200 × 8.0 = 1600 世界单位。**

而球壳直径 `min(20000, farZ*1.8)`、地平线在数万单位外。射线步进 1600 深后即停止，远处云**永远采样不到**——视觉上就是"云不宽、天边空"。

`env-clouds.ts:293-300` 的 early-exit 直接暴露此瓶颈：

```glsl
if (ro.y < cloudBaseY && rd.y > 0.0) {
    float stepsNeeded = (cloudBaseY - ro.y) / (rd.y * dt);
    if (stepsNeeded > float(CLOUD_MAX_STEPS)) { discard; return; }
}
```

一旦相机低空、看向地平线（仰角极小），`stepsNeeded` 远超 200 → 整片云被 `discard`。**固定步长与"延展到地平线"在数学上互斥。**

### 2.1 为什么不能简单把步数加到几万？

填充率与步进成本线性增长：`steps × fragments`。200 步 × 全屏片段在移动端已吃紧，几万步直接卡死。正确的解法是**让每一步覆盖的深度随距离增长**（自适应步长），用同样 200 步覆盖几十倍深度。

## 3. 业界渲染路线对比

| 路线 | 地平线延展 | 性能 | 实现成本 | 代表 |
|------|:---------:|:----:|:--------:|------|
| **A. 固定步长 raymarch** | ❌ 差 | 中 | 低 | 我们当前 |
| **B. 自适应步长 raymarch** | ✅ 好 | 中→优 | 低 | 本文 ADR-113 Phase A |
| **C. Raymarched + Weather Map + Erosion** | ✅ 好 | 中 | 中 | Horizon Zero Dawn、Siggraph 2015（Guerrilla） |
| **D. Cloud Cards / Impostor 公告板群** | ✅ 好 | 优 | 中 | Journey、Nubis（前顽皮狗）、多数二游 |
| **E. 全屏 Post-process Cloud** | ✅ 好 | 中→差 | 高 | 部分 AAA 后处理云 |
| **F. 体素/Voxel + 3D 纹理** | ✅ 好 | 中 | 中 | 多数实时云通用底 |

### 3.1 路线 B — 自适应步长（ADR-113 的基石）

核心思想：近处（相机周围）用细步长保细节，远处（趋向地平线）用粗步长铺深度。

```glsl
#define CLOUD_STEP_MIN 8.0
#define CLOUD_STEP_GROWTH 0.012

float t = startT;
for (int i = 0; i < CLOUD_MAX_STEPS; i++) {
    float dt = CLOUD_STEP_MIN + t * CLOUD_STEP_GROWTH; // 近密远疏
    t += dt;
    if (t > maxT) break;
    vec3 p = ro + rd * t;
    float d = getDensity(p, cloudDensity, windDirection);
    if (d > CLOUD_DENSITY_THRESHOLD) {
        float od = d * dt;                  // 光学深度乘当前 dt（已是变量）
        ...
        T *= max(0.0, 1.0 - od * CLOUD_LIGHT_ATTEN);
        if (T < 0.02) break;
    }
}
```

**覆盖深度估算**：第 i 步 `dt ≈ 8 + (8·i + 0.5·0.012·8·i²) ≈ 8i + 0.048i²`。200 步时 `Σdt ≈ 8·(200²/2) + 0.048·(200³/3) ≈ 160k + 128k ≈ 288k` 单位。是固定步长的 **180 倍**，地平线云自然涌现。

代价：远处欠采样产生条带。缓解：配合 Phase D 的 blue-noise dither 打散。

### 3.2 路线 C — Weather Map + Erosion（画质关键）

**Weather map**：2D 低频噪声（或 3D 噪声的一张切片）控制云覆盖区域，令云成团、留出蓝天缝隙，而不是全局均匀铺满。乘入 `getDensity` 的高度衰减项 `hf`。

**Erosion（侵蚀）**：当前是三层 FBM 加法加权（`env-clouds.ts:265-268`），边缘像棉絮。改为"低频建形 + 高频减法雕边"：

```glsl
float base = n1 * 0.65 + n2 * 0.35;
float eroded = base - (1.0 - base) * n3 * cloudErosion; // 边缘处 n3 侵蚀强
```

### 3.3 路线 D — Cloud Cards / Impostor（性能天花板）

把云做成一堆半透明公告板（billboard），按 LOD 分布在天球中下部：

- 远景：几层低密度云海 cards，alpha 低、密度高 → 制造水平延展感
- 近景：蓬松 cards 群，贴程序化噪声纹理
- 优点：性能极优，日落着色纯美术可控
- 缺点：**与现有 shader 球体架构并存会成双套云系统**，状态同步复杂；且 cards 在镜头穿云/投影时穿帮

ADR-113 否决 D：自适应步长已能解决"宽"的问题，不值得引入第二套架构。若未来需要镜头穿云飞行，可单独立项评估。

### 3.4 路线 E/F — 进阶散射

- **双瓣 Henyey-Greenstein**：前向瓣 `g=0.8`（顺光）+ 后向瓣 `g=-0.2`（逆光），混合产生背光银边。当前 `CLOUD_PHASE_G 0.8` 仅单瓣。
- **Powder 糖粉效应**：`powder = 1.0 - exp(-d·dt·2.0)`，乘入散射项，补回云体暗部层次，消除"发平"。
- **高度渐变着色**：`cloudCol` 由底部受太阳色影响（暖）→ 顶部冷色，按 `pos.y` 在 `cloudBaseY..cloudTopY` 间插值，日落场景自动出暖顶冷底。当前 `cloudCol` 为恒定常量（`env-clouds.ts:304`）。

## 4. 性能工程：为什么截图"损耗小"

截图级效果≠暴力步进。通用降耗手法：

| 手法 | 作用 | ADR-113 对应 |
|------|------|--------------|
| 自适应步长 | 同等预算覆盖更深 | Phase A |
| Blue-noise dither | 用低步数 + 蓝噪声打散替代高步数均匀采样 | Phase D |
| Temporal Reprojection | 历史帧累积，每帧只算 1/2~1/4 步数 | Phase D |
| 半分辨率渲染 | 云对空间频率不敏感，半分辨率几乎无损 | Phase D |
| Early-exit（射线不相交/透射耗尽） | 跳过无效片段 | 已存在（`env-clouds.ts:289`） |
| LOD / 远平面裁剪 | 移动端降 cards 数或步数 | 可加 |

关键洞察：**截图那种"宽到地平线又省"的效果，本质是"自适应步长 + blue-noise/temporal 降步数"的组合**，而非独家黑科技。

## 5. 结论与建议

1. 我们与竞品的差距**不在算法本质**，而在采样预算分配（固定步长）与画质细节（无 weather map/erosion/双瓣散射）。
2. **最优先**：Phase A 自适应步长 —— 这是"云到地平线"的必要条件，且改动局部、风险可控。
3. **时序**：A（宽）→ B（成团/卷边）→ C（光照通透）→ D（降步数保性能），每阶段独立可验证。
4. **否决 Cloud Cards 引入**：避免与现有球壳 shader 形成双套云系统；自适应步长已覆盖"宽"的需求。
5. 若未来需求升级为"镜头穿云飞行 + 投影"，再单独评估 Cloud Cards / 体素方案。

## 6. 参考

- Guerrilla Games, "Real-time Volumetric Cloudscapes" (SIGGRAPH 2015) — weather map + erosion + multi-scattered raymarch 范式
- Horizon Zero Dawn cloud rendering GDC talk — adaptive step + temporal
- ADR-012 / ADR-032 / ADR-013（联邦既有云/天空决策）
- `frontend/src/scene/env/env-clouds.ts`（当前实现，525 行）
