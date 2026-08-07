# Round 15 — Motion 全量系统审核报告

> 审核日期：2026-08-07
> 审核范围：`frontend/src/scene/motion/` 全量（约 25 文件）
> 审核方法：逐行读取源码 + 知识卡对照 + 5 维度评估 + 4 心理模拟
> 审核约束：只读，不修改源码；禁止从 `@/core/utils` 神桶导入（ADR-191）

---

## 一、审核范围清单

### 管线与播放（2 文件）
| # | 文件 | 行数 | 知识卡 |
|---|------|------|--------|
| 1 | `motion-pipeline.ts` | 140 | ADR-147 |
| 2 | `playback.ts` | 211 | architecture |

### 感知层（8 文件）
| # | 文件 | 行数 | 知识卡 |
|---|------|------|--------|
| 3 | `perception.ts` | 820 | ADR-071/162/166 |
| 4 | `perception-observer.ts` | 166 | ADR-166 |
| 5 | `perception-shared.ts` | 478 | ADR-071/164 |
| 6 | `perception-gaze.ts` | 499 | ADR-071 |
| 7 | `perception-gaze-js.ts` | 73 | ADR-071 |
| 8 | `perception-gaze-wasm.ts` | 57 | ADR-071 |
| 9 | `perception-breathing.ts` | 82 | ADR-071 |
| 10 | `perception-blinking.ts` | 51 | ADR-071 |
| 11 | `perception-expression.ts` | 87 | ADR-079 |
| 12 | `perception-balance.ts` | 172 | ADR-079 |
| 13 | `perception-lipsync.ts` | 236 | ADR-079 |

### 程序化动作（3 文件）
| # | 文件 | 行数 | 知识卡 |
|---|------|------|--------|
| 14 | `proc-motion-bridge.ts` | 143 | ADR-021/237 |
| 15 | `proc-motion-controller.ts` | 393 | ADR-021/237 |
| 16 | `proc-motion-params.ts` | 290 | ADR-021/237 |

### 重定向
| # | 文件 | 行数 | 知识卡 |
|---|------|------|--------|
| 17 | `animation-retargeter.ts` | 279 | architecture |

### 脚部
| # | 文件 | 行数 | 知识卡 |
|---|------|------|--------|
| 18 | `feet-adjustment.ts` | 449 | ADR-085/088/202 |
| 19 | `footstep-detect-fallback.ts` | 185 | ADR-088 |
| 20 | `footstep.ts` | 174 | ADR-088 |

### VMD 系统（3 文件）
| # | 文件 | 行数 | 知识卡 |
|---|------|------|--------|
| 21 | `vmd-layers.ts` | 694 | ADR-051/237 |
| 22 | `vmd-loader.ts` | 380 | architecture |
| 23 | `wasm-layers-blender.ts` | 308 | ADR-056/236 |
| 24 | `wasm-layers-config.ts` | 13 | ADR-056 |

### 骨骼覆盖（2 文件）
| # | 文件 | 行数 | 知识卡 |
|---|------|------|--------|
| 25 | `bone-override.ts` | 1116 | ADR-061/116/123/186 |
| 26 | `bone-override-store.ts` | 436 | ADR-147 |

### 唇形
| # | 文件 | 行数 | 知识卡 |
|---|------|------|--------|
| 27 | `lipsync-bridge.ts` | 81 | architecture |

### 意图
| # | 文件 | 行数 | 知识卡 |
|---|------|------|--------|
| 28 | `motion-intent.ts` | 380 | ADR-121/167 |

### 动作模块（6 文件）
| # | 文件 | 行数 | 知识卡 |
|---|------|------|--------|
| 29 | `motion-modules/registry.ts` | 366 | ADR-129/116 |
| 30 | `motion-modules/types.ts` | 57 | ADR-116 |
| 31 | `motion-modules/module-base.ts` | 293 | ADR-116/125/146 |
| 32 | `motion-modules/body-posture.ts` | 291 | ADR-116 |
| 33 | `motion-modules/foot-modules.ts` | 259 | ADR-116 |
| 34 | `motion-modules/hand-modules.ts` | 443 | ADR-116 |
| 35 | `motion-modules/riding-model.ts` | 296 | ADR-116 |
| 36 | `motion-modules/motion-math.ts` | 44 | ADR-116 |
| 37 | `motion-modules/preset-types.ts` | 49 | ADR-145 |
| 38 | `motion-modules/motion-history.ts` | 236 | ADR-125 |

---

## 二、5 维度逐文件评估

### 2.1 类型安全

