# ADR-237: 超限模块拆分计划 —— 250LOC 天花板的优先级拆解路线图

> **状态**: 📝 规划（2026-08-03 审计摸查后登记；P1/P2 可随时实施，P3 需独立子 ADR）
> **日期**: 2026-08-03
>
> **编号**: 237
>
> **关联**: [ADR-236](adr-236-循环依赖消解.md)（循环依赖消解——同批审计摸查产出）、[ADR-130](adr-130-scene-ui-roadmap.md)（场景 UI 路线图，技术债治理）、ADR-093（菜单声明式 Schema，超大文件治理先例）、[ADR-108](adr-108-animation-retargeter.md)（动作重定向）
>
> **来源**: 2026-07 代码审核（`docs/audit/README.md`）标注 5 个模块超 250LOC 天花板（lighting 1229 / layers 611 / autodance 540 / perception 1155 / bridge 448）。2026-08-03 审计摸查复核现状：**perception 已拆 10 文件（round-8）、autodance 已拆至 148 行**，剩余 4 个超限模块中 3 个仍待拆分。本 ADR 登记拆分优先级与纪律，作为后续实施的路线图。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-08-03

---

## 1. 背景：250LOC 天花板与现状

项目代码审核规范（AGENTS.md「审核维度标准」）以 **250LOC** 为单文件可维护性天花板：超限文件增加认知负担、测试盲区与合并冲突概率。2026-07 审计标注 5 个超限模块，2026-08-03 摸查复核：

| 模块 | 审计时 | 当前 | 状态 |
|------|--------|------|------|
| `perception.ts` | 1155 | ✅ 已拆 | 10 文件（audit round-8），范本 |
| `proc-motion-autodance.ts` | 540 | ✅ 148 | 已瘦身 + proc-motion-bridge 测试覆盖 |
| `lighting.ts` | 1229 | 549 | 已拆一轮（transitionLighting → lighting-tween.ts），结构清晰 |
| `vmd-layers.ts` | 611 | 624 | 未拆，`_rebuildCompositeAnimation` 210 行单函数 |
| `proc-motion-bridge.ts` | 448 | 736 | 未拆，`ProcMotionController` 类 575 行 |
| `env-water.ts` | — | 1569 | 最大超限，内联状态多 |

**结论**：拆分先例已建立（perception/autodance），剩余模块按 ROI 排序可安全推进。

## 2. 决策：按 ROI 排序的拆分优先级

### P1 — proc-motion-bridge.ts 拆类（低风险高收益）

- **目标**：736 → ~350 行
- **拆法**：`ProcMotionController` 类（65-639 行，575 行单类）按职责拆 3 文件：
  - `proc-motion-controller.ts` — 状态机核心（`_startProcMotion`/`updateProcMotion`/`stopProcMotion`/`dispose`）
  - `proc-motion-setup.ts` — 启动/重生成（`regenerateProcMotion`/`createProcBeatDetector`）
  - `proc-motion-params.ts` — setter 群（`setProcMotionMode`/`setProcMotionIntensity`/`setBpmQuantizeEnabled` 等 18 个）
- **工具**：`npm run codemod move-function`（AST 感知）移方法；export 层（653-736 的 26 个薄转发函数）**保持原样**
- **风险**：低——转发层不动，调用方零改动；参照 perception 拆分先例
- **验证**：proc-motion-bridge 测试（lifecycle/state/toggles/tracking 4 文件）+ `check:funcmap`

### P2 — vmd-layers.ts 拆函数（中风险）

- **目标**：624 → ~400 行
- **拆法**：`_rebuildCompositeAnimation`（402-612，210 行）按路径拆 3 函数：
  - `_rebuildFallback` — 无图层/单图层回退路径（447-470）
  - `_rebuildComposite` — 多动画 `MmdCompositeAnimation` 合成（472-522, 584-607）
  - `_rebuildWasmBlender` — WASM blender 路径 + 失败降级（524-582）
- **风险**：中——函数间共享 `modelId`/`layersSnapshot`/`gen` 状态，需显式传参；`gen` 校验散布 4 处需保持
- **验证**：vmd-layers 测试（dispose/filter 2 文件 14 用例）+ `check:funcmap`

### P3 — env-water.ts 拆模块（高风险，需独立子 ADR）

- **目标**：1569 → ~900 行
- **拆法**：按 env 子系统先例（env-impl/env-water/env-terrain 拆分模式）拆 3 模块：
  - `env-water-material.ts` — 材质/着色器（Gerstner/泡沫/焦散 define）
  - `env-water-reflect.ts` — MirrorRT/反射（`_setupMirrorRT`/`_updateMirrorCamera`）
  - `env-water-fx.ts` — 涟漪/水下/LOD（`updateRipples`/`_applyWaterLOD`）
- **风险**：高——1569 行内联状态多、跨函数共享 `_envSys.water`；须先跑 env 子系统测试（8 文件 70+ it）锁基线
- **前置**：写独立子 ADR（触及 ADR-062/115/138 决策边界）；拆分时复核 `getScene()` null guard（历史 P1 已修，拆时验证不回归）
- **验证**：env 子系统全量测试 + 视觉回归（水面默认值逐像素一致）

### P4 — lighting.ts 维持（不拆）

- 549 行，已拆一轮，31 符号结构清晰（init/set/transition/dispose 四大块）
- 结论：**为拆而拆无收益**，维持现状；`transitionLighting` 已独立至 lighting-tween.ts

## 3. 拆分纪律（对齐项目规范）

1. 每步拆分后跑 `npm run check:funcmap`（函数签名变化校验）+ 相关模块单测
2. 用 `npm run codemod move-function`（AST 感知）移函数，**禁止 Python re.sub 手改跨文件引用**（AGENTS.md）
3. P3 需写 ADR（触及 env 子系统既有 ADR 决策边界）；P1/P2 走 buglog/知识卡同步
4. 拆前先 commit 基线（记忆规则：改前先 commit），拆分独立 commit 便于 review
5. 知识卡（`docs/knowledge/`）中相关卡同步更新 source_files/symbols；改完跑 `npm run check:docs`

## 4. 不在范围内

- **lighting.ts 继续拆分**（P4 否决，549 行结构清晰）
- **为拆而拆的过度模块化**：拆分以"职责边界清晰"为准，不以行数为唯一目标
- **运行时行为变更**：拆分是纯结构性重构，禁止改变任何可观测行为

## 5. 验证

- `check:funcmap`（函数签名无漂移）
- 相关模块单测全绿（proc-motion-bridge 4 文件 / vmd-layers 2 文件 / env 子系统 8 文件）
- `tsc --noEmit` 零错误
- P3 附加：视觉回归（水面默认值逐像素一致）
