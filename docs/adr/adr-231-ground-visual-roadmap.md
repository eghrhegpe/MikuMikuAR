# ADR-231: 地面视觉后续方向（自发光地屏 + 程序化地面图案）

- **状态**: 📝 规划
- **日期**: 2026-08-02
- **相关**: ADR-091（地面纹理统一）、ADR-114（地面反射增强）、ADR-083（terrain 倾斜）、ADR-226（地面材质规格单源）、ADR-208（地面预设 sourceKind）、ADR-054（总路线图，地面方向补充）、ADR-072/073（AR Phase 3 / 原生 ARCore·ARKit，地面为 AR 落地载体）
- **参考**: VR-Stage-Lighting / LTCGI（VRChat 发光地屏与舞台 GI）、VRChat 舞台 shader 生态（霓虹网格、脉冲扫描、辉光边）
- **源码锚点**: `frontend/src/scene/env/env-ground.ts`（地面材质创建与 uniform 同步）、`frontend/src/scene/env/env-ground-spec.ts`（材质规格单源，ADR-226）、`frontend/src/scene/env/env-ground-presets.ts`（预设治理，ADR-208）

---

## 一、背景与问题陈述

### 1.1 地面已闭环，但只做到"物理正确"

ADR-052 / 083 / 089 / 091 / 114 / 134 / 208 / 226 已把地面从模式拆分、纹理统一、反射增强、无限延展、预设治理到材质单源全部收口。当前地面是**物理正确的表演基底**：可贴纹理、可反射、可倾斜、可无限延展。

### 1.2 缺"舞台表现"维度

对标 VRChat 舞台生态（VR-Stage-Lighting、LTCGI）发现，地面在舞台语境下不只是"地"，更是**主要视觉载体**：

- **发光地屏**：演唱会 LED 地屏是标配，地面应可自发光显示图案 / 视频 / 渐变，而非仅反射环境。
- **程序化图案**：霓虹网格、脉冲扫描环、辉光边等程序化效果，以极低开销制造强烈舞台氛围。

现有地面**没有任何自发光通道暴露**，也**无程序化图案层**——这是视觉 ROI 最高的两个未开发方向。

### 1.3 已排除的方向

- **地形高度图 sculpt（对标 Unity Terrain）**：MMD 是平面表演舞台，起伏地形需求弱；且 ADR-083 已做 terrain 倾斜，再追高度图属过度工程。
- **多材质 splat 混合**：ADR-091 已统一、ADR-226 已单源，再追 splat 收益低。
- **AR 真实地面（平面检测 / 遮挡 / 投影）**：即 ADR-054 缺口 ADR-072/073 的地面载体，**不在此新立**，仅作为关联缺口引用。

---

## 二、目标方案

两条主线，均**叠加在已闭环的 091 / 114 / 226 之上**（不推翻存量，只加维度）：

### 2.1 方向 A：自发光地屏（Emissive Floor）

地面材质新增 **emissive 通道**，可驱动：

- 纯色 / 渐变辉光（emissiveColor 推导）
- 纹理 / 视频贴图（emissiveTexture，复用 ADR-091 已统一的纹理管线作为发光源）
- 强度 uniform `groundEmissiveStrength`（0 = 关闭，零回归）

与 ADR-114 反射的关系：发光面通常降低反射权重（发光主导时环境反射退为次要），提供 `groundEmissiveReflectMix` 控制两者合成比例，默认偏向"发光 + 弱反射"共存。

### 2.2 方向 E：程序化地面图案（Procedural Pattern）

在地面材质上叠加 **程序化 pattern 层**（不依赖外部贴图）：

- 霓虹网格线（grid lines，可调密度 / 线宽 / 颜色）
- 脉冲扫描环（从中心 / 角色脚下扩散的扫描波）
- 辉光边（地面边界发光描边）

技术实现（落地修订）：地面图案已部分走 **CPU canvas 纹理**路径（`_generateGroundTexture` / `_drawOverlayPattern`，已实现 grid / checker / dots / stripes / radial），本方向 **延续该路径**，仅扩展 `groundOverlay` 枚举 `+ 'scan' | 'glowEdge'`，**不引入 `CustomMaterial`**（无 shader 注入、无新增 uniform）。`scan`（脉冲扫描环）由 `tickGround` 按相位逐帧重绘 albedo 动态纹理实现动画（复用现有 scroll 重绘机制，仅 scan 启用）；`glowEdge` 为静态边界辉光描边。密度 / 颜色复用现有 `groundGridSize` / `groundLineColor`。

### 2.3 方案取舍表

| 维度 | 方向 A 自发光地屏 | 方向 E 程序化图案 |
|------|------------------|------------------|
| 主要字段 | `groundEmissive*`（color / strength / reflectMix / texture） | `groundOverlay` 枚举扩展（scan / glowEdge） |
| 数据来源 | 内置 emissiveColor + emissiveTexture（复用 091 纹理） | CPU canvas 绘制（复用现有图案管线） |
| 与 091 / 114 关系 | 叠加 emissive，反射权重视强度衰减 | overlay 层叠在 albedo canvas 上，与反射无耦合 |
| 默认 | 关闭（零回归） | `'none'`（零回归） |
| 性能 | 仅多一个 texture sample（若用纹理） | 仅 scan 逐帧重绘 512 canvas，glowEdge 静态 |

---

## 三、实现计划（规划级，落地拆子任务）

### 3.1 状态单源（env-ground-spec.ts，ADR-226）