| 文件 | 评级 | 发现 |
|------|------|------|
| `motion-pipeline.ts` | ✅ 优 | `PipelineStage` 联合类型严格；`PipelineLayer` 接口完整；`STAGE_ORDER` 为 `readonly PipelineStage[]` |
| `playback.ts` | ✅ 优 | `PlaybackObservablesDispose` 类型明确；`_manager` 为 `ModelManager \| null` 显式守卫 |
| `perception.ts` | ✅ 优 | `PerceptionState`/`PerceptionContext` 类型完整；`_perceptionState` 为 `PerceptionState` 显式类型 |
| `perception-shared.ts` | ✅ 优 | `PerceptionPool`/`GazeCache`/`BalanceSwayState` 类型完整；`MmdModelLike` 最小接口设计合理 |
| `perception-gaze.ts` | ✅ 优 | `HeadGazeWriteStrategy`/`EyeGazeWriteStrategy` 接口注入策略，类型安全 |
| `perception-gaze-js.ts` | ⚠️ 中 | L35 `headRuntime.linkedBone.rotationQuaternion` 未判空（`linkedBone` 可能为 null）；L46 同问题 |
| `perception-gaze-wasm.ts` | ✅ 优 | `worldMatrix` 类型断言 `(headRuntime as MmdRuntimeBoneExtended).worldMatrix` 有守卫 |
| `perception-breathing.ts` | ⚠️ 中 | L47 `spine.linkedBone.rotationQuaternion` 未判空（`linkedBone` 可能为 null） |
| `perception-blinking.ts` | ✅ 优 | `morphManager` 守卫完整 |
| `perception-expression.ts` | ✅ 优 | `morphManager` 守卫完整；`EMOTION_MORPH_CANDIDATES` 类型 `Record<Exclude<Emotion, 'neutral'>, string[]>` 精确 |
| `perception-balance.ts` | ⚠️ 中 | L78/92/124/140/156 `bone.linkedBone` 未判空（多处 `bone?.linkedBone` 但 L92 后直接 `.rotationQuaternion`） |
| `perception-lipsync.ts` | ✅ 优 | `LipSyncRuntimeState` 接口完整；`_lipSyncRuntimes` Map 类型明确 |
| `proc-motion-bridge.ts` | ✅ 优 | `ProcMotionController` 组合类类型安全；26 个导出委托签名一致 |
| `proc-motion-controller.ts` | ✅ 优 | `_activeModels` Set、`_modelProcState` Map 类型明确；`_stopRequested` 布尔守卫 |
| `proc-motion-params.ts` | ✅ 优 | mixin 泛型约束 `Constructor<ProcMotionControllerBase>` 正确；`_defaultParamsFor` 深拷贝 |
| `animation-retargeter.ts` | ✅ 优 | `RetargetResult`/`RetargetPlayState` 接口完整；`_cleanupTempMeshes` 类型守卫 |
| `feet-adjustment.ts` | ⚠️ 中 | L180 `bones.find((b) => b.name === ikName)` 返回 `IMmdRuntimeBone \| undefined`，L181 守卫 OK；但 L254 `(ik as MmdRuntimeBoneExtended).ikSolver` 类型断言无守卫 |
| `footstep-detect-fallback.ts` | ✅ 优 | `_IkBoneRef` 最小接口设计合理；`_FootState`/`_ModelState` 类型完整 |
| `footstep.ts` | ✅ 优 | `SynthCfg` 接口完整；`GroundSfxKind` 联合类型精确 |
| `vmd-layers.ts` | ✅ 优 | `VmdLayer` 类型复用；`_rebuildGenMap` Map 类型明确 |
| `vmd-loader.ts` | ✅ 优 | `isValidVmd` 签名校验；`_vmdLoadGenMap` per-model generation counter |
| `wasm-layers-blender.ts` | ✅ 优 | `BlenderState`/`WasmLayerEntry` 类型完整；`_requireDeps` 守卫 |
| `bone-override.ts` | ✅ 优 | `BoneOverrideEntry`/`_OverrideSlot` 类型完整；`OverrideSlotLike` 最小形态接口 |
| `bone-override-store.ts` | ✅ 优 | `OverrideSlot`/`BoneOwnership`/`BoneConflict` 类型完整；`BoneOverrideStore` 接口契约 |
| `lipsync-bridge.ts` | ✅ 优 | 转发层类型安全；`_toLipSyncState`/`_fromLipSyncState` 类型转换 |
| `motion-intent.ts` | ✅ 优 | `SceneMotionIntent` 类型复用；`LoadableProcId` 联合类型精确 |
| `motion-modules/registry.ts` | ✅ 优 | `RegistryEntry`/`BoneConflict` 类型完整；`_resolveIntent` 类型守卫 |
| `motion-modules/module-base.ts` | ✅ 优 | `ModuleBaseMethods` Pick 类型精确；`ModuleShellConfig` 接口完整 |
| `motion-modules/body-posture.ts` | ⚠️ 中 | L135 `getModuleState(modelId, MODULE_ID)` 返回 `MotionModuleState`，但 `st.params` 可能为 `undefined` |
| `motion-modules/foot-modules.ts` | ⚠️ 中 | L89 `getModuleState(mid, cfg.moduleId)` 返回 `MotionModuleState`，`st.params` 可能为 `undefined` |
| `motion-modules/hand-modules.ts` | ⚠️ 中 | L167 `getModuleState(mid, cfg.moduleId)` 返回 `MotionModuleState`，`st.params` 可能为 `undefined` |
| `motion-modules/riding-model.ts` | ⚠️ 中 | L150 `getModuleState(modelId, MODULE_ID)` 返回 `MotionModuleState`，`st.params` 可能为 `undefined` |
| `motion-modules/motion-history.ts` | ✅ 优 | `MotionHistoryEntry`/`ModelHistoryState` 类型完整 |

