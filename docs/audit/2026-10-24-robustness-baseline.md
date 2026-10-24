# 健壮性专项体检报告（2026-10-24）：全仓基线 + 静态信号扫描 + 登记债复核

**体检范围**
- 基线 HEAD：`ea042cd7`（chore: 合批 v1.10.2 之后的工程治理线 65 commits），工作区另有未提交 `docs/status.md` 改动 + 未跟踪 `docs/adr/adr-276-strict-null-rollout.md`
- 实测基线：`cd frontend && npm run test:quick` → **263 文件 / 6086 用例全绿，exit 0，167s**（2 workers forks）
- 静态扫描口径：`grep -rEn` over `frontend/src`（生产 = 排除 `__tests__`/`*.test.ts`/`mocks.ts`）+ `internal/**/*.go`
- 复核对象：`docs/audit/` 155 篇报告中登记「未修复 / 搁置 / 留待」的条目 + `docs/buglog/2026-08-16-audit-p3-observations.md`

**总体结论：✅ 通过（无 P1；1 项系统性缺口 + 2 项登记未修实债）**

类型卫生与资源配对比预期干净：生产 `as any` 仅 2 处且均带注释、`@ts-ignore` 0 处、空 catch 0 处、Go panic 全在测试侧。真正的软肋是 **ADR-276 Stage 2 `strictNullChecks` 未收口（362 处 / 生产 163 处 / 46 文件）**——编译器当前对 null 完全失明，这是全仓唯一系统性缺口。另有 2 项经两轮审计复核仍开放的实债（NullEngine 泄漏 P2、递归无深度限制 P3）。

---

## 一、实测基线

| 项 | 读数 | 判定 |
|---|---|---|
| `npm run test:quick` | 263 文件 / 6086 用例 **全绿**，exit 0，167.09s（transform 17s / import 126s / tests 41s / env 72s） | ✅ 无回归 |
| 工作区 | `M docs/status.md`、`?? docs/adr/adr-276-strict-null-rollout.md`（ADR-276 批 A 进行中，见 `docs/adr/adr-276-strict-null-rollout.md:98`） | ⚠️ 有并行线痕迹，改动前须确认归属 |

## 二、类型与异常卫生（静态扫描）

| 维度 | 生产读数 | 测试读数 | 判定 |
|---|---|---|---|
| `as any` | **2 处**：`frontend/src/core/mmar-globals.ts:156`（纯注释行）、`frontend/src/scene/env/env-water-material.ts:338`（`(scene as any).depthRenderer?.getDepthMap?.()`，可选 API 探测，带注释） | 751 处，集中在 `core/frame-registry.test.ts`（mock 调用断言惯用法） | ✅ 远优于 audit-playbook 红线 |
| `@ts-ignore` / `@ts-nocheck` | **0 处** | 20 处，全为 `vi.mock` 运行时替换的 mock 文件（`library-core-mocks.ts`、`model-manager-mocks.ts` 等 7 文件同构），`camera-state.test.ts:284-321` 4 处为删 `ontouchstart` 隔离分支 | ✅ mock 惯用法，非缺陷 |
| 空 catch 块 `catch {}` | **0 处** | 6 处全在 `frontend/src/__tests__/env-bridge/env-mocks.ts:295-332` | ✅ |
| catch 总数 / 带日志 | 503 处 / 17 处带 `logWarn`|`logError` | — | ✅ 见下「静默降级辨析」 |
| Go `panic(` | **生产 0 处**（8 处全在 `internal/util/safecall*_test.go`） | — | ✅ |
| Go `recover()` | 2 处均在 `internal/util/safecall.go:13,29`（zip 解压 panic → error 包装），另有 `internal/app/ai_binding.go:86` | — | ✅ 收敛在工具层 |
| Go `_ = ` 忽略 err | 32 处，逐条核实均为收尾语义：`proxy.go:645-733`（502 响应写出/连接 Close/`io.Copy`）、`integration.go:66,129,247,274`（`cmd.Wait()` 防僵尸进程，注释明确）、`watch.go:346,511`（`MkdirAll`）、`app.go:908`/`watch.go:300`（config 更新回调） | — | ✅ 合理 |

