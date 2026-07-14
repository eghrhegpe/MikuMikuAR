# 环境系统代码审核 — 验证性 Triage（2026-07-14）

> 对外部代码审核（覆盖 12 个 `frontend/src/scene/env/*` 文件）逐条核对真实代码后的结论。
> 方法论：信任但验证 —— 每条主张均定位到源码 file:line 复核，区分「真实 Bug / 已闭环 / 误报 / 可维护性建议」。

## 总体结论

**该审核对当前代码库高度过时（stale），且含多处误报（false positive）。**

- 被标为「🔴 高优先级立即修复」的 3 项，**全部已在当前代码中闭环**，且代码注释明确标注了"修复前…此处一并写入"——典型特征是审核基于旧快照或浅层/幻觉生成。
- 其余中/低优项绝大多数为**可维护性建议**，非运行时 Bug；少数为技术上不成立/不推荐的改动。
- **建议：勿据此审核直接改动生产代码**，以免引入回归或噪声。

## 逐条核验

| # | 文件 | 审核主张 | 验证结论 | 证据 | 级别 | 行动 |
|---|------|----------|----------|------|------|------|
| 1 | `accessory.ts` | `detachPropFromBone` 用 `getRotationMatrix()+FromRotationMatrix` 对非均匀缩放不准，应改 `decompose()` | **误报（部分）**。Babylon `Matrix.getRotationMatrix()` 内部已剥离缩放，返回纯旋转矩阵，旋转提取正确。唯一真实缺口：`target.scaling` 未恢复（骨骼通常 scale=1，影响极小） | `accessory.ts:116-117` | 🟡 P3 | 可选小改；非 Bug 修复 |
| 2 | `env-water.ts` | `applyWaterPresetToCurrent` 直接改材质不进 `envState`，刷新丢失 | **已闭环（stale）**。`buildWaterPresetEnvState()` 返回含扩展参数的 `Partial<EnvState>`；UI 在 `env-feature-levels.ts:721` 同时调用 `setEnvState(buildWaterPresetEnvState(wp))` 持久化 + `applyWaterPresetToCurrent(wp)` 应用 uniform。注释 `env-water.ts:1164` 明确"修复前…不进 envState…此处一并写入" | `env-water.ts:1162-1250`；`env-feature-levels.ts:721-722` | ✅ 已闭环 | 无 |
| 3 | `env-particles.ts` | `disposeParticles` 未 `clear()` Map；fireworks `setTimeout` 递归可能泄漏 | **误报**。`disposeParticles` 已在 `:453` 调用 `_particleTextures.clear()`；fireworks 已有单例 `_fireworkScheduler`（`:616/:691`），并在 `scheduleNextFireworkBurst` 内检查 `_currentParticleType !== 'fireworks'` 提前 return 停止续排，`stopFireworks`（`:704`）`clearTimeout` | `env-particles.ts:433-453, 616, 689-712` | ✅ 已实现 | 无 |
| 4 | `env-texture.ts` | 模块直调 `createCanvasTexture` 绕过缓存会泄漏；应强制走 `getOrCreateCanvasTexture` | **部分有效（P3 可维护性）**。`disposeTextureCache`（`:114-118`）正确 dispose+clear。但确有 3 处直调绕过缓存：`env-impl.ts:620`（地面）、`env-water.ts:276`（焦散）、`env-particles.ts:68`。这些依赖各自模块 dispose 时手动释放——属「约定未强制」而非确认泄漏 | 见上述 3 处调用点 | 🟡 P3 | 可选：补归属注释或路由进缓存（需稳定 key） |
| 5 | `planar-reflection.ts` | `_mutexDisabled` 运行期注入属性，破坏 TS 类型安全 | **误报**。`_mutexDisabled` 是 `PlanarReflection` 类在 `:121` 显式声明的 `private _mutexDisabled = false;` 成员；`requestExclusive` 中 `as PlanarReflection & { _mutexDisabled: boolean }` 仅是跨模块访问私有成员的断言，类型已存在 | `planar-reflection.ts:88, 102, 121` | ✅ 误报 | 无 |
| 6 | `env-bridge.ts` | perf `logWarn` 生产环境大量输出影响性能 | **弱化（P4）**。日志均在 `performance.now()-start > 2ms` 阈值（`:347/:556`）或 observer>100（`:567`）时才输出，非无条件刷屏。但确走 `console.warn` 且无全局 DEBUG 开关 | `env-bridge.ts:347, 532, 556, 567` | 🟢 P4 | 可选：perf 前缀加 DEBUG 开关 |
| 7 | `env-impl.ts` | `getGroundHeightAt` 非均匀缩放+倾斜矩阵运算 | **有效（P3）**。实现已含 `isFinite` 守卫 + 世界→本地→世界逆矩阵变换（`:863-888`），逻辑正确。仅缺非均匀缩放+倾斜组合的单测覆盖 | `env-impl.ts:847-896` | 🟡 P3 | 建议补单测 |
| 8 | `env-impl.ts` | `applyGround` `typeKey` 变更检测复杂易错，建议版本号/脏标记 | **可维护性建议（P3）**。当前 key 字符串变更检测可用且正确（`:1034-1040/:1090`）。逐字段 version 反而增代码量。补注释说明 key 组成即可 | `env-impl.ts:1030-1090` | 🟡 P3 | 可选：补注释 |
| 9 | `props.ts` | `getBaseName` 假设 Unix 路径，Windows 下返回完整路径/空 | **误报**。`getBaseName` 来自 `@/core/utils`（`:18` 导入），内部先 `normPath(p)`（`:35`），`normPath` 已做「反斜杠→正斜杠」（注释 `:31`），Windows 路径正确 | `props.ts:18,62`；`utils.ts:34-38` | ✅ 误报 | 无 |
| 10 | `env-clouds.ts` | `discard` 影响 Early-Z；3D 噪声应 `createMipmaps()` | **P4 / 不推荐**。`discard` 对全屏体积云透明面为标准做法，用于避免深度写入，替 `alpha=0` 无实质收益；体积噪声采样要高频各向同性细节，3D mipmap 通常不需要甚至引入模糊，建议维持 | `env-clouds.ts:236, 291, 298, 337` | 🟢 P4 | 无（不建议改） |
| 11 | `env-terrain.ts` | CPU 高度图生成瓶颈，应上 GPU | **P3 架构性**。当前 256² 可接受；GPU 生成是未来可选项，非当前 Bug | `env-terrain.ts` | 🟡 P3 | 记录技术债，暂不处理 |
| 12 | `env-lighting.ts` | `calcLuminance` 用 sRGB 系数于线性空间不准确 | **P3 视觉细微**。Babylon 默认线性渲染，固定 `0.299/0.587/0.114` 略有偏差，但仅影响光强推算细微观感，影响极小 | `env-lighting.ts` | 🟡 P3 | 可选：引入线性亮度系数，收益低 |

## 可落地改进清单（如决定实施，均为低风险）

1. 🟡 `getGroundHeightAt` 补「非均匀缩放 + 倾斜」组合单测（`env-impl.test.ts`）。
2. 🟡 给 `env-impl.ts:620` / `env-water.ts:276` / `env-particles.ts:68` 三处直调 `createCanvasTexture` 补注释，声明其 dispose 责任归属，或路由进 `_texCache`（需稳定 key）。
3. 🟡 `applyGround` 的 `typeKey` 补组成注释（不改逻辑）。
4. 🟢 perf 日志（env-bridge 内 `perf:` 前缀）加全局 DEBUG 开关（当前已阈值门控，影响极低）。

## 结论

当前环境系统代码的内存清理、状态持久化、互斥类型安全、Windows 路径处理**均已正确实现**，且对审核所提多项问题已有注释级"已修复"标记。该审核不具备直接执行的依据。建议将本 triage 作为唯一权威结论，避免基于过时/误报审核引入回归。