**类型安全总结**：整体优秀。主要问题集中在 `linkedBone` 未判空（JS 路径 gaze/breathing/balance）和 `MotionModuleState.params` 可能 undefined 的模块层帧钩子。

---

### 2.2 资源释放

| 文件 | 评级 | 发现 |
|------|------|------|
| `motion-pipeline.ts` | ✅ 优 | `unregister` 返回清理函数；`layers.splice` 正确移除 |
| `playback.ts` | ✅ 优 | `_disposed` 双清理防护；3 个 handle 逐一 dispose + try-catch；`_manager = null` 清零 |
| `perception.ts` | ✅ 优 | `deactivatePerception` 注销 observer + 清理 reclaim listener；`_deactivateContext` 释放骨骼 + dispose lip-sync |
| `perception-observer.ts` | ✅ 优 | `finally` 块 `_setContextPool(null)` 恢复全局池 |
| `perception-shared.ts` | ✅ 优 | `_createPerceptionPool` 创建独立池；溢出时 `new` 不覆写 |
| `perception-gaze.ts` | ✅ 优 | 无持久资源 |
| `perception-gaze-js.ts` | ✅ 优 | 无持久资源 |
| `perception-gaze-wasm.ts` | ✅ 优 | 无持久资源 |
| `perception-breathing.ts` | ✅ 优 | 无持久资源 |
| `perception-blinking.ts` | ✅ 优 | 无持久资源 |
| `perception-expression.ts` | ✅ 优 | 无持久资源 |
| `perception-balance.ts` | ✅ 优 | 无持久资源 |
| `perception-lipsync.ts` | ✅ 优 | `_disposeLipSyncRuntime` 清理 Map；关闭时复位 morph influence |
| `proc-motion-bridge.ts` | ✅ 优 | `disposeProcMotion` 调用 `_ctrl.dispose()` + `_ctrl = null` |
| `proc-motion-controller.ts` | ✅ 优 | `dispose` 全量清理：stop + safeDispose beatDetector + clear modelProcState |
| `proc-motion-params.ts` | ✅ 优 | 无持久资源 |
| `animation-retargeter.ts` | ✅ 优 | `_cleanupTempMeshes` 清理 mesh + skeleton + animationGroups；`stopCurrentRetarget` 清理 |
| `feet-adjustment.ts` | ✅ 优 | `stopFeetAdjustment` 注销 handle + 清空 cache + 重置时间戳 |
| `footstep-detect-fallback.ts` | ✅ 优 | `stopFallbackDetection` safeDispose observer + 清空 modelStates |
| `footstep.ts` | ✅ 优 | `stopFootstep` 清空 callback + 停止 fallback + 清空 synthCache |
| `vmd-layers.ts` | ⚠️ 中 | `disposeVmdLayerState` 仅清理 `_prevGazeActiveMap`；`_rebuildGenMap` 不删（注释说明合理：同 ID 复用场景下保留计数器防竞态） |
| `vmd-loader.ts` | ✅ 优 | `MmdWasmAnimation` 有 dispose 守卫；`_companionAudioCache` 在加载 VMD 时 clear |
| `wasm-layers-blender.ts` | ✅ 优 | `teardownWasmLayersBlender` 遍历 dispose evaluator + clear layers + delete state |
| `bone-override.ts` | ✅ 优 | `stopBoneOverride` 全量清理：unregister + safeDispose driver + 清空 hooks + triggerAutoSave + clearAllOverrides |
| `bone-override-store.ts` | ✅ 优 | `disposeModel` 全量清理：引擎槽 + slots + ownedBones + boneOwner + moduleState + conflicts |
| `lipsync-bridge.ts` | ✅ 优 | 无持久资源 |
| `motion-intent.ts` | ✅ 优 | `resetMotionIntent` 清理回调；`clearAllSceneMotions` 清空库 |
| `motion-modules/registry.ts` | ✅ 优 | `unregisterModule` 先 disable 所有模型实例再删注册表；`clearAllModulesForModel` 委托 store.disposeModel |
| `motion-modules/module-base.ts` | ✅ 优 | `applyModuleSnapshot` 对不在快照中的模块 disable；`createFrameHookManager` unregister 清理 |
| `motion-modules/motion-history.ts` | ✅ 优 | `clearHistory` 清理 historyMap + mergeMap |

**资源释放总结**：整体优秀。所有模块均有明确的 dispose/cleanup 路径。`_rebuildGenMap` 不删（注释说明合理：同 ID 复用场景下保留计数器防竞态）。`perception-observer.ts` 的 `finally` 块 `_setContextPool(null)` 恢复全局池，设计严谨。

---

### 2.3 异常处理

