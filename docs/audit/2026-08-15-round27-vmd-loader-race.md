# Round-27 审核 — vmd-loader-race.test.ts（VMD 加载基础校验 + gen counter）

> 审核测试文件 `frontend/src/__tests__/vmd-loader-race.test.ts`（152 行）及其覆盖的生产源码 `frontend/src/scene/motion/vmd-loader.ts`（381 行，重点行号区间：L41-57 常量与 isValidVmd、L60-177 loadVMDMotion 与 gen counter、L252-307 _tryLoadCompanionAudio）。

**总体结论：⚠️ 有条件通过**

- 测试可运行，12/12 通过（`npm run test -- src/__tests__/vmd-loader-race.test.ts`，35ms）。
- `isValidVmd` 段为**真实有效覆盖**：直接调用生产源码，边界充分（短头/空 buffer/错签名/最小合法边界/前缀部分匹配/null 填充），**已闭环 round-5 的 P1 缺口**（round-5-vmd-layers.md 处置记录：`isValidVmd` 零测试 → 待处理）。
- 但 gen counter 段与 AbortSignal.any 段为**镜像/无关测试**：gen counter 段自建 `Map` 复刻源码模式而非调用源码，生产逻辑改动不会使测试失败；AbortSignal.any 段与 vmd-loader 源码零绑定（源码中无 `AbortSignal.any` 调用）。防回归能力不足，是"补测"意图的部分背离。
- 生产源码本身体检健康：无 `as any`/`@ts-ignore`；round-5 报告的 L97 双重 cast 已消除（`using _animGuard` + `'dispose' in` 类型守卫）；gen counter 递增时机与 stale 校验路径正确。

## 亮点

