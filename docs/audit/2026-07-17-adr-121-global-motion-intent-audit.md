# ADR-121 审计报告 — 全局动作意图（Scene-level Motion Intent）

> 审计对象：`docs/adr/adr-121-global-motion-intent.md`（状态：规划，2026-07-17）
> 审计方法：按 AGENTS.md「代码审核维度标准」+「审核思维准则」，重点核验文档中的**事实性断言**（引用路径、行号、依赖状态、模块真实性），并走查设计自洽性与并发/生命周期边界。
> 审计日期：2026-07-17

---

## 总体结论：**有条件通过（Conditional Pass）**

设计立意正确、不变量边界克制（尤其「不入 EnvState」「vmd* 仍为已解析缓存」），向后兼容与复用论证有力。但存在 **1 处 🔴 P1 事实性过度承诺**（`resolve()` 复用 ADR-108 的断言与代码现实不符）与若干中低风险项，须在进入 P0 实施前修订，否则实施者会误判可得资产。

---

## 事实核验（核心价值：文档声称 vs 代码现实）

| # | ADR-121 断言 | 代码现实 | 判定 |
|---|-------------|---------|------|
| F1 | `ModelInstance` 持有 vmd* 于 `core/types.ts:100-105` | 实际位于 `frontend/src/core/types.ts:100-105`，字段名/行号**精确一致** | ✅ 通过（路径前缀省略，不影响） |
| F2 | `model-loader.ts:457` 存在 `pendingVmd` 钩子 | `frontend/src/core/state.ts:108` 定义；`model-loader.ts:456-458` 使用 | ✅ 通过（行号偏差 1） |
| F3 | 动作菜单把 VMD 写入聚焦模型 `inst.vmdData` | `menus/motion-popup.ts:225-227`/`:588-590` 经 `loadManager.load` 写/清 vmd* | ✅ 通过（精神正确） |
| F4 | ADR-116 覆盖模块（`ModelInstance.motionOverrideModules`）已存在、与全局意图正交 | `core/types.ts:151` 确有 `motionOverrideModules?` + `body-posture`/`hand-symmetry` 实现 | ✅ 通过（代码存在；ADR-116 文档标「规划」仅指 UI  redesign 部分，不构成对 ADR-121 的矛盾） |
| F5 | ADR-108 AnimationRetargeter 已落地，可作 `resolve()` 复用引擎 | `animation-retargeter.ts` 是 **UI 流程**（`getBoneMapPresets`→`playRetargetedAnimation`），`AnimationRetargeter` 来自 `babylon-mmd`；它面向「外部动画→单目标骨骼重映射」，**非广播期兼容性解析器** | 🔴 **过度承诺** |
| F6 | `resolve()` 内部走 `matchBone` 候选表（全角 `左足ＩＫ`/半角/英文变体） | `matchBone` 位于 `motion-algos/proc-motion-shared.ts:146`，属**程序化动作**子系统，与 retargeter 无关；`左足ＩＫ` 仅在 proc-motion 与测试出现 | 🔴 **归属错置** |
| F7 | 无既有 `activeMotion`/`broadcastMotion`/`getActiveMotion` | 全局检索确认不存在 | ✅ 通过（确为新增） |
| F8 | `VmdLayer` 类型存在 | `core/types.ts:66` 定义 | ✅ 通过 |
| F9 | ADR-119 缩略图契约已完成 | 状态：Phase 1+2 完成，契约测试通过 | ✅ 通过 |
| F10 | i18n 5 语言齐全 | `core/i18n/locales/` 含 en/ja/ko/zh-CN/zh-TW 共 5 文件 | ⚠️ ADR 表格仅列 3 列（见 P2） |

---

## 亮点

- **不变量 #2（activeMotion 不入 `EnvState`）**：精准规避「Go `EnvState` struct 同步 + 重生成 wails 绑定」的工程铁律成本，决策克制且有据。
- **不变量 #1（vmd* 仍为已解析缓存、playback 链路不变）**：正确锁定改动边界，避免大范围重构，契合项目「增强已有函数、复用」偏好。
- **向后兼容设计**：旧场景无 `motion` 块 → `activeMotion=null` → 按已有 `vmdPath` 还原，与现状一致，不报错。
- **复用论证有力**：天然复用 `modelMap` 注册表 + 共享 WASM 物理时间轴，多角色同步无漂移；吸收 `pendingVmd` 胚胎而非另造。
- **风险表分级清晰**：P1「不兼容模型被静默无视」已用 `status='incompatible'` + 显式 UI 提示 + 「绝不覆盖已有 vmd*」三重缓解，方向正确。

---

## 风险