| 文件 | 评级 | 发现 |
|------|------|------|
| `motion-pipeline.ts` | ✅ 优 | `runFrame` 对每个 layer 单独 try-catch，单 layer 异常不阻断管线；异常信息记录到 `_lastError` |
| `playback.ts` | ✅ 优 | `dispose` 中 3 个 handle 逐一 try-catch dispose；`_disposed` 双清理防护 |
| `perception.ts` | ✅ 优 | `_ensureObserverRegistered` 注册时异常不阻断；`_claimPerceptionBones` 失败时 graceful 降级（console.warn + 继续）；`deactivatePerception` 中 safeDispose |
| `perception-observer.ts` | ✅ 优 | 每个子模块（breathing/blinking/micro-expression/balance-sway/lipsync/gaze）独立 try-catch，单模块异常不影响其他模块；`finally` 恢复 `_setContextPool(null)` |
| `perception-shared.ts` | ✅ 优 | `PerceptionPerfMonitor` 降级逻辑无异常风险；`_propagateChildrenWasm` 递归有守卫 |
| `perception-gaze.ts` | ⚠️ 中 | `_applyGaze` 调用 strategy 时未 try-catch（strategy 内部异常会传播到 observer）；`_clampGazeTargetInParentFrame` 中 `parentBone.linkedBone` 未判空 |
| `perception-gaze-js.ts` | ⚠️ 中 | `_updateBoneChain` 递归无深度限制，极端骨骼链可能导致栈溢出 |
| `perception-gaze-wasm.ts` | ⚠️ 中 | `_propagateChildrenWasm` 递归无深度限制 |
| `perception-breathing.ts` | ⚠️ 中 | `_updateBoneChain` 递归无深度限制 |
| `perception-blinking.ts` | ✅ 优 | 无异常风险 |
| `perception-expression.ts` | ✅ 优 | 无异常风险 |
| `perception-balance.ts` | ⚠️ 中 | `_updateBoneChain` 递归无深度限制 |
| `perception-lipsync.ts` | ✅ 优 | `_applyLipSync` 中 morph 操作有守卫；音源切换时 safe reset |
| `proc-motion-bridge.ts` | ✅ 优 | 委托层无异常风险 |
| `proc-motion-controller.ts` | ✅ 优 | `_startProcMotion` 异步异常被 catch 并 console.error；`_stopRequested` 防 await 期间 stop 后重新激活；`dispose` 中 safeDispose beatDetector |
| `proc-motion-params.ts` | ✅ 优 | 无异常风险 |
| `animation-retargeter.ts` | ✅ 优 | `loadAndRetargetAnimation` 异常被 catch；`_cleanupTempMeshes` 中 mesh dispose 有守卫 |
| `feet-adjustment.ts` | ⚠️ 中 | `_adjustFoot` 中 IK 解算异常未 try-catch（IK 失败会传播到 pipeline layer）；`_solveIkForFoot` 中 `ikSolver.solve` 可能抛异常 |
| `footstep-detect-fallback.ts` | ✅ 优 | `onBeforeRenderObservable` 回调中异常被 catch |
| `footstep.ts` | ✅ 优 | 程序化音频合成无异常风险 |
| `vmd-layers.ts` | ✅ 优 | `_rebuildCompositeAnimation` 中 generation counter 防竞态；`_tryWasmBlender` 失败时降级到 JS 路径 |
| `vmd-loader.ts` | ✅ 优 | `isValidVmd` 签名校验；加载异常被 catch |
| `wasm-layers-blender.ts` | ✅ 优 | `_requireDeps` 守卫；`_applyLayersBlending` 中 evaluator 异常被 catch |
| `bone-override.ts` | ⚠️ 中 | `_applyWasmOverride` 中 `worldMatrix` 写入无 try-catch；`_solvePosSlotIkWasm` IK 解算异常未隔离 |
| `bone-override-store.ts` | ✅ 优 | `claimBones` 冲突检测有守卫；`releaseBones` 级联清理有守卫 |
| `lipsync-bridge.ts` | ✅ 优 | 转发层无异常风险 |
| `motion-intent.ts` | ✅ 优 | `replaceDefaultMotion` 中 generation counter 防竞态；异步加载异常被 catch |
| `motion-modules/registry.ts` | ✅ 优 | `_resolveIntent` 异常被 catch；模块注册异常不阻断 |
| `motion-modules/module-base.ts` | ✅ 优 | `applyModuleSnapshot` 异常被 catch；帧钩子管理器异常隔离 |
| `motion-modules/body-posture.ts` | ⚠️ 中 | 帧钩子中骨骼操作无 try-catch（异常会传播到 pipeline） |
| `motion-modules/foot-modules.ts` | ⚠️ 中 | 帧钩子中骨骼操作无 try-catch |
| `motion-modules/hand-modules.ts` | ⚠️ 中 | 帧钩子中骨骼操作无 try-catch |
| `motion-modules/riding-model.ts` | ⚠️ 中 | 帧钩子中骨骼操作无 try-catch |
| `motion-modules/motion-history.ts` | ✅ 优 | 无异常风险 |

**异常处理总结**：管线层（motion-pipeline）和感知观察者层（perception-observer）的异常隔离设计优秀。主要问题集中在：(1) 递归函数（`_updateBoneChain`/`_propagateChildrenWasm`）无深度限制；(2) 模块层帧钩子（body-posture/foot-modules/hand-modules/riding-model）无 try-catch，异常会传播到 pipeline layer；(3) IK 解算（feet-adjustment/bone-override）异常未隔离。

---

### 2.4 状态流清晰