| 模式 | 位置 |
|------|------|
| WASM 动画资源释放用 `using` 声明收口：`transferred` 标志 + `[Symbol.dispose]`，stale/stage/绑定失败任何早期 return 或异常均自动 dispose，编译器保证无遗漏释放点 | vmd-loader.ts:116-125 |
| gen counter 按模型隔离（`_vmdLoadGenMap: Map<string, number>`），注释明确记录"全局单例会导致多模型同时加载互相干扰"，递增/捕获/校验三点完整（L100-102 递增、L128 校验、L272/L293 伴音侧复用） | vmd-loader.ts:41-43, 100-102, 128-132 |
| `isValidVmd` 签名校验仅解码前 25 字节（`TextDecoder('ascii')`），天然容忍 VMD 签名后的 \0 填充，与 writer 侧 `'...0002\0'` 30 字节布局兼容 | vmd-loader.ts:51-57 |
| 测试构造头部用源码常量推导（`VMD_HEADER_MIN + 4` + `VMD_SIGNATURE`），避免与实现漂移 | vmd-loader-race.test.ts:17-21 |
| 测试环境 `@vitest-environment node` 恰当（无 DOM 依赖），无任何 skip 测试 | vmd-loader-race.test.ts:1 |
| `loadVMDMotion` 的 AbortError throw（L67/L82）位于 try 块之外，不会被外层 catch 吞掉，中止语义不被伪装成普通失败 | vmd-loader.ts:67-69, 82-84 |

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | vmd-loader.ts:46 / vmd-writer.ts:37 | `VMD_SIGNATURE` 双定义 | loader 导出 `'Vocaloid Motion Data 0002'`（25 字符），writer 私有 `'Vocaloid Motion Data 0002\0'`（30 字节含 \0）。两处是同一签名的两种表述，若任一侧改动而不同步，`isValidVmd` 将误判全部 VMD（false positive/negative） | 单一来源：writer 从 loader 导入常量（或抽公共常量文件），writer 侧拼 `\0` 时用 `VMD_SIGNATURE + '\0'` |
| 🟡 P3 | vmd-loader-race.test.ts:74-110 | gen counter 段为镜像测试 | 自建 `Map` 复刻与源码相同的 `(get ?? 0) + 1` / `!==` 比较逻辑，不调用生产代码。源码若改实现（如改 `Record`、改判定为 `<`），测试仍全绿——无法防回归，与"审核缺口补测"意图部分背离 | 将 gen 逻辑提取为可导出纯函数（如 `nextLoadGen(map, key)` / `isStaleGen(map, key, gen)`），测试直接调用；或对 `loadVMDMotion` 做集成测试（mock `getScene`/`modelRegistry`/`mmdRuntime`）验证真实 stale 丢弃 |
| 🟡 P3 | vmd-loader.ts:60-66, 106 | signal 未传入 `loadFromBufferAsync` | babylon-mmd 该 API 签名 `(name, buffer, onProgress?)` 无 AbortSignal 参数，`loadVMDMotion` 的 signal 仅在入口（L67）与 `getScene()` 之后（L82）检查。加载进行中 abort 无法中断，结果仍会继续绑定动画（gen counter 只覆盖"同模型新加载"竞态，不覆盖纯 abort）——`loadVMDFromPath` L241-243 注释声称的"loadVMDMotion 在 signal 中止时抛此错"仅在入口/import 阶段成立 | 文档化该限制；或加载完成、绑定前补一次 `if (signal?.aborted) return` 检查（stale 守卫旁），使 abort 至少不落盘动画 |
| 🟡 P3 | vmd-loader.ts:128-132 + 197-235 | stale 丢弃后调用方继续写库 | `loadVMDMotion` stale 分支仅 `return`（不 throw），`loadVMDFromPath` 无返回值/状态判断，继续执行 `foc.vmdPath = path`、`replaceDefaultMotion`、`addRecentMotion`——被丢弃 VMD 的路径仍会写入场景默认动作与最近列表，若后到的加载失败则库状态与真实绑定不一致 | stale 分支抛出可辨识错误（或返回枚举），`loadVMDFromPath` 据此跳过副作用；或 stale 时仅保留"最近动作"记录而跳过默认动作写入 |
| 🟢 P4 | vmd-loader-race.test.ts:112-151 | AbortSignal.any 段与目标模块无关 | 测试的是原生 API 合并语义，vmd-loader.ts 源码无 `AbortSignal.any` 调用（实际使用方是 model-loader.ts:441 / library-core.ts:273-275）。L144 `_wrong` 变量从未断言（死代码），第二个用例实际只验证 `correct.aborted` | 移入 model-loader/library-core 相关测试，或直接删除；至少删除 `_wrong` 死代码 |
| 🟢 P4 | vmd-loader.ts:47 | `VMD_HEADER_MIN` 注释表述含糊 | 注释"30(签名+模型名) + 4(骨骼帧数) 的最小合法头部 = 50"与实测布局不符（实际为 30 签名含 \0 填充 + 20 模型名 = 50，帧数前缀在其后，54 才含帧数）。注释易误导后继者改错常量 | 改为"30(签名含填充) + 20(模型名) = 50"；如需含帧数前缀另设 `VMD_HEADER_WITH_FRAME_COUNT = 54` |
| 🟢 P4 | vmd-loader.ts:43, 272, 293 | gen map 生命周期与 key 不一致 | `_vmdLoadGenMap` 条目永不删除（模型卸载后残留、数字无限递增，长会话内存微量增长）；`_tryLoadCompanionAudio` 用 `targetModelId \|\| ''` 作 key 与 `loadVMDMotion` 的 `targetId`（fallback focusedModelId）不一致，现网唯一调用点 L239 恒传非空 id 使守卫短路分支实际不可达，但防御脆弱 | 模型卸载时 `_vmdLoadGenMap.delete(id)`；统一 key 计算函数 |
| 🟢 P4 | vmd-loader.ts:55, 163 | 魔法数值 | L55 硬编码 `25`（签名长度，可用 `VMD_SIGNATURE.length`）；L163 硬编码 `/ 30`（VMD 帧率换算） | 引入命名常量 `VMD_SIGNATURE_LEN = VMD_SIGNATURE.length` 与 `VMD_FPS = 30` |
| 🟢 P4 | vmd-loader.ts:130, 119 | stale 反馈语义 / using 孤例 | stale 丢弃时 `feedbackStatus('scene.vmd.loadFailed')` 语义为"被更新的加载取代"而非失败，快速连切 VMD 时 UI 可能闪失败提示后成功；`using` 语法为全仓孤例（另见 frontend/src grep `Symbol.dispose` 零命中） | 考虑独立文案（如 loadDiscarded）或复用 loading 提示；如采用 `using` 模式可推广至其他 WASM 句柄管理点 |