`env-state-schema` 的 `ground` 分组新增一组 emissive 字段 + 扩展 `groundOverlay` 枚举，均带零回归默认值：

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `groundEmissiveColor` | `tuple3` | `[0,0,0]`（黑=关闭） | 地屏自发光颜色 |
| `groundEmissiveStrength` | `number` | `0` | 发光强度（0 = 关） |
| `groundEmissiveReflectMix` | `number` | `0.5` | 发光 / 反射合成比 |
| `groundEmissiveTexture` | `string` | `''` | 非空 = 复用当前 albedo 纹理作发光源（不新建上传路径） |
| `groundOverlay` 扩展 | `enum` | `'none'` | 原 `none/grid/checker` → `+ 'scan' \| 'glowEdge'` |
| scan 动画 | 常量 `GROUND_SCAN_SPEED` | — | 相位累加器在 `tickGround` 推进，仅 scan 启用 |

> 落地修订：`groundPatternColor / Scale / Speed` 不作为独立字段新增——密度复用 `groundGridSize`、颜色复用 `groundLineColor`，动画速度为常量。

### 3.2 材质层（env-ground.ts）

- emissive 走 Babylon 内置 `emissiveColor` / `emissiveTexture` 通道，新增 `_syncGroundEmissive` 在 `applyGroundMaterialSpec` 增量同步（外观性字段，不触发重建）。
- 图案扩展走 `_generateGroundTexture` / `_drawOverlayPattern` 的 canvas 分支（`scan` / `glowEdge`），`scan` 由 `tickGround` 按 `GROUND_SCAN_SPEED` 相位逐帧重绘 albedo 动态纹理。
- 反射随发光强度衰减并入 planar-reflection 的 `getBlend`（每帧被 `groundReflection.update` 调用，避免仅写一次被覆盖）：`es = 0` → 衰减 1 → 反射不变（零回归）。

### 3.3 菜单暴露（ground-levels，对应 ADR-091 / 208 预设体系）

- 环境 → 地面 → 「装饰」folder 的 overlay chips 扩展 `扫描环 / 辉光边`（`scan` / `glowEdge`）。
- 新增「自发光地屏」folder（`defaultOpen:false`）：颜色 / 强度 / 发光-反射合成 / 「用地面纹理作发光源」toggle。
- 预设（env-ground-presets）新增 emissive 四字段（ADR-208 sourceKind 治理已就位，默认全关）。
- i18n 新增对应 key（项目 5 语言体系）。

---

## 四、兼容性与零回归

| 项 | 保证 |
|----|------|
| 零回归 | 新字段默认 `es=0` / `overlay∉{scan,glowEdge}` → emissive 黑、无逐帧重绘、反射衰减 1，画面与当前一致 |
| 与 091 纹理统一 | emissiveTexture 复用现有地面纹理管线，不新建纹理路径 |
| 与 114 反射 | `groundEmissiveReflectMix` 显式控制合成，不抢占反射通道 |
| 与 226 单源 | 新字段全部经 `env-ground-spec` 单源读写，不引入分叉 |
| 存档 | 新字段随 `ground` 分组存盘；旧版本 `Object.assign` 忽略多余键，无报错 |

---

## 五、风险与未决项

| 风险 | 等级 | 缓解 |
|------|------|------|
| ~~`CustomMaterial` 包裹内置 shader 升级风险~~ | — | 已取消该方案（改走 canvas 纹理路径 + 内置 emissive 通道），无 shader 升级耦合 |
| 发光地屏 + 反射同时高权重导致过曝 | P3 | `groundEmissiveReflectMix` 默认 0.5，且发光强时自动衰减反射 |
| 程序化图案在无限地面（ADR-134）下 tiling 接缝 | P3 | pattern 用世界坐标 `vWorldPos.xz` 取模，天然无缝；远处随无限延展淡出 |
| 视频纹理发光（emissiveTexture 动态）性能 | P3 | 仅 sample 一次，复用现有动态纹理机制 |

---

## 六、验收标准

1. `npx tsc --noEmit` 零错误（schema 新字段 + overlay 枚举一致）。
2. `vitest run` 地面相关（env-ground / env-ground-spec / ground-levels contract）全通过。
3. 视觉回归：所有新字段默认值时，画面与当前**逐像素一致**（截图 delta ≤ 1%）。
4. 方向 A：地面显示指定颜色 / 纹理自发光；`groundEmissiveStrength = 0` 时无任何发光。
5. 方向 E：`scan` 显示脉冲扫描环动画；`glowEdge` 显示边界辉光环；`overlay = 'none'` 时无图案。
   > **scan 动画覆盖边界（落地澄清）**：`scan` 逐帧动画**仅覆盖 canvas 来源地面（`envGround` 动态纹理）与贴图地面（`envGroundTex`）**；程序化地面（`groundProcedural_*`）叠加 `scan` 时显示**静态环**——程序化纹理为缓存共享对象（`getOrCreateCanvasTexture`，key 不含相位），逐帧重绘会污染缓存并在材质刷新时产生相位错位跳变，故不纳入动画路径。
6. 预设存取：新字段随地面预设保存 / 恢复（ADR-208 路径）。

---

## 七、与路线图关系

- 本 ADR 是 **ADR-054 地面方向的补充规划**（054 的 P2 缺口为 Mesh-to-Cloth / AR Phase 3 / 原生 AR，地面视觉不在其列，本 ADR 补齐"地面还能做什么"）。
- **不涵盖** AR 真实地面（平面检测 / 遮挡 / 投影），那是 ADR-072/073 的范畴，地面仅作为其落地载体被引用。
- 落地时建议拆为两个独立子任务（A 与 E 可独立实施、独立验收）。