| 文件 | 评级 | 发现 |
|------|------|------|
| `motion-pipeline.ts` | ✅ 优 | `register` 返回清理函数，状态变更路径清晰；`ensureSorted` 延迟排序避免注册时序依赖；`_instance` 单例模式明确 |
| `playback.ts` | ✅ 优 | `_disposed` 双清理防护；`_loopPending` 防 UI 闪烁；auto-loop 逻辑在 `onPauseAnimationObservable` 内，状态流清晰 |
| `perception.ts` | ✅ 优 | `_perceptionState` 场景级单例 + `_contexts` Map 双层状态；`activate/deactivate/pin/unpin` 状态转换路径清晰；`_onBoneOverrideRelease` 自动 reclaim |
| `perception-observer.ts` | ✅ 优 | `_getActiveContextsByTier` 按 tier 筛选；`_applyPerceptionForContext` 逐 context 应用，状态流线性 |
| `perception-shared.ts` | ✅ 优 | `PerceptionPool` per-context 对象池；`_setContextPool/_resetContextPool` 切换机制清晰；`PerceptionPerfMonitor` 三档自动降级 |
| `perception-gaze.ts` | ✅ 优 | `_applyGaze` 统一调度入口；`_applyHeadGazeCore/_applyEyeGazeCore` 共用骨架 + strategy 注入；`_getGazeTarget` AR 模式投射 |
| `perception-gaze-js.ts` | ✅ 优 | 状态流清晰 |
| `perception-gaze-wasm.ts` | ✅ 优 | 状态流清晰 |
| `perception-breathing.ts` | ✅ 优 | delta 增量叠加（撤销上帧偏移 + 应用本帧），状态流清晰 |
| `perception-blinking.ts` | ✅ 优 | morph influence 取 max（眨眼优先），状态流清晰 |
| `perception-expression.ts` | ✅ 优 | 情绪→morph 名匹配，周期性脉冲 `sin²`，情绪切换时复位旧 morph |
| `perception-balance.ts` | ✅ 优 | delta 增量叠加，4 类骨骼（center/upper2/waist/allParent），关闭时撤销 bob 残留 |
| `perception-lipsync.ts` | ✅ 优 | per-model `LipSyncRuntimeState` 隔离；音源切换重置；静音指数衰减；多口型 morph（open/close/pucker/smile） |
| `proc-motion-bridge.ts` | ✅ 优 | `ProcMotionController` 组合类（base + mixin），模块级懒单例，26 个导出委托函数 |
| `proc-motion-controller.ts` | ✅ 优 | `_activeModels` Set 支持多模型并发；`_modelProcState` Map 记录 per-model kind/bpm；`_stopRequested` 防 await 期间 stop 后重新激活 |
| `proc-motion-params.ts` | ✅ 优 | `_writeProcState` 同步写入 activeMotion + fallback；`_writeTopLevel` 写入顶层字段；`_setGazeTrackingSetting` 同步到 perception |
| `animation-retargeter.ts` | ✅ 优 | `RetargetPlayState` 状态机清晰；`_cleanupTempMeshes` 清理路径明确 |
| `feet-adjustment.ts` | ✅ 优 | `_FootState`/`_ModelState` 状态隔离；落地事件检测状态流清晰；用户手动覆盖优先跳过自动贴地 |
| `footstep-detect-fallback.ts` | ✅ 优 | `_FootState`/`_ModelState` 状态隔离；惰性解析 IK 骨骼 |
| `footstep.ts` | ✅ 优 | `_synthCache` 按音色缓存 3 变体；左右声像计算状态流清晰 |
| `vmd-layers.ts` | ✅ 优 | `_rebuildGenMap` generation counter 防竞态；`_rebuildCompositeAnimation` 状态流清晰 |
| `vmd-loader.ts` | ✅ 优 | `_vmdLoadGenMap` per-model generation counter；`isValidVmd` 签名校验 |
| `wasm-layers-blender.ts` | ✅ 优 | `_blenderStates` Map 存储 per-model 状态；`_applyLayersBlending` 累积权重 Slerp 混合 |
| `bone-override.ts` | ✅ 优 | `_overrideMaps` per-model Map；`computeOverride` 纯函数；`_snapshotProtectedPositions/_restoreProtectedPositions` IK 位置保护 |
| `bone-override-store.ts` | ✅ 优 | `BoneOwnership`/`BoneConflict` 状态模型清晰；`claimBones` 优先级抢占；`releaseBones` 级联清理 + release 监听器通知 |
| `lipsync-bridge.ts` | ✅ 优 | 转发层状态流清晰 |
| `motion-intent.ts` | ✅ 优 | `_sceneMotions` 动作库 + `_activeMotionId` 默认动作；`_motionGen` generation counter；`replaceDefaultMotion` 原位替换 |
| `motion-modules/registry.ts` | ✅ 优 | `RegistryEntry`/`BoneConflict` 状态模型清晰；`_resolveIntent` 状态流清晰 |
| `motion-modules/module-base.ts` | ✅ 优 | `ModuleShellConfig` 接口完整；`applyModuleSnapshot` 状态恢复路径清晰 |
| `motion-modules/body-posture.ts` | ✅ 优 | 状态流清晰 |
| `motion-modules/foot-modules.ts` | ✅ 优 | 状态流清晰 |
| `motion-modules/hand-modules.ts` | ✅ 优 | 状态流清晰 |
| `motion-modules/riding-model.ts` | ✅ 优 | 状态流清晰 |
| `motion-modules/motion-history.ts` | ✅ 优 | `MotionHistoryEntry`/`ModelHistoryState` 状态模型清晰；撤销/重做历史栈 |