| 文件/位置 | 观察 | 建议 |
|-----------|------|------|
| 🔴 极高P1 | `adr-121` §背景/§数据流：「`resolve()` 复用 ADR-108 AnimationRetargeter + `matchBone` 候选表」 | ADR-108 的 retargeter 是**单目标外部动画导入流程**，不是广播期「逐模型取兼容 VMD 子集」的引擎；`matchBone` 属于 `proc-motion-shared`（程序化动作），与 retargeter 无关。`resolve()` 实为**待新建**函数。须改写措辞：`resolve()` 为新逻辑，骨骼名匹配应复用 `proc-motion-shared.matchBone`（而非 ADR-108 retargeter）；ADR-108 仅提供骨骼映射工具类 `AnimationRetargeter` 作为可选重映射手段。否则实施者会误判为开箱即用。 |
| 🟠 高P2 | `adr-121` §i18n 表格 | 标题称「5 语言」，表格仅列 zh/ja/en 三列，缺 ko / zh-TW；与风险表 P3「日/英/韩/繁体/简体齐全」自相矛盾 | 补齐 ko/zh-TW 两列全部 key，或明确标注「其余语言 P2 同步」并在验收项点名 5 文件。 |
| 🟠 高P2 | `adr-121` §数据模型 `MotionSource = 'vmd' \| 'retargeted'` | 在广播语义下，每模型 `resolve` 后得到的仍是 VMD / 基于 VMD 的 AnimationGroup，`'retargeted'` 二态语义与 ADR-108「重映射产物」概念混淆，定义模糊 | 澄清 `MotionSource` 含义：是「用户选择的原始来源类型」（库 VMD vs 已 retarget 的外部动画），还是冗余？建议说明或降级为可选字段。 |
| 🟡 中P3 | `adr-121` P1「吸收 `pendingVmd` 为 inherit 解析，移除零散变量」 | `pendingVmd` 定义在 `core/state.ts:108`（模块级 `let`），被 `scene.ts:489`、`__tests__/model-ops.test.ts:568` 等多处引用。ADR 未列出这些下游引用点 | 在 P1 实施清单增列「迁移/更新 `scene.ts:489`、`model-ops.test.ts` 等所有 `pendingVmd` 引用点」，否则移除会破测试与场景入口。 |
| 🟡 中P3 | `adr-121` 风险表缺并发维度 | `setActiveMotion`→`broadcastMotion` 遍历 `modelMap` 写 `inst.vmd*`，与 `model-loader` 加载写 `vmd*` 是**两条写入路径**；用户快速换/删模型时可能竞态（违背 AGENTS 审核铁律「并发守护」） | 引入 generation counter 或加载锁（参考 AGENTS「审核思维准则·并发与边界」）；明确 `resolve` 写入与加载写入的互斥策略。 |
| 🟡 中P3 | `adr-121` P1 UI 提示 `incompatible` | 场景级 store 是 `singleton let + 函数`，**无 Observable**；`status` 为运行时派生字段，UI 如何实时订阅 `motionAssignment` 变化以刷新 `incompatible` 提示未指明 | 明确订阅机制：store 是否需轻量事件（如 `onMotionChange` 回调 / 薄 Observable），使 `bind()` 驱动的 UI 能刷新；否则提示无法实时生效。 |
| 🟢 低P4 | `adr-121` 全文引用路径 | `core/types.ts`、`scene/manager/model-loader.ts`、`menus/motion-popup.ts` 均省略 `frontend/src/` 前缀 | 作为规划级文档，统一加 `frontend/src/` 前缀，避免 AI/新人误判根目录。 |
| 🟢 低P4 | `adr-121` §数据模型 `pinned?: SceneMotionIntent` | `pinned` 与场景级 `activeMotion` 同型；未说明 `pinned` 是**快照（深拷贝）**还是共享引用 | 注明 `pinned` 须 `structuredClone(activeMotion)` 冻结，避免全局改 `activeMotion` 时污染已 pin 实例。 |

---

## 审核思维准则走查（4 模型）

| 思维模型 | 走查结果 |
|----------|---------|
| **数据流追踪** | `activeMotion`（singleton store）→ `broadcastMotion` 遍历 `modelMap` 写 `inst.vmd*` + `inst.motionAssignment.status`；写入方从「菜单写聚焦模型」收敛为「单点广播策略」，路径更清晰。⚠️ 但 `pendingVmd`（旧路径）与 `activeMotion`（新路径）在 P1 过渡期并存，须防双写。 |
| **生命周期完整性** | `motionAssignment` 随 `ModelInstance` 创建/销毁自然配对，无独立资源泄漏风险；`resolve` 不持长生命周期对象，OK。 |
| **并发与边界** | ⚠️ 见 P3 竞态项：`broadcastMotion` 与 `model-loader` 加载为两条 `inst.vmd*` 写入路径，缺 generation/counter 守护。 |
| **异常契约** | `resolve` 兼容失败路径定义为「不动 inst.vmd*、status='incompatible'」，异常契约清晰（不覆盖、不抛给用户静默）。✅ 良好。 |

---

## 进入 P0 前的修订清单（门槛）

1. 【P1】改正 §背景/§数据流中关于 `resolve()` 复用 ADR-108 + `matchBone` 的断言，明确 `resolve` 为新函数、骨骼匹配复用 `proc-motion-shared.matchBone`。
2. 【P2】补齐 §i18n 表格 ko / zh-TW 两列，或显式限定 P2 同步范围。
3. 【P2】澄清 `MotionSource` 语义或降级为可选。
4. 【P3】P1 清单增列 `pendingVmd` 全部下游引用点（scene.ts:489、model-ops.test.ts:568 等）的迁移。
5. 【P3】明确 `broadcastMotion` 与加载写入的并发互斥策略。
6. 【P3】明确 `motionAssignment` 变化的 UI 订阅机制。
7. 【P4】统一路径前缀为 `frontend/src/`；注明 `pinned` 为深拷贝快照。

---

## 通过判定

满足「不变量边界正确 + 复用与兼容论证有力 + 风险分级清晰」三项优点，**但 P1 事实性过度承诺与 P2 i18n 缺口须在 P0 动工前闭合**。建议状态保持「规划」，修订后可直接进入 P0；当前不直接批准实施。
