# ADR-113 审核报告 — 体积云延展地平线与画质/性能升级

> 审核对象：`frontend/src/scene/env/env-clouds.ts`(+ `env-sky.ts` / `scene.ts` / `env-state-schema.ts` / `env-bridge.ts` / `src/__tests__/scene/env-clouds.test.ts`)
> ADR 标记状态：**完成**（前置分层 + Phase A/B/C/D1 全部落地）
> 审核日期：2026-07-22
> 审核结论：**有条件通过** —— 渲染分层与 Phase B/C 光照主体正确，但 **Phase A 步进策略与 ADR 核心决策背离**，且 `cloudQuality` 语义/默认值与 ADR 相反；单测为空壳，无法守住回归。

---

## 亮点（✅ 已正确落地）

| 项 | 位置 | 说明 |
|----|------|------|
| 渲染组分层修复 | `scene.ts:153` `RenderingManager.MIN_RENDERINGGROUPS = -2`；`env-sky.ts:232/238/358/365` 天空盒 `group -2` + `disableDepthWrite=true`；`env-clouds.ts:633` 云 `group -1` | 与 ADR 前置决策完全吻合，解决了“云/天空互相被 LESS 测试丢弃导致黑屏”的根因 |
| 解析平板相交 early-exit | `env-clouds.ts:454-467` | `abs(rd.y)<1e-4` 分支覆盖仰角 0°，方向无关，符合 ADR “极端角度不崩溃”要求 |
| 地面交界 | `env-clouds.ts:496-502` + `groundLevel` uniform (`:612/:709`) | 穿地 `break` + `smoothstep` 密度衰减，且 `groundLevel` 是 ADR 检查清单中**唯一真正连通**的 uniform |
| Weather Map + Erosion | `env-clouds.ts:422-433` | 低频 FBM 覆盖 + `n3` 减法侵蚀，与 ADR Phase B 一致 |
| 双瓣 HG 相位 | `env-clouds.ts:382-385` | `mix(hg(0.8), hg(-0.2), cloudBacklight)`，符合 ADR Phase C |
| Powder 改进 | `env-clouds.ts:528` `powderFactor = mix(1.0, powder(od), ct)` | 在 ADR 基础上增加 `ct` 门控，避免逆光时薄云被误清零，是合理的正向增强 |
| 场景重建防御 | `env-clouds.ts:74-98 / 166-187 / 574-576` | 缓存纹理/网格按 `getScene()` 一致性校验后强制重建，规避了 HMR/切场景的悬空 uniform（注释标 P1 修复） |
| 资源释放 | `disposeClouds()` `:763-788` | observer 先于 material 释放，3D/blue-noise 纹理均释放 |

---

## 风险表