**状态流清晰总结**：整体优秀。所有模块的状态模型设计清晰，generation counter 防竞态（vmd-layers/vmd-loader/motion-intent）是亮点。per-model 隔离（perception/proc-motion/bone-override）设计一致。无明显状态流问题。

---

### 2.5 职责单一

| 文件 | 评级 | 发现 |
|------|------|------|
| `motion-pipeline.ts` | ✅ 优 | 纯调度器，只负责按 `(stageIndex, order)` 升序执行 layer，不关心 layer 内容 |
| `playback.ts` | ✅ 优 | 纯播放控制 UI，只负责注册 runtime observable + auto-loop + seek |
| `perception.ts` | ✅ 优 | 感知层主控，只负责 context 生命周期 + 骨骼认领 + observer 注册，不直接做感知计算 |
| `perception-observer.ts` | ✅ 优 | 纯观察者，只负责逐 context 调用各子模块，不持有感知状态 |
| `perception-shared.ts` | ✅ 优 | 纯共享类型 + 对象池 + 性能监控，无业务逻辑 |
| `perception-gaze.ts` | ✅ 优 | 纯视线追踪，统一调度 + 策略注入 + Swing-Twist 分解 |
| `perception-gaze-js.ts` | ✅ 优 | 纯 JS 路径写入策略 |
| `perception-gaze-wasm.ts` | ✅ 优 | 纯 WASM 路径写入策略 |
| `perception-breathing.ts` | ✅ 优 | 纯呼吸模块 |
| `perception-blinking.ts` | ✅ 优 | 纯眨眼模块 |
| `perception-expression.ts` | ✅ 优 | 纯微表情模块 |
| `perception-balance.ts` | ✅ 优 | 纯重心微动模块 |
| `perception-lipsync.ts` | ✅ 优 | 纯感知口型同步 |
| `proc-motion-bridge.ts` | ✅ 优 | 纯转发层，26 个委托函数 |
| `proc-motion-controller.ts` | ✅ 优 | 纯状态机核心，只负责 start/stop/activeModels |
| `proc-motion-params.ts` | ✅ 优 | 纯参数 setter 群 mixin |
| `animation-retargeter.ts` | ✅ 优 | 纯重定向桥，只负责加载外部动画 + additive 播放 |
| `feet-adjustment.ts` | ✅ 优 | 纯脚部地面跟随引擎 |
| `footstep-detect-fallback.ts` | ✅ 优 | 纯脚部落地检测降级 |
| `footstep.ts` | ✅ 优 | 纯脚步声控制器 |
| `vmd-layers.ts` | ✅ 优 | 纯多 VMD 叠加系统 |
| `vmd-loader.ts` | ✅ 优 | 纯 VMD 加载器 |
| `wasm-layers-blender.ts` | ✅ 优 | 纯 WASM 图层混合器 |
| `bone-override.ts` | ✅ 优 | 纯骨骼覆盖核心 API |
| `bone-override-store.ts` | ✅ 优 | 纯骨骼仲裁存储 |
| `lipsync-bridge.ts` | ✅ 优 | 纯口型同步桥转发层 |
| `motion-intent.ts` | ✅ 优 | 纯场景级动作意图库 |
| `motion-modules/registry.ts` | ✅ 优 | 纯模块注册表 |
| `motion-modules/module-base.ts` | ✅ 优 | 纯模块基类 + 帧钩子管理器 |
| `motion-modules/body-posture.ts` | ✅ 优 | 纯身体姿态模块 |
| `motion-modules/foot-modules.ts` | ✅ 优 | 纯脚部模块 |
| `motion-modules/hand-modules.ts` | ✅ 优 | 纯手部模块 |
| `motion-modules/riding-model.ts` | ✅ 优 | 纯骑乘模型模块 |
| `motion-modules/motion-history.ts` | ✅ 优 | 纯动作历史栈 |

**职责单一总结**：整体优秀。所有文件职责边界清晰，无职责混杂。感知层 8 文件拆分（主控/观察者/共享/视线/呼吸/眨眼/微表情/重心/口型）是职责单一的最佳实践。程序化动作三文件拆分（bridge/controller/params）同样优秀。

---

## 三、4 心理模拟

### 3.1 异常路径模拟

**场景**：某感知子模块（如 `perception-gaze.ts`）在帧钩子中抛出未捕获异常。

**预期**：异常被 `perception-observer.ts` 的 try-catch 捕获，其他子模块继续执行，管线不中断。

