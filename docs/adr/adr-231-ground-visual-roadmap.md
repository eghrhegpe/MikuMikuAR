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

技术实现：地面当前走 Babylon 内置材质（StandardMaterial / PBR）。为注入 pattern 且不破坏 226 单源约束，采用 **`CustomMaterial` 包裹内置 shader**（Babylon 支持在 built-in shader 的 fragment 注入），新增 uniform：`groundPatternType`、`groundPatternColor`、`groundPatternScale`、`groundPatternSpeed`、`groundPatternPhase`。pattern 函数输出叠加到 emissive 或 albedo。

### 2.3 方案取舍表

| 维度 | 方向 A 自发光地屏 | 方向 E 程序化图案 |
|------|------------------|------------------|
| 主要 uniform | `groundEmissive*`（color / strength / reflectMix） | `groundPattern*`（type / color / scale / speed） |
| 数据来源 | emissiveColor + emissiveTexture（复用 091 纹理） | 纯数学（shader 内） |
| 与 091 / 114 关系 | 叠加 emissive，反射权重视强度衰减 | 注入 pattern 到 fragment，与反射 / 纹理相乘或相加 |
| 默认 | 关闭（零回归） | 关闭（零回归） |
| 性能 | 仅多一个 texture sample（若用纹理） | 仅数行 GLSL，可忽略 |

---

## 三、实现计划（规划级，落地拆子任务）

### 3.1 状态单源（env-ground-spec.ts，ADR-226）

`env-state-schema` 的 `ground` 分组新增两组字段，均带零回归默认值：

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `groundEmissiveColor` | `Color3` | 黑（关闭） | 地屏自发光颜色 |
| `groundEmissiveStrength` | `number` | `0` | 发光强度（0 = 关） |
| `groundEmissiveReflectMix` | `number` | `0.5` | 发光 / 反射合成比 |
| `groundEmissiveTexture` | `string?` | 无 | 复用 091 纹理管线作发光源 |
| `groundPatternType` | `'none' \| 'grid' \| 'scan' \| 'glowEdge'` | `'none'` | 图案类型 |
| `groundPatternColor` | `Color3` | 霓虹青 | 图案颜色 |
| `groundPatternScale` | `number` | `1` | 网格密度 / 图案尺度 |
| `groundPatternSpeed` | `number` | `0.2` | 扫描 / 动画速度（0 = 静止） |

### 3.2 材质层（env-ground.ts）

- 地面材质切到 `CustomMaterial`（保留现有 StandardMaterial / PBR 基底，注入 fragment）。
- 注入 emissive 合成（A）与 pattern 函数（E），受上述 uniform 控制。
- `groundEmissiveStrength = 0 且 groundPatternType = 'none'` → 注入分支跳过 → 视觉完全回归当前。

### 3.3 菜单暴露（ground-levels，对应 ADR-091 / 208 预设体系）

- 环境 → 地面 → 新增「自发光地屏」分组：颜色 / 强度 / 反射合成 / 可选纹理。
- 新增「程序化图案」分组：类型（网格 / 扫描 / 辉光边）/ 颜色 / 密度 / 速度。
- 预设（env-ground-presets）可保存这两组新字段（ADR-208 sourceKind 治理已就位）。
- i18n 新增对应 key（项目 5 语言体系）。

---

## 四、兼容性与零回归

| 项 | 保证 |
|----|------|
| 零回归 | 所有新 uniform 默认关闭；`CustomMaterial` 注入分支在关闭时 `return` 原逻辑，画面与当前一致 |
| 与 091 纹理统一 | emissiveTexture 复用现有地面纹理管线，不新建纹理路径 |
| 与 114 反射 | `groundEmissiveReflectMix` 显式控制合成，不抢占反射通道 |
| 与 226 单源 | 新字段全部经 `env-ground-spec` 单源读写，不引入分叉 |
| 存档 | 新字段随 `ground` 分组存盘；旧版本 `Object.assign` 忽略多余键，无报错 |

---

## 五、风险与未决项

| 风险 | 等级 | 缓解 |
|------|------|------|
| `CustomMaterial` 包裹内置 shader 与 Babylon 9.x 内置 shader 升级不兼容 | P2 | 锁定注入 hook（Babylon `CustomMaterial` 稳定 point），升级时回归测试 |
| 发光地屏 + 反射同时高权重导致过曝 | P3 | `groundEmissiveReflectMix` 默认 0.5，且发光强时自动衰减反射 |
| 程序化图案在无限地面（ADR-134）下 tiling 接缝 | P3 | pattern 用世界坐标 `vWorldPos.xz` 取模，天然无缝；远处随无限延展淡出 |
| 视频纹理发光（emissiveTexture 动态）性能 | P3 | 仅 sample 一次，复用现有动态纹理机制 |

---

## 六、验收标准

1. `npx tsc --noEmit` 零错误（schema 新字段 + CustomMaterial uniform 声明一致）。
2. `vitest run` 地面相关（env-ground / env-ground-spec / ground-levels contract）全通过。
3. 视觉回归：所有新 uniform 默认值时，画面与当前**逐像素一致**（截图 delta ≤ 1%）。
4. 方向 A：地面显示指定颜色 / 纹理自发光；`groundEmissiveStrength = 0` 时无任何发光。
5. 方向 E：网格 / 扫描 / 辉光边按 uniform 正确渲染；`type = 'none'` 时无图案。
6. 预设存取：新字段随地面预设保存 / 恢复（ADR-208 路径）。

---

## 七、与路线图关系

- 本 ADR 是 **ADR-054 地面方向的补充规划**（054 的 P2 缺口为 Mesh-to-Cloth / AR Phase 3 / 原生 AR，地面视觉不在其列，本 ADR 补齐"地面还能做什么"）。
- **不涵盖** AR 真实地面（平面检测 / 遮挡 / 投影），那是 ADR-072/073 的范畴，地面仅作为其落地载体被引用。
- 落地时建议拆为两个独立子任务（A 与 E 可独立实施、独立验收）。