| 文件 | 观察 | 等级 | 建议 |
|------|------|------|------|
| 🔴 `env-clouds.ts:486-491` | **步进策略与 ADR 核心决策背离**。ADR Phase A 最终标定 `GROWTH=0.030` + `dt = CLOUD_STEP_MIN + t*GROWTH`（`adr-113` L212/L250/L459，且落地清单要求 shader 字符串断言 `float dt = CLOUD_STEP_MIN + t`）。实现改为**均匀平板步长** `slabDt = clamp(slabLen/24, 2, 12)`，`dt = slabDt` 常量循环。shader 中**不存在**被断言的字符串；ADR 所述“200 步覆盖 98k 单位抵达地平线”的数值依据未实现 | P1 | 要么按 ADR 改回 `dt = STEP_MIN + t*GROWTH`（并放宽低仰角 `maxT`），要么回写 ADR 承认 slab-uniform 方案并删除失效断言/数值表；二者必须一致 |
| 🔴 `env-clouds.ts:220-229` + `:252` + `:589` | **`cloudQuality` 语义与默认值反向于 ADR**。ADR-113 L111/L491/L509：`standard`=满血基线（200 步），`high`=蓝噪+降步数(~96)。实现：`standard`=96 步+1 光照步+无蓝噪（更轻），`high`=200 步+2 光照步+蓝噪（更重）；且 schema 默认值 `'high'`(`:256`)。ADR 性能表（standard≥60fps / high≥55fps）现映射到**相反**的质量档 | P1 | 统一契约：若保留“standard=轻量”的现实语义，须改 ADR 文案、默认值与性能表，避免后续读者误判 |
| 🟠 `env-clouds.ts:548-553` vs `:350/:683/:717/:749` | **距离雾忽略 `sceneFogColor`（死 uniform）**。雾代码 `mix(color, vec3(1,1,1), fogFactor*0.3)` 固定混白，ADR Phase A 明确要求 `mix(color, fogCol, …)` 且 `fogCol=sceneFogColor`。`sceneFogColor` 仍被声明/逐帧 setVector3 但 shader 从不读取 → 地平线雾永远是白雾而非天色匹配，且每帧白做一次无用 uniform 写入 | P2 | 改为 `mix(color, sceneFogColor, fogFactor)`（注意 `dist` 用 `length(vWorldPos-cameraPosition)`，地平线处≈球半径，fog 区间需与 `cloudVisibility` 对齐） |
| 🟠 `env-clouds.ts:393-400` vs `adr-113` L367-383 | **Phase C 日落着色被简化**。实现仅 `applySunsetTint` 做基于 `abs(sunHeight)` 的乘性暖色；ADR 规定“高度梯度 `mix(botCol,topCol,heightFactor)` × 太阳高度角”双因子。且 `cloudColor` uniform(`:356`) 声明并 set(`:713/732/744`) 但 shader 用 `vec3(1,1,1)`+tint 计算 `cloudCol`，**从未读取 `cloudColor`** → 又一处死 uniform | P2 | 实现 ADR 的高度梯度底色，或删除 `cloudColor` uniform；日落阈值用 `max(0,-sunDir.y)` 而非 `abs` 以区分日出/日落 |
| 🟠 功能正确性（地平线延展） | **地面视角的近地空白带**。低仰角射线 `tEnter=(cloudBaseY-ro.y)/rd.y` 在 `cloudVisibility=8000` 下，仅当 `rd.y>~0.0375`（≈2.15°）时 `tEnter<tExit`；更低仰角直接 `discard`。即**从角色地面 POV 看地平线，云在 0–2° 带内整片缺失**；且均匀步长 max 覆盖仅 `200×12=2400` 单位，远未到 8000 雾界。ADR 的“云铺到地平线”在典型地面视角下未真正达成（靠白雾淡出伪装） | P2 | 视觉验证；若确认缺口可见，需对低仰角放宽 `maxT`（如地平线方向用更大 `cloudVisibility`）或增大 slabDt 上限 |
| 🟡 `src/__tests__/scene/env-clouds.test.ts:25-28` | **单测为空壳**。用 `vi.mock` 把被测模块整体替换，断言只验证 mock 自身行为；ADR 要求的 shader 字符串断言（`float dt=…`、`sceneFogColor`、`groundLevel`、`blueNoiseTex`）全部缺失。CI 绿不代表 shader/逻辑正确，正是 #1–#4 这类回归无法被捕获的根因 | P3 | 增加真实 shader 字符串断言（导出 `FRAG_SRC` 或抽取 builder），至少校验注入占位符与关键 uniform 名存在 |
| 🟡 `env-clouds.ts:606/:703` | **`cloudVisibility ?? 2000` 兜底与 schema 默认 8000 不一致**（schema `:246` 已为 8000）。正常态不触发，但若 state 缺字段会偷偷把地平线闸门降回 2000，与文档矛盾 | P3 | 改 `?? 8000` 与文档对齐，或删冗余兜底 |
| 🟡 `env-clouds.ts:685/:695-696` | **`standard` 模式仍分配并绑定 blue-noise 纹理**，但此时 jitter 走 `fract()` hash（`:237`），`blueNoiseTex` 从不采样。每帧重建时多生成/绑定一张 64×64 纹理。ADR Phase D1 将蓝噪限定于 `high` | P3 | standard 模式不创建/不声明 `blueNoiseTex` sampler，或在 material 构建时按 `useBlueNoise` 条件注入 sampler |
| 🟢 `env-clouds.ts:776-777` | **遗留 `_envSys.clouds` 管道与真实 `_volCloudMat` 脱节**：`createClouds` 从不赋值 `_envSys.clouds.material`，dispose 时仅对 null 引用 `safeDispose` 无操作。真实释放靠 `:772`。非泄漏，但属死代码/代码异味 | P4 | 删除 legacy `_envSys.clouds` 清理分支，或明确其用途 |
| 🟢 `env-clouds.ts:362-368` | `CLOUD_STEP_GROWTH` 宏已删，`CLOUD_STEP_MIN` 仅用于 slab 钳位边界；残留宏无害 | P4 | 可清理注释，标注“均匀步长方案” |

---

## ADR ↔ 实现漂移专项（文档宪法视角）

本项目以 AGENTS.md “文档宪法”为治理基线。ADR-113 标记为**完成**，但以下决策点代码与文档不一致，按优先级必须回写其一：

1. **步进算法**：文档写“自适应近密远疏 `dt=STEP_MIN+t*GROWTH`，GROWTH=0.030 覆盖 98k”；代码写“均匀平板步长 `slabLen/24` 钳位[2,12]”。二者数学机制不同，且注释 `:481-484` 承认是有意推翻原增长步（因高空云平板采样过疏）——这是**合理的工程修正，但未回写 ADR**。
2. **`cloudQuality` 语义**：文档“standard=满血 / high=降步”，代码“standard=轻量 / high=满血”，默认也相反。
3. **距离雾目标色**：文档 `sceneFogColor`，代码固定白。
4. **日落着色**：文档双因子高度梯度，代码乘性暖色。