**实际**：
- `perception-observer.ts` 对每个子模块独立 try-catch，✅ 符合预期。
- 但 `perception-gaze.ts` 内部 `_applyGaze` 调用 strategy 时未 try-catch，若 strategy 内部抛异常，异常会传播到 observer 的 try-catch 块，✅ 最终被捕获。
- `feet-adjustment.ts` 的 `_adjustFoot` 中 IK 解算异常未 try-catch，但 pipeline layer 有 try-catch，✅ 最终被捕获。
- `bone-override.ts` 的 `_applyWasmOverride` 中 `worldMatrix` 写入异常未 try-catch，但 pipeline layer 有 try-catch，✅ 最终被捕获。

**结论**：✅ 异常路径安全。所有异常最终被 pipeline layer 或 observer 捕获，不会导致管线中断。

### 3.2 AbortSignal 模拟

**场景**：用户快速切换模型或场景，触发 `dispose`/`stop` 操作。

**预期**：所有异步操作被取消，资源被释放，无残留。

**实际**：
- `proc-motion-controller.ts` 的 `_stopRequested` 防 await 期间 stop 后重新激活，✅ 符合预期。
- `playback.ts` 的 `_disposed` 双清理防护，✅ 符合预期。
- `perception.ts` 的 `deactivatePerception` 注销 observer + 清理 reclaim listener，✅ 符合预期。
- `vmd-layers.ts` 的 `_rebuildGenMap` generation counter 防竞态，✅ 符合预期。
- `motion-intent.ts` 的 `_motionGen` generation counter 防竞态，✅ 符合预期。

**结论**：✅ AbortSignal 路径安全。所有异步操作均有防竞态机制。

### 3.3 快速操作模拟

**场景**：用户在 100ms 内连续触发 10 次 `startProcMotion` + `stopProcMotion`。

**预期**：状态机正确处理，无重复启动，无资源泄漏。

**实际**：
- `proc-motion-controller.ts` 的 `_activeModels` Set 防止重复启动，✅ 符合预期。
- `_stopRequested` 防 await 期间 stop 后重新激活，✅ 符合预期。
- `dispose` 中 safeDispose beatDetector + clear modelProcState，✅ 符合预期。

**结论**：✅ 快速操作安全。

### 3.4 finally 守卫模拟

**场景**：`perception-observer.ts` 的 `_applyPerceptionForContext` 在中间某子模块抛出异常。

**预期**：`finally` 块 `_setContextPool(null)` 恢复全局池，后续 context 不受影响。

**实际**：
- `perception-observer.ts` 的 `finally` 块 `_setContextPool(null)`，✅ 符合预期。
- `perception-shared.ts` 的 `_setContextPool`/`_resetContextPool` 切换机制清晰，✅ 符合预期。

**结论**：✅ finally 守卫安全。

---

## 四、P1/P2/P3 问题汇总

### P1（必须修复）

| # | 文件 | 问题 | 建议 |
|---|------|------|------|
| P1-1 | `perception-gaze-js.ts` | L35/L46 `headRuntime.linkedBone.rotationQuaternion` 未判空（`linkedBone` 可能为 null） | 添加 `headRuntime.linkedBone?.rotationQuaternion` 守卫 |
| P1-2 | `perception-breathing.ts` | L47 `spine.linkedBone.rotationQuaternion` 未判空 | 添加 `spine.linkedBone?.rotationQuaternion` 守卫 |
| P1-3 | `perception-balance.ts` | L78/92/124/140/156 `bone.linkedBone` 未判空 | 添加 `bone?.linkedBone?.rotationQuaternion` 守卫 |
| P1-4 | `feet-adjustment.ts` | L254 `(ik as MmdRuntimeBoneExtended).ikSolver` 类型断言无守卫 | 添加 `ik?.ikSolver` 守卫 |

### P2（建议修复）

| # | 文件 | 问题 | 建议 |
|---|------|------|------|
| P2-1 | `perception-gaze-js.ts` | `_updateBoneChain` 递归无深度限制 | 添加最大深度参数（如 32） |
| P2-2 | `perception-gaze-wasm.ts` | `_propagateChildrenWasm` 递归无深度限制 | 添加最大深度参数 |
| P2-3 | `perception-breathing.ts` | `_updateBoneChain` 递归无深度限制 | 添加最大深度参数 |
| P2-4 | `perception-balance.ts` | `_updateBoneChain` 递归无深度限制 | 添加最大深度参数 |
| P2-5 | `feet-adjustment.ts` | `_adjustFoot` 中 IK 解算异常未 try-catch | 添加 try-catch 隔离 |
| P2-6 | `bone-override.ts` | `_applyWasmOverride` 中 `worldMatrix` 写入无 try-catch | 添加 try-catch 隔离 |
| P2-7 | `bone-override.ts` | `_solvePosSlotIkWasm` IK 解算异常未隔离 | 添加 try-catch 隔离 |
| P2-8 | `motion-modules/body-posture.ts` | 帧钩子中骨骼操作无 try-catch | 添加 try-catch 隔离 |
| P2-9 | `motion-modules/foot-modules.ts` | 帧钩子中骨骼操作无 try-catch | 添加 try-catch 隔离 |
| P2-10 | `motion-modules/hand-modules.ts` | 帧钩子中骨骼操作无 try-catch | 添加 try-catch 隔离 |
| P2-11 | `motion-modules/riding-model.ts` | 帧钩子中骨骼操作无 try-catch | 添加 try-catch 隔离 |
| P2-12 | `motion-modules/body-posture.ts` | L135 `st.params` 可能为 undefined | 添加 `st.params` 守卫 |
| P2-13 | `motion-modules/foot-modules.ts` | L89 `st.params` 可能为 undefined | 添加 `st.params` 守卫 |
| P2-14 | `motion-modules/hand-modules.ts` | L167 `st.params` 可能为 undefined | 添加 `st.params` 守卫 |
| P2-15 | `motion-modules/riding-model.ts` | L150 `st.params` 可能为 undefined | 添加 `st.params` 守卫 |