## 测试质量评价

**结构**：3 个 describe（isValidVmd 签名校验 / gen counter 行为 / AbortSignal.any 合并逻辑），12 用例，`@vitest-environment node`，全部通过，无 skip。测试自身类型安全，无 `any`。

**有效段（describe 1，9 用例）— 质量良好**：
- 直接 `import { isValidVmd, VMD_SIGNATURE, VMD_HEADER_MIN }` 调用真实源码，断言有效。
- 边界覆盖完整：过短（10/49 字节）、空 buffer、错签名（100 字节）、合法签名（100 字节）、**最小合法边界恰 50 字节 → 接受**、**边界下方 49 字节 → 拒绝**（成对边界最易发现 ±1 错误）、null 填充至 30 字节（真实 VMD 头部格式）、前缀部分匹配少 1 字符 → 拒绝。
- 构造 helper 用源码常量推导长度，防漂移（好实践）。
- 唯一小缺口：未覆盖 `byteLength ≥ 50` 且签名位于 buffer 起始但前 25 字节含非 ASCII 的情况（ascii decoder 会替换为 U+FFFD → 拒绝，行为正确但未锁定）。

**弱段（describe 2，2 用例）— 镜像测试，防回归能力为零**：
- 自建 `Map` 复刻源码的 `(get ?? 0) + 1` 与 `!==` 模式，测试的是"测试自己的复制品"。注释虽诚实标注"间接验证"，但生产实现任何改动（改 `Record`、改比较方向）都不会使测试失败——与补测的初衷背离。
- 价值仅存于"行为文档"层面。改进方向见风险表 P3 #2（提取纯函数或集成测试）。

**无关段（describe 3，2 用例）— 与目标模块零绑定**：
- `AbortSignal.any` 在 vmd-loader.ts 中不存在（消费方是 model-loader.ts:441 与 library-core.ts:273-275），本文件 import 的是 vmd-loader，该段对被测模块无覆盖价值；且 L144 `_wrong` 为从未断言的死代码，第二个用例断言强度弱（仅 1 个 expect）。

**与 round-5 审核的关系**：
- round-5 P1「`vmd-loader.ts` `isValidVmd` 零测试」→ ✅ 已闭环（本测试 describe 1 有效覆盖）。
- round-5 P2「`vmd-loader.ts:97` 双重 cast」→ ✅ 已修复（L112-125 `using` + `'dispose' in` 类型守卫替代 `as unknown as`）。
- round-5 P1「`_tryLoadCompanionAudio`（Promise.any 竞速）零测试」→ ⬜ **仍遗留**：本测试仅间接模拟 gen counter，未直接验证 Promise.any 探针、失败静默、伴音竞态丢弃等行为。测试文件头注释已声明"仅覆盖可隔离测试的单元"，属可接受的范围裁剪，但缺口本身未关闭。

## 结论

测试文件自身可运行（12/12 绿），`isValidVmd` 段有效补齐 round-5 P1 缺口，生产源码健康度良好（无新增类型逃生、资源释放收口到位、gen counter 并发语义正确）。但 2/3 的 describe 为镜像/无关测试、未绑定生产代码，加上源码侧 4 处 P3 观察（签名常量双定义、signal 未贯穿加载、stale 副作用外溢、gen 测试不可防回归），综合判定 ⚠️ 有条件通过：可合入，但建议后续将 gen 逻辑提取为可测纯函数、收敛签名常量，并跟进遗留的 `_tryLoadCompanionAudio` 测试缺口。

---

审核日期：2026-08-15
审核员：子代理 round27-vmd-loader-race