> 建议：保留当前代码的工程选择（slab-uniform 对高空更稳、standard=轻量更务实），但**把 ADR-113 的状态从“完成”改为“完成（实施中与文档有偏差，见 audit）”**，并修订对应小节与数值表，使后续读者不被误导。这是文档宪法下优先级最高的治理项。

---

## 审核结论

- **类型安全**：模块级无 `as any`/`@ts-ignore`，shader 为字符串故 tsc 不校验——但 shader 正确性**无任何自动化守护**（见 P3 单测空壳）。
- **资源管理**：纹理/observer/material 释放链路完整，无泄漏；仅 legacy `_envSys.clouds` 冗余（P4）。
- **功能正确性**：Phase B/C 光照、地面交界、渲染分层正确；**Phase A 地平线延展在地面视角存在近地空白带（P2）**，且与 ADR 描述机制不符。
- **设计质量**：`sceneFogColor`/`cloudColor` 死 uniform（P2）、`cloudQuality` 语义反直觉（P1）、legacy 管道（P4）属可清理项；响应式键通过 `getEnvKeys('cloud')` 由 schema 驱动，新增字段无需手改 `cloudKeys`（ADR 担忧已化解 ✅）。

**签退建议**：合并前至少解决两个 P1（步进策略与 ADR 对齐/回写、cloudQuality 契约统一）与一个 P2（距离雾改用 `sceneFogColor`），并将空壳单测升级为真实 shader 字符串断言。

---

## 修复记录（2026-07-22 后续，已落地）

> 用户指令：「修正 adr 偏差并尝试修复新问题」。决策：**代码保留更优的工程选择，回写 ADR-113 文档使其与代码对齐**（文档宪法），并修复功能/卫生问题。

| 原等级 | 项 | 处置 | 落地位置 |
|--------|----|------|----------|
| 🔴 P1-1 | 步进策略与 ADR 背离 | **保留 slab-uniform 代码**，回写 ADR：新增「实施修订纪要 #1」+ Phase A 代码块改写为 slab-uniform + GROWTH 数值表标注失效 + 风险表/`ADR-032 对照`表同步 | `adr-113` L6-25、Phase A、L64、L429 |
| 🔴 P1-2 | `cloudQuality` 语义反向 | **保留代码**（standard=轻量 96/high=满血 200/默认 high），回写 ADR 参数表、性能表、`cloudQuality` 文案、Phase D1 说明 | `adr-113` Phase D 参数、性能验收、Phase D1 |
| 🟠 P2 | 距离雾死 uniform（白雾） | **修复**：`mix(color, vec3(1,1,1), ...)` → `vec3 fogCol = sceneFogColor; mix(color, fogCol, ...)` | `env-clouds.ts:561-568` |
| 🟠 P2 | 日落着色简化 + `cloudColor` 死 uniform | **修复**：删除 `applySunsetTint` 单因子；改为 per-sample 高度梯度底色 `mix(cloudBot, cloudTop, cloudHeightFactor)` × 日落暖色，`cloudColor`（实时光色）作反照率基底 | `env-clouds.ts:393-395, 506-516` |
| 🟠 P2 | 地面 POV 地平线近地空白带 | **尝试修复**：低仰角 `maxT` 放宽至 `cloudVisibility * 3`，`slabDt` 上限由 `STEP_MIN*1.5`(12) 提至 `CLOUD_STEP_MAX`(48)；远端由距离雾淡出。**需视觉验证**定标 | `env-clouds.ts:447-450, 488-491` |
| 🟡 P3 | 单测空壳 | **重写**：导出 `FRAG_SRC`/`resolveCloudShaderParams`/`buildJitterSource`，新增 7 条真实 shader 字符串断言（sceneFogColor、cloudColor 双因子、地平线×3、slab-uniform、参数映射、jitter 分支），全部通过 | `env-clouds.test.ts`（7 passed） |
| 🟡 P3 | `?? 2000` 与 schema 不一致 | **修复**：两处 `cloudVisibility ?? 2000` → `?? 8000` | `env-clouds.ts:606, 703` |
| 🟡 P3 | standard 仍分配蓝噪纹理 | **修复**：`samplers` 列表与 `blueNoiseTex` 绑定均按 `useBlueNoise` 条件化，standard 不再创建/绑定该纹理 | `env-clouds.ts:685, 695-700` |
| 🟢 P4 | legacy `_envSys.clouds` 死代码 | **清理**：删除 dispose 中 legacy 分支及未用的 `_envSys` import | `env-clouds.ts:17, 763-783` |

**验证**：`npm run check`（tsc）通过；`env-clouds.test.ts` 7/7 通过。**未覆盖**：GLSL 运行时编译与画质需真实 GPU/视觉回归（地平线延展定标、日落双因子观感）。建议 `wails dev` 下目测 + `frontend/e2e/env-sky.spec.ts`。