**静默降级辨析（503 处 catch 为何只有 17 处带日志）**：抽检全部无日志 catch，绝大多数是**有注释的有意降级**而非吞错——`frontend/src/core/audio.ts:367`（自动播放被浏览器拦截，注释说明 StreamAudioPlayer 内部有静音先行→unmute 策略）、`frontend/src/core/ai/chat-store.ts:67,81`（读路径降级返回 `[]`/`undefined`，写路径 :87 反而留日志）、`frontend/src/core/ai/intent-dispatcher.ts:18`（LLM 输出解析失败返回 null 交由上层）、`frontend/src/core/ai/browser-adapter.ts:136`/`character-bible.ts:119`（`/* ignore */`、`/* 落入兜底 */`）。**判定：无语义缺失，不建议批量补日志**——ADR-248 已禁热路径裸调 `logWarn`，补日志反而制造噪声。

## 三、资源生命周期配对

| 资源 | 创建 | 释放 | 差额性质 |
|---|---|---|---|
| `setInterval` | 9（`audio.ts:264`、`mmar-globals.ts:201`、`render-loop.ts:153` 等） | `clearInterval` 5 | 差额 = `toast.ts`/`status-bar.ts` 等用 `clearTimeout` 清理的 timer 句柄复用（`ReturnType<typeof setInterval>` 类型 + `clearTimeout` 调用，JS 语义等价） |
| `requestAnimationFrame` | 11 | `cancelAnimationFrame` 3 | 差额 8 处为**一次性短 RAF**：`core/async.ts:29`（nextFrame 工具）、`library-core.ts:631`（分批渲染尾帧自止）、`ui-collapsible.ts:133`（初始化展开一帧）、`reactivity.ts:32`、`menu.ts:659`（有 `cancelAnimationFrame` 在 :886 dispose）、`ui-virtual-grid.ts:132`（:130/:181 有取消）、`model-loader.ts:205`、`model-material.ts:395` | ✅ 无可取消而没取消的长生命 RAF |
| Babylon Observer/`new` | 见各 round 审计（round-17 dispose-helpers、round-30/32 均有专项结论） | — | ✅ 已由前序审计闭环 |

**判定：资源配对完整**，无「创建点无释放点」的长生命周期资源。`render-loop.ts:62-64` 与 :153/:168 明确幂等 stop 防 HMR 重复泄漏（注释记录修复动机）。

## 四、并发与防御信号

- `_loading`/`_pending`/`_busy`/`transitioning` 标志：生产 138 处——菜单异步竞态防线已成体系（`ea042cd7` 治理线的 `guard/guardedRun` + `_buildSeq` 双守卫，见 `frontend/src/menus/menu.ts:1378` 与 commit `c28e3425`/`ccecf204`）。
- NaN/`isFinite`/`guardNum` 防御：生产 155 处，覆盖渲染数学、颜色、滑块（`2026-08-12` 三个「测试反推源码」commit 的系统成果）。
- `AbortController`/`AbortSignal`：生产 68 处，异步加载可取消。
- `disposed` 守卫：47 处。

## 五、系统性缺口（全仓唯一，已关闭）

~~🟠 **ADR-276 Stage 2 `strictNullChecks` 未收口**~~ → **已关闭（2026-10-24）**：：影子实测 **362 处 / 76 文件**（生产 163 / 46，测试 199 / 30），按错误码 TS18047×113 · TS2345×88 · TS2454×72 · TS2322×43 · TS18048×16 · TS2722×10 等 14 种。生产热点：`scene/manager/model-loader.ts`(16)、`scene/motion/proc-motion-controller.ts`(13)、`scene/manager/outfit.ts`(11)、`menus/library-actions.ts`(9)、`menus/library-setup.ts`(9)、`menus/model-detail.ts`(9)、`scene/scene-serialize.ts`(9)。

关键性质（引自 `docs/adr/adr-276-strict-null-rollout.md:28-46`）：**362 不是 362 个决定，而是「少数根 + 一批同一根的回声」**——抽查 40 处中 21 处塌进 3 个根因（`model-loader.ts:73` `_modelManager` 单根 9 处、`proc-motion-controller.ts:128` `modelIdAtStart` 单根 12 处、`outfit.ts:270` `_applySlot` 签名单根 9 处）。ADR 决策 1 已锁死三种收口改法（`requireX()` 访问器 / 早返回 / 签名放宽），**禁止逐处 `!`**；决策 6 要求早返回改变控制流的路径必须有测试覆盖。

排期依据：ADR-276 实施计划四批（批 A 97 处进行中 / 批 B 123 / 批 C 142 / 批 D 落地开关）。**注意 ADR-274 记的 386 已作废，以 362 为准**（`docs/adr/adr-276-strict-null-rollout.md:24`）。