### P3（可选优化）

| # | 文件 | 问题 | 建议 |
|---|------|------|------|
| P3-1 | `perception-gaze.ts` | `_applyGaze` 调用 strategy 时未 try-catch | 添加 try-catch 隔离（虽最终被 observer 捕获，但提前隔离更清晰） |
| P3-2 | `perception-gaze.ts` | `_clampGazeTargetInParentFrame` 中 `parentBone.linkedBone` 未判空 | 添加守卫 |
| P3-3 | `vmd-layers.ts` | `disposeVmdLayerState` 仅清理 `_prevGazeActiveMap`，`_rebuildGenMap` 不删 | 注释说明已存在，可接受；但建议在 dispose 时清理 `_rebuildGenMap` 对应条目 |

---

## 五、知识卡偏差核对

| 知识卡 | 偏差 | 说明 |
|--------|------|------|
| ADR-147（MotionPipeline） | 无偏差 | 管线调度器实现与知识卡一致 |
| ADR-071（感知层） | 无偏差 | 感知层架构与知识卡一致 |
| ADR-162/166（感知 pin/tier） | 无偏差 | pin 机制和 tier 档位实现与知识卡一致 |
| ADR-021/237（程序化动作） | 无偏差 | 三文件拆分与知识卡一致 |
| ADR-061/116/123/186（骨骼覆盖） | 无偏差 | per-model overrideMap 与知识卡一致 |
| ADR-051/237（VMD 图层） | 无偏差 | generation counter 防竞态与知识卡一致 |
| ADR-085/088/202（脚部调整） | 无偏差 | MMD-native IK 重解与知识卡一致 |
| ADR-084（骨骼仲裁） | 无偏差 | BoneOverrideStore 仲裁与知识卡一致 |
| ADR-121/167（动作意图） | 无偏差 | 场景级动作库与知识卡一致 |
| ADR-129/116（模块注册表） | 无偏差 | 模块注册表与知识卡一致 |
| ADR-125（动作历史） | 无偏差 | 撤销/重做历史栈与知识卡一致 |
| ADR-191（禁止神桶导入） | 无偏差 | 未发现从 `@/core/utils` 神桶导入 |

---

## 六、总结

### 整体评级：✅ 优秀

Motion 模块整体设计优秀，38 个文件（约 10000+ 行代码）在 5 维度评估中表现如下：

| 维度 | 评级 | 说明 |
|------|------|------|
| 类型安全 | ✅ 优秀 | 主要问题集中在 `linkedBone` 未判空和 `MotionModuleState.params` 可能 undefined |
| 资源释放 | ✅ 优秀 | 所有模块均有明确的 dispose/cleanup 路径 |
| 异常处理 | ⚠️ 良好 | 管线层和观察者层异常隔离优秀；模块层帧钩子和 IK 解算异常未隔离 |
| 状态流清晰 | ✅ 优秀 | generation counter 防竞态是亮点；per-model 隔离设计一致 |
| 职责单一 | ✅ 优秀 | 所有文件职责边界清晰，无职责混杂 |

### 关键设计亮点

1. **generation counter 防竞态**：vmd-layers/vmd-loader/motion-intent 均使用 generation counter 防止异步竞态
2. **per-model 隔离**：perception/proc-motion/bone-override 均采用 per-model 状态隔离
3. **对象池复用**：perception-shared 的 `PerceptionPool` 和 bone-override 的 `_mPool/_vPool/_qPool`
4. **异常隔离**：motion-pipeline 对每个 layer 独立 try-catch；perception-observer 对每个子模块独立 try-catch
5. **dispose 双清理防护**：playback 的 `_disposed` 和 proc-motion-controller 的 `dispose`

### 待修复问题

- **P1（4 项）**：`linkedBone` 未判空（gaze-js/breathing/balance）+ IK 类型断言无守卫（feet-adjustment）
- **P2（15 项）**：递归深度限制 + IK/模块帧钩子异常隔离 + `MotionModuleState.params` 守卫
- **P3（3 项）**：可选优化

### 建议

1. 优先修复 P1 问题（`linkedBone` 判空），这些是运行时可能崩溃的点
2. 为所有递归函数添加深度限制（P2-1~4）
3. 为模块层帧钩子添加 try-catch 隔离（P2-8~11），与管线层异常隔离保持一致
4. 为 IK 解算添加 try-catch 隔离（P2-5~7）
5. 为 `MotionModuleState.params` 添加守卫（P2-12~15）
5. 为 `MotionModuleState.params` 添加守卫（P2-12~15）