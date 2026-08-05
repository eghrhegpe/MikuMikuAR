# ADR-250: 场景初始化重入与异常一致性 —— initScene 重入守护 + 中途异常状态复位

> **日期**: 2026-08-06
> **状态**: ✅ 已立（2026-08-06 立项；来源审核第 15 轮：`scene.ts` 编排器幽灵路径——`initScene` 无重入守护、`_sceneInitialized` 中途抛异常不复位。本 ADR 固化决策，实现可后续跟进）
> **编号**: 250
>
> **关联**: [ADR-099](adr-099-mpr-coop-coep-poc.md)（场景核心编排器，纯组装器）、[ADR-244](adr-244-init-phase-split.md)（初始化阶段拆分，initScene 编排）、[ADR-106](adr-106-timing-audit-and-async-lifecycle.md)（HMR 幂等，disposeEnvUpdateObserver 首启 no-op 先例）、[ADR-204](adr-204-unit-test-layering-and-hygiene.md)（测试分层）
>
> **来源**: 2026-08-05 第 15 轮代码审核（`docs/audit/`）幽灵路径：`scene.ts` `initScene()`（L355-410）无重入守护——若被快速连续调用两次，两次并发执行 `_initMmdRuntime`/`initLighting` 等，资源重复创建；且 `_sceneInitialized = true`（L410）在初始化中途之后才置位，若 `_initMmdRuntime` 抛异常，标志保持 false，下次调用走 HMR 重建路径而非干净重试，旧资源未释放。

**决策者**: AtomCode（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

---

## 背景

### 触发证据：重入与异常一致性缺口（scene.ts）

```ts
export async function initScene(): Promise<void> {
    if (_sceneInitialized) {
        await _reinitSceneForHMR();   // 仅已初始化才走清理
    }
    const runtime = await _initMmdRuntime();  // ← 若此处抛异常
    ...
    _sceneInitialized = true;          // ← 标志置位在最后
}
```

| 场景 | 现状行为 | 风险 |
|------|---------|------|
| 快速连续两次 `initScene()` | 两调用均见 `_sceneInitialized === false`，并发执行初始化 | 重复创建 runtime/lighting/renderer，资源泄漏或状态错乱 |
| `_initMmdRuntime` 中途抛异常 | 异常上抛，`_sceneInitialized` 保持 false，部分子系统已初始化 | 下次调用走 `_reinitSceneForHMR` 清理（旧引用可能半初始化），或干净路径重建但旧资源未释放 |
| HMR 重入（`_reinitSceneForHMR`） | 内部 `disposeScene()` 后重建，顺序正确 | 低风险，但依赖 `disposeScene` 全量释放 |

同族风险：`initLoader`/`_initModelManager`/`_initMotionSubsystems` 等子初始化函数同样无重入保护，若未来被独立触发（bridge 注册 `initScene` 可经 action 调用），需统一约束。

## 决策

1. **`initScene` 必须可重入安全**：入口处用进行中标志（如 `_initInProgress: Promise<void> | null`）串行化——第二次调用返回同一 Promise（或等待其完成），禁止并发执行两次初始化。
2. **异常一致性：失败即回滚标志**：`_sceneInitialized` 只在初始化**全部成功**后置位；中途抛异常时，`finally` 中清理已创建的部分资源（或至少复位初始化状态，使下次调用走干净重试），并复位进行中标志——`try/catch/finally` 三件套，禁止裸 `await` 链。
3. **失败可重试**：初始化失败后，下一次 `initScene()` 应能干净重试（新 runtime/engine），不因残留半初始化状态而再次失败。
4. **子初始化函数同样约束**：`_initMmdRuntime` / `_initModelManager` / `initLoader` 等模块级初始化函数，若可被外部触发，同样加进行中标志或文档化「仅由 initScene 串行调用」约束。
5. **与 ADR-244 衔接**：`init()` 阶段拆分（ADR-244）已把初始化压成 4 阶段函数，本 ADR 在其上加「阶段间失败 → 阶段级清理」的异常契约，不重复拆分。

## 影响

- **修改文件**：`scene/scene.ts`（`initScene` 加重入串行 + try/finally 复位）。**未实施**——本 ADR 立决策，实施待后续排期（现状触发概率低：`initScene` 仅经 bridge 一次调用，但 bridge 可被 action 触发，且 HMR 高频路径已有 `_reinitSceneForHMR` 防护）。
- **测试**：`scene-model.test.ts` / `scene-stage.test.ts` 均 mock 掉 `scene.ts`，不测编排逻辑（ADR-204 缺口）；建议补 `initScene` 重入 + 异常复位集成测试（P3 建议）。
- **验证**：现状相关测试通过；实施后重跑场景初始化相关测试。

## 回滚

若确认 `initScene` 在应用生命周期内严格单次调用（bridge 保证），可放宽重入守护——但 HMR 重入路径已存在，统一守护成本低，默认保留。

## 检查清单（供 code review / 子代理审核复用）

- [ ] `initScene` 入口有进行中标志，二次调用不并发执行
- [ ] `_sceneInitialized` 仅全部成功后置位；中途异常走 finally 复位
- [ ] 初始化失败后可干净重试，无半初始化残留
- [ ] 子初始化函数（_initMmdRuntime 等）有串行约束或文档化