> **修订记录（2026-10-24 晚）**：体检完成后，并行工程治理线已将 ADR-276 Stage 2 与 ADR-277 Stage 3 一次落地，`frontend/tsconfig.json` `strict: true` 全开（noImplicitAny / strictNullChecks / strictFunctionTypes / strictBindCallApply / strictPropertyInitialization / noImplicitThis / alwaysStrict；noUnusedLocals / noUnusedParameters / noImplicitReturns 仍 false）。本节描述的 362 处影子错误已由该开关落地时统一收口，**本节结论作废，仅留作历史记录**。

## 六、登记未修实债复核（逐条读当前源码确认）

| 严重度 | 文件 | 位置 | 复核结论 | 来源 |
|---|---|---|---|---|
| 🟠 P2 | `frontend/src/motion-algos/vmd-evaluator.ts` | :276 | **已修复（本轮）**。`_getSharedScene()` 内 `new NullEngine()` 为局部变量未存模块级；`shutdownVmdEvaluator()` 只释放 Scene，引擎留 `EngineStore.Instances` 至进程结束。**修法**：模块级 `let _sharedEngine: NullEngine | null`，scene 与 engine 配对释放（先 scene 后 engine，scene.dispose() 依赖 engine 仍在）；测试用 spy `NullEngine.prototype.dispose` 计数断言（node 环境 EngineStore.Instances 不注册，计数法不可跨环境断言） | round-15 P2#2 → round-48 复核仍开放 → 本轮闭环 |
| 🟠 P2 | `frontend/src/motion-algos/vmd-evaluator.ts` | :282-289 | **已修复（本轮）**。`createVmdEvaluator` 无 try/catch，解析异常裸 reject。**修法**：try 包 `loadFromBufferAsync`，转抛 `VMD parse failed (N bytes): <原因>`（带 `cause`，reject 语义不变）。**消费链更正**：生产唯一调用方 `wasm-layers-blender.ts:171`（addWasmLayer）本就被 `vmd-layers.ts:657` `_tryWasmBlender` 的 try/catch 全兜底 + :631 console.error 双层覆盖，原报告「未见兜底」表述不准确；本次修复价值在错误上下文而非崩溃防护 | round-15 P2#3 → round-48 复核仍开放 → 本轮闭环 |
| 🟡 P3 | `frontend/src/scene/motion/perception-breathing.ts` | :77-81 | **已修复（本轮）**。`_updateBoneChain` 递归原无深度限制；真实 MMD 骨骼树无环且深度 ≤10（`perception-shared.ts:186` 注释），栈溢出仅对畸形/环状数据成立。**修法**：`_BONE_CHAIN_MAX_DEPTH = 64`（真实深度 ≤10，留余量），export 签名不变转调内部 `_updateBoneChainDepth(bone, depth)`，超限只截断传播不抛错（单帧不更新由下一帧自愈）。**同文件 :47-53 的 `linkedBone` 判空已修**（`spine.linkedBone?.rotationQuaternion`，round-15 P1-2 → round-44 降级 P2 → 现已闭环，注释对齐 `perception-balance.ts:78,92` 模式） | round-15 P2-3 → round-44 复核仍开放 |
| 🟡 P3 | `frontend/src/scene/motion/proc-motion-shared.ts` | :128-132 vs :79-85 | **已修复（本轮）**。`mergeParams` 嵌套分支 `...p` 直接透传不过 `guardNum`，扁平分支过 `guardNum`——`params.idle.intensity = NaN` 可进入渲染数学（防御不对称）。**修法**：嵌套分支 `intensity`/`speed` 补 `guardNum`，与扁平分支对齐（消费侧 `proc-motion-idle.ts:29`/`proc-motion-autodance.ts:63` 无二次防护，NaN×系数静默污染骨骼） | round-21 → 本轮闭环 |
| 🟡 P3 | `frontend/src/scene/render/lighting.ts` | :453-463 | **仍开放**（观察级）。`transitionLighting` 提前返回路径漏调 `_clearGuardWarn()`；实际影响极低（提前返回意味着灯光已就绪，就绪态 `_guardWarnedKeys` 通常已空） | buglog 2026-08-16 观察 1 |
| 🟡 P3 | `frontend/src/scene/env/env-lighting.ts` | :391-392 | **仍开放**（观察级）。`raw.skyColorTop.length === 3` 严格校验拒 4 元组旧存档（静默返回 null 不崩溃）；全库无 4 元组历史证据，触发概率极低 | buglog 2026-08-16 观察 2 |
| 🟡 P3 | `frontend/src/core/ui-fullscreen-overlay.ts` | :104-106 | **仍开放**（观察级）。`setCurrentState('CLOSED')` 强复位不清冻结菜单/overlay/`_cleanupMap`；目前仅测试用，`beforeEach` 顺序掩盖了问题 | buglog 2026-08-16 观察 3 |
| 🟠 P2 | `frontend/src/scene/manager/model-manager.ts` | :1227 | **已修复**（不再开放）。round-22 P2 `childIsDescendant` 误拒「重挂到祖先」已移除，:1224-1226 注释记录动机，校验收敛为 `childId === parentId || _hasAncestor(parentId, childId)` | round-22 → 本轮确认闭环 |
| 🟡 P3 | `frontend/src/menus/library-core.ts` | :657/:714 | **已修复**（不再开放）。round-13 P3 两处 panel 泄漏：:664 `currentPanel?.dispose()`、:675/:690 `safeDispose(currentPanel)`（onSelect/onBack 双路径）、:880 `renderGridMode` observer 释放注释均已落 | round-13 → 本轮确认闭环 |

## 七、结论与建议（已执行）

1. **无需抢修**：6086 用例全绿、类型/异常/资源配对三项硬指标全部干净，用户可感知的健壮性风险不在「代码写崩」这一层。
2. ~~唯一值得投入的是 ADR-276 Stage 2~~ → **已由并行工程治理线于同日关闭**（strict 全开，见第五节修订记录）。
3. ~~两条 P2 建议随下一轮专项处理~~ → **本轮已全部闭环**（NullEngine 配对释放 + 解析异常上下文包装），各补 1 个回归测试并验证过「回退源码测试必红」的判别力。
4. **P3 本轮再闭环两项**：perception-breathing 递归深度限制（64 层截断）、proc-motion-shared 嵌套分支 NaN 防护（guardNum 对齐扁平分支）。
5. **剩余 P3 观察项维持搁置**（buglog 2026-08-16 三条：lighting.ts:453-463 / env-lighting.ts:391-392 / ui-fullscreen-overlay.ts:104-106，均已登记触发条件与证据行号，触发概率极低）。
6. **修复前必读**（教训）：ADR-276 批 A 曾与本次体检在工作树并行，暂停后其改动已回退；后续任何 frontend/src 改动前先 `git status` 确认工作区归属，避免 ADR-275 记录的「同一工作树两条线互相踩」重演。

## 八、本轮修复清单（2026-10-24 晚，共 4 项 / 5 文件）

| # | 严重度 | 文件 | 改动 | 回归测试 |
|---|---|---|---|---|
| 1 | P2 | `frontend/src/motion-algos/vmd-evaluator.ts` | 模块级 `_sharedEngine` 配对 NullEngine 释放（先 scene 后 engine） | `__tests__/vmd-evaluator.test.ts` shutdown spy 计数 |
| 2 | P2 | `frontend/src/motion-algos/vmd-evaluator.ts` | `createVmdEvaluator` try/catch 包装解析异常（带 byteLength + cause，reject 语义不变） | `__tests__/vmd-evaluator.test.ts` rejects.toThrow(/50 bytes/) |
| 3 | P3 | `frontend/src/scene/motion/perception-breathing.ts` | `_BONE_CHAIN_MAX_DEPTH = 64` + 内部 `_updateBoneChainDepth`（export 签名不变） | `__tests__/perception-breathing.test.ts` 200 层链 calls===65 + 自环不抛 |
| 4 | P3 | `frontend/src/motion-algos/proc-motion-shared.ts` | 嵌套分支 `intensity`/`speed` 补 `guardNum`（对齐扁平分支） | `__tests__/proc-motion-migrate.test.ts` NaN→默认回落 |

受影响模块集中回归：**208/208 全绿**（vmd-evaluator / perception-breathing / proc-motion / procedural-motion / proc-motion-bridge 六个测试文件）。全量 `npm run test:quick` 基线（6086 绿）见第一节。

---

## 相关文档

> ADR-276（Stage 2 strictNullChecks 收口，已落地）/ ADR-277（Stage 3 strict 全开，已落地）/ ADR-274（Stage 1 noImplicitAny，已采纳）/ ADR-275（并行线误撤销复盘）/ ADR-258（pre-push tsc 门禁与缓存键）/ `docs/audit-playbook.md`（审核框架）/ `docs/buglog/2026-08-16-audit-p3-observations.md`（P3 观察项台账）/ round-13 / round-15 / round-22 / round-44 / round-48 / round-49（本报告复核的各轮审计）
