# MikuMikuAR 代码审核总索引

> **全量审核台账导航（43 篇，自动生成，按日期/轮次/专题分类）见 [index.md](./index.md)**——新审核记录落盘后 `npm run gen:docsindex` 自动入列。
> 本页为**结论汇总视图**（执行摘要 / 风险全景 / 模块级结论），明细导航见 index.md。

> 审核周期: 2026-07
> 审核范围: `frontend/src/` 核心3D渲染模块（环境、光照、运动图层、播放、感知）
> 方法: 按 AGENTS.md 审核流程，5维度 + 心理模拟逐模块走查

---

## 执行摘要

9轮审核覆盖 **41个模块**，总体结论如下：

| 结论 | 模块数 | 说明 |
|------|--------|------|
| ✅ 通过 | 13 | 无结构性问题，可直接用于生产 |
| ⚠️ 有条件通过 | 22 | 存在 P2-P4 问题，建议修复后再上线 |
| ❌ 不通过 | 5 | 存在 🔴P1 问题，必须修复 |

### 不通过模块（必须修复）

| 模块 | 文件 | 🔴P1 问题 |
|------|------|-----------|
| 环境水面 | `env-water.ts` | L979 `getScene()` 无 null guard（可能抛 NPE） |
| 光照系统 | `lighting.ts` | `transitionLighting` animLoop 定义后未调度；`_tweenValue` 用 `addOnce` 只注册一帧；零实质测试 |
| 程序化自动舞蹈 | `proc-motion-autodance.ts` | 540 行超 250LOC 天花板；零测试；正弦表未预分配产生 undefined |
| 感知系统 | `perception.ts`（原始） | `activatePerception` 跳过检测逻辑漏洞；实时渲染路径零测试（**已修复 → 拆分后 ✅**） |

---

## 风险全景图

### 按优先级分布

| 级别 | 数量 | 影响域 |
|------|------|--------|
| 🔴 P1 | 7 | 运行时崩溃、功能静默不执行、零测试 |
| 🟠 P2 | 18 | 类型安全违规、超限模块、无 dispose 入口、渲染副作用 |
| 🟡 P3 | 24 | 非空断言、GC 压力、循环依赖、状态来源不单一 |
| 🟢 P4 | 9 | 编码一致性、注释补充 |

### 跨模块模式问题

| 模式 | 出现次数 | 涉及模块 |
|------|----------|----------|
| `as any` / 双重 cast | 11 | water, facade, lighting, loader, layers, blender |
| `canvas.getContext('2d')!` 非空断言 | 4 | particles, facade, terrain, water... |
| `_scene!` / `getScene()!` 非空断言 | 8 | water, lighting, layers, blender, bone-override |
| 零测试覆盖 | 13 | clouds, particles, facade, lighting, props, loader, layers, blender, idle, autodance, lifelike, bridge, bone-override |
| 250LOC 超限 | 5 | lighting(1229), layers(611), autodance(540), perception(1155), bridge(448) |
| 循环依赖 | 3 | facade↔water, blender↔scene(still active), perception↔scene |

---

## 审核轮次速查

| 轮次 | 模块 | 文件 | 结论 | 报告 |
|------|------|------|------|------|
| ① | 环境水面 | `env-water.ts` | ⚠️ 有条件通过 | [查看](round-1-water.md) |
| ② | 环境云 | `env-clouds.ts` | ⚠️ 有条件通过 | [查看](round-2-clouds-particles.md) |
| ② | 环境粒子 | `env-particles.ts` | ⚠️ 有条件通过 | ↑ |
| ③ | 环境门面 | `env-impl.ts` | ⚠️ 有条件通过 | [查看](round-3-facade-terrain.md) |
| ③ | 环境地形 | `env-terrain.ts` | ⚠️ 有条件通过 | ↑ |
| ④ | 光照系统 | `lighting.ts` | ❌ 不通过 | [查看](round-4-lighting-props.md) |
| ④ | 光照预设 | `lighting-presets.ts` | ⚠️ 有条件通过 | ↑ |
| ④ | 环境光照 | `env-lighting.ts` | ✅ 通过 | ↑ |
| ④ | 道具 | `props.ts` | ⚠️ 有条件通过 | ↑ |
| ⑤ | VMD加载器 | `vmd-loader.ts` | ⚠️ 有条件通过 | [查看](round-5-vmd-layers.md) |
| ⑤ | VMD图层 | `vmd-layers.ts` | ⚠️ 有条件通过 | ↑ |
| ⑤ | WASM图层混合 | `wasm-layers-blender.ts` | ⚠️ 有条件通过 | ↑ |
| ⑤ | 图层配置 | `wasm-layers-config.ts` | ✅ 通过 | ↑ |
| ⑤ | VMD求值器 | `vmd-evaluator.ts` | ✅ 通过 | ↑ |
| ⑥ | 播放控制 | `playback.ts` | ✅ 通过 | [查看](round-6-playback-procedural-perception.md) |
| ⑥ | VMD写入器 | `vmd-writer.ts` | ✅ 通过 | ↑ |
| ⑥ | 节拍检测 | `beat-detector.ts` | ✅ 通过 | ↑ |
| ⑥ | 唇形同步 | `lipsync.ts` | ✅ 通过 | ↑ |
| ⑥ | 空闲程序化运动 | `proc-motion-idle.ts` | ⚠️ 有条件通过 | ↑ |
| ⑥ | 程序化自动舞蹈 | `proc-motion-autodance.ts` | ❌ 不通过 | ↑ |
| ⑥ | 逼真程序化运动 | `proc-motion-lifelike.ts` | ⚠️ 有条件通过 | ↑ |
| ⑥ | 程序化桥接 | `proc-motion-bridge.ts` | ⚠️ 有条件通过 | ↑ |
| ⑥ | 共享程序化逻辑 | `proc-motion-shared.ts` | ✅ 通过 | ↑ |
| ⑥ | 感知系统 | `perception.ts` | ✅ 通过（拆分后 10 文件全绿） | ↑ |
| ⑥ | VPD解析器 | `vpd-parser.ts` | ✅ 通过（测试覆盖佳） | ↑ |
| ⑦ | WASM图层混合(追审) | `wasm-layers-blender.ts` | ⚠️ 有条件通过 | [查看](round-7-wasm-bone-override.md) |
| ⑦ | 骨骼覆盖 | `bone-override.ts` | ⚠️ 有条件通过 | ↑ |
| ⑦ | scene.ts WASM集成 | `scene.ts` (WASM部分) | ✅ 通过 | ↑ |
| ⑧ | 感知层拆分 | `perception.ts` (共10文件) | ✅ 通过 | [查看](round-8-perception-split.md) |
| ⑨ | 镜面反射 | `env-water.ts`, `env-impl.ts`, `renderer.ts` | ⚠️ 有条件通过 | [查看](round-9-mirror-reflection.md) |

### 补充轮次（非渲染链模块）

| 日期 | 模块 | 文件 | 结论 | 报告 |
|------|------|------|------|------|
| 2026-07-31 | AI/安全 · 换装 · 物理桥 · Relay | `core/ai/*`, `outfit/outfit.ts`, `physics/physics-bridge.ts`, `relay/src/worker.js` | ✅ 通过（1×P2 待并入下轮） | [查看](2026-07-31-ai-outfit-physics-relay-audit.md) |
| 2026-08-06 | 第 10 轮：核心基础设施 | `core/state·init·render-loop·events·audio-bus·fileservice·load-manager`, `scene/scene`, `manager/*`, `camera/*`, `motion-pipeline`, `physics/*`, `render/*` | 18 模块：8✅ / 9⚠️ / 1❌（P1×4，已修 6 项） | [查看](2026-08-06-round11-core-backend-serialize-motion-menu.md)（同文件附第 10 轮结论于对话记录） |
| 2026-08-06 | 第 11 轮：后端/序列化/动作/菜单 | `core/backend/*`, `action-registry`, `runtime-bridge`, `scene-serialize`, `material`, `ar/*`, `motion-intent·history·retargeter`, `transform-*`, `menu`, `render-menu`, `library-*` | 16 模块：5✅ / 10⚠️ / 1❌（P1×3：ar-camera 死锁、motion-history 撤销栈、library-actions 并发） | [查看](2026-08-06-round11-core-backend-serialize-motion-menu.md) |
| 2026-08-06 | 第 12 轮：env 状态链/动作模块化/core 关键设施/AI 子模块 | `env-state-schema·bridge·dispatcher·persist·gravity·collision·time-of-day·ground-spec·ground`, `motion-modules/*`(base·types·registry·body-posture·feet·riding·hand·bone-override-store), `core`(mmd-adapter·runtime-mode·locale·shortcut-registry·load-refresh-registry·resource-warning-sink·feedback·orbit-state·ui-keyboard-nav·wails-bindings), `core/ai`(intent-dispatcher·scene-snapshot·sse·chat-store·character-bible), `motion`(feet-adjustment·lipsync-bridge·footstep) | 35 模块：19✅ / 14⚠️ / 2❌（P1×3：foot/hand 共享帧钩子互斥、feet-adjustment 引擎零测试） | [查看](2026-08-06-round12-env-motion-core-ai.md) |
| 2026-08-15 | 第 16 轮：守卫/拖拽导入/Toast | `core/guards`（+color-helpers 收敛）, `core/drop-import`, `core/toast` | 3 模块：3⚠️（P1×0 / P2×5：color-helpers guardNum 语义漂移、toast close a11y、drop-import 测试环境假成功、toast 测试隔离等；另修既有 TS2353 门禁红灯） | [guards](2026-08-15-round16-guards.md) · [drop-import](2026-08-15-round16-drop-import.md) · [toast](2026-08-15-round16-toast.md) |
| 2026-08-15 | 第 17 轮：资源释放/Observer/参数适配 | `core/dispose-helpers`, `core/observer-handle`, `core/ai/param-adapters` | 3 模块：2✅ / 1⚠️（P1×0 / P2×1：parseBoolean 黑名单补回归测试；P3×6：param-adapters 输入严格化+enum 大小写对称+合并重复测试文件、observer-handle 构造器签名；P4×3 顺手修） | [dispose-helpers](2026-08-15-round17-dispose-helpers.md) · [observer-handle](2026-08-15-round17-observer-handle.md) · [param-adapters](2026-08-15-round17-param-adapters.md) |
| 2026-08-15 | 第 18 轮：日志/日志面板/历史裁剪 | `core/logger`, `core/debug-log-panel`, `menus/diagnostic-chat` | 3 模块：1✅ / 2⚠️（P1×0 / P2×3：panel innerHTML 未转义注入面、Console 按钮状态不同步、ADR-248 编号错位；P3×6：logger 异常隔离等；P4×8 登记） | [logger](2026-08-15-round18-logger.md) · [debug-log-panel](2026-08-15-round18-debug-log-panel.md) · [prune-history](2026-08-15-round18-prune-history.md) |
| 2026-08-15 | 第 19 轮：滑块/配置诊断/vendored patch | `core/ui-slider-controller`, `core/ai/config-store`+`menus/diagnostic-config`, `scripts/apply-vendored-wasm.mjs` | 3 模块：3⚠️（P1×1：goKeyAllowsProceed 虚假覆盖→收敛 menus 版到 core 版；P2×3：slider mousedown 监听泄漏、core/menus 双实现语义分歧、patch 孤儿代码登记；P3×8 登记） | [slider-controller](2026-08-15-round19-slider-controller.md) · [settings-diagnostic](2026-08-15-round19-settings-diagnostic.md) · [vendored-patch](2026-08-15-round19-vendored-patch.md) |
| 2026-08-15 | 第 20 轮：schema 快照/e2e 钩子/配置持久化 | `menu-registry`+schema 快照, `core/dev-hooks`+`vite-env.d.ts`, `core/ai/config-store` 持久化路径 | 3 模块：1✅ / 2⚠️（P1×0 / P2×1：schema-snapshot mock 与共享工厂重复（登记）；P3×7：config-store endpoint 非字符串防御、vite-env.d.ts 声明漂移补齐等；P4×9 登记） | [schema-snapshot](2026-08-15-round20-schema-snapshot.md) · [dev-hooks](2026-08-15-round20-dev-hooks.md) · [config-store](2026-08-15-round20-config-store.md) |
| 2026-08-15 | 第 21 轮：SSS 材质/裙摆分析/程序化迁移 | `scene/manager/material-sss`, `scene/physics/skirt-analyzer`, `motion-algos/proc-motion-shared`(migrateProcState) | 3 模块：1✅ / 2⚠️（P1×0 / P2×2：material-sss sssColor 浅拷贝共享引用、skirt-analyzer 索引越界 NaN；**并修复 round-15 遗留 P1 matchBone return null→continue**；P3×6 登记） | [material-sss](2026-08-15-round21-material-sss.md) · [skirt-analyzer](2026-08-15-round21-skirt-analyzer.md) · [proc-motion-migrate](2026-08-15-round21-proc-motion-migrate.md) |
| 2026-08-15 | 第 22 轮：风力物理/模型附着/库路径 | `scene/physics/wind-physics`, `scene/manager/model-manager`(attach DAG), `core/library-path` | 3 模块：1✅ / 2⚠️（P1×0 / P2×1：attach DAG childIsDescendant 误拒合法重挂祖先操作；P3×4：wind-physics 自证式测试、browse-dir 注释矛盾已修等；P4×10 登记） | [wind-physics](2026-08-15-round22-wind-physics.md) · [model-attachment](2026-08-15-round22-model-attachment.md) · [browse-dir](2026-08-15-round22-browse-dir.md) |
| 2026-08-15 | 第 23 轮：脚步引擎/焦散/库会话 | `scene/motion/feet-adjustment`(引擎), `scene/env/env-caustics`, `menus/library-session-store` | 3 模块：3✅（P1×0 / P2×0 / P3×8 登记：feet-adjustment 手动覆盖期间 grounded 缓存、library-session 2000ms 魔法数值、env-caustics 测试内常量重复等；round-12 P1 补测 29 用例兑现） | [feet-adjustment-engine](2026-08-15-round23-feet-adjustment-engine.md) · [env-caustics](2026-08-15-round23-env-caustics.md) · [library-session-store](2026-08-15-round23-library-session-store.md) |
| 2026-08-15 | 第 24 轮：库状态/材质编辑器/舞台 | `core/state/library-state`, `scene/manager/material`, `menus/scene-stage-levels` | 3 模块：3✅（P1×0 / P2×1：material _applyMaterial/_applyCategory 60 行重复→提取共享 _applySingleMaterial；P3×9：scene-stage 死 mock 已删、library-state clear* 无生产调用点等登记） | [library-state](2026-08-15-round24-library-state.md) · [material-editor](2026-08-15-round24-material-editor.md) · [scene-stage](2026-08-15-round24-scene-stage.md) |
| 2026-08-15 | 第 25 轮：env 状态/换装/唇形算法 | `core/env-state-defaults`+`env-state-schema`, `scene/manager/outfit`, `motion-algos/lipsync` | 3 模块：2✅ / 1⚠️（P1×0 / P2×1：resetOutfit 不参与变体 guard/不清 pending——点变体后立刻 reset 会状态复活，修复 token 回填守卫 + 清 pending；P3×7 登记） | [env-state](2026-08-15-round25-env-state.md) · [outfit](2026-08-15-round25-outfit.md) · [lipsync](2026-08-15-round25-lipsync.md) |
| 2026-08-15 | 第 26 轮：音频/原生施力/Gizmo | `core/audio`, `core/mmd-adapter`(native 施力), `scene/transform/transform-gizmo` | 3 模块：2✅ / 1⚠️（P1×0 / P2×2：audio 淡入淡出定时器无取消→dispose 后触碰已释放 player、播放列表保留已 revoke blob URL→自动切歌失效；P3×8：mmd-adapter wind len 导出守卫已修等登记） | [audio](2026-08-15-round26-audio.md) · [mmd-adapter-native](2026-08-15-round26-mmd-adapter-native.md) · [transform-gizmo](2026-08-15-round26-transform-gizmo.md) |
| 2026-08-15 | 第 27 轮：VMD 校验/动作定义扩展/颜色工具 | `scene/motion/vmd-loader`, `core/action-defs`(scene/library/diagnostic), `core/color-helpers` | 3 模块：2✅ / 1⚠️（P1×0 / P2×0 / P3×9 登记：vmd 签名常量双定义、gen 镜像测试、action-defs restore 静默等；color-helpers 补 ±Infinity 集成护栏；round-5 _tryLoadCompanionAudio 零测试仍遗留） | [vmd-loader-race](2026-08-15-round27-vmd-loader-race.md) · [action-defs-extra](2026-08-15-round27-action-defs-extra.md) · [color-helpers](2026-08-15-round27-color-helpers.md) |
| 2026-08-15 | 第 28 轮：风力状态机/VMD 格式/图层 dispose | `scene/physics/wind-physics`(状态机), `motion-algos/vmd-writer`+`vpd-parser`, `scene/motion/vmd-layers`(composite dispose) | 3 模块：2✅ / 1⚠️（P1×0 / P2×0 / P3×5 登记：签名常量双定义遗留、纯 morph VPD 拒绝等；**修 vpd-parser Prettier 违规 CI 门禁**） | [wind-physics-state](2026-08-15-round28-wind-physics-state.md) · [vmd](2026-08-15-round28-vmd.md) · [vmd-layers-dispose](2026-08-15-round28-vmd-layers-dispose.md) |
| 2026-08-15 | 第 29 轮：风力 WASM 集成/缩略图捕获/感知性能 | `scene/physics/wind-physics`(施力链), `scene/manager/thumbnail-capture`, `perception` 热路径基准 | 3 模块：3⚠️（P1×0 / P2×3 登记：perception-perf gaze 复刻旧算法致占比低估、warm-up 50 帧致断言失真、ADR-164 阈值未回填；P3×11 登记；实测 balanceSway 占 51.1% 支持 ADR-164 low 档关 balance 方向） | [wind-physics-integration](2026-08-15-round29-wind-physics-integration.md) · [thumbnail-capture](2026-08-15-round29-thumbnail-capture.md) · [perception-perf](2026-08-15-round29-perception-perf.md) |
| 2026-08-15 | 第 30 轮：缩略图键/流式加载/序列化韧性 | `scene/manager/thumbnail-key`, `menus/library-core`(流式加载), `scene-serialize`(分段容错) | 3 模块：2✅ / 1⚠️（P1×0 / P2×1 登记：ADR-198 方向② saveSceneImmediate abort+toast 全仓零测试；P3×8 登记：aspect 常量三处重复、流式 mock 未走共享工厂等） | [thumbnail-key](2026-08-15-round30-thumbnail-key.md) · [library-thumbnail-streaming](2026-08-15-round30-library-thumbnail-streaming.md) · [scene-serialize-resilience](2026-08-15-round30-scene-serialize-resilience.md) |
| 2026-08-15 | 第 31 轮：动作意图守卫/数学工具/播放 seek | `scene/motion/motion-intent`(ratio 守卫), `core/clamp`+`math-geometry`, `scene/motion/playback`(seekFromEvent) | 3 模块：2✅ / 1⚠️（P1×0 / P2×0 / P3×9 登记：lerpArray NaN 延续、ratio 守卫不可达空真断言、seek 并发无协调等） | [motion-intent-ratio-guards](2026-08-15-round31-motion-intent-ratio-guards.md) · [utils-math](2026-08-15-round31-utils-math.md) · [playback-seek](2026-08-15-round31-playback-seek.md) |
| 2026-08-15 | 第 32 轮：渲染后处理/纹理 LRU/SSS PBR | `scene/render/renderer`(纯函数)+`camera-state`, `scene/manager/texture-lru`, `scene/manager/sss-pbr-material` | 3 模块：2✅ / 1⚠️（P1×0 / P2×1 登记：SssPBRMaterial 生产零消费未接线，ADR-242 跟踪；P3×6 登记：renderState 默认值双源、LRU 驱逐断言弱等） | [render-postprocess](2026-08-15-round32-render-postprocess.md) · [texture-lru](2026-08-15-round32-texture-lru.md) · [sss-pbr-material](2026-08-15-round32-sss-pbr-material.md) |
| 2026-08-15 | 第 33 轮：骨骼 dump/IK 时序/模型详情 UI | `scene/motion/bone-override`(hasIkSolver+IK 互斥), `menus/model-detail`(tags 收藏) | 3 模块：3⚠️（P1×0 / P2×3 修复：model-detail GetTagsByModel 裸 Promise→tryCatchStatus、ADR-248 编号错位扩散 4 文件→ADR-202 §六；P3×8 登记） | [dump-bone-hierarchy](2026-08-15-round33-dump-bone-hierarchy.md) · [ik-resolver-timing](2026-08-15-round33-ik-resolver-timing.md) · [model-detail-ui](2026-08-15-round33-model-detail-ui.md) |
| 2026-08-15 | 第 34 轮：脚步数学/姿态预设/模型替换继承 | `motion-algos/feet-adjustment-math`, `motion-algos/pose-preset`, `scene/manager/model-ops`(状态继承) | 3 模块：2✅ / 1⚠️（P1×0 / P2×1 登记：applyInheritedState 契约与实现脱钩——用全局焦点模型而非参数 newId；P3×8 登记：jumpThreshold 出厂 9999 vs ADR-085 文档 0.5 漂移等） | [feet-adjustment](2026-08-15-round34-feet-adjustment.md) · [pose-preset](2026-08-15-round34-pose-preset.md) · [replace-model-inherit](2026-08-15-round34-replace-model-inherit.md) |
| 2026-08-15 | 第 35 轮：程序化动作/播放 UI/序列化撤销 | `motion-algos/procedural-motion`(idle/autodance), `scene/motion/playback`(updatePlaybackUI), `scene-serialize`(offerSceneUndo) | 3 模块：1✅ / 2⚠️（P1×0 / P2×2：autodance loopFrames 封顶被 ×8 绕开(修复)、offerSceneUndoAndRefresh 成功链路零覆盖(登记)；**补 matchBone 跳过不可编码候选回归测试**；P3×14 登记） | [procedural-motion](2026-08-15-round35-procedural-motion.md) · [playback-ui](2026-08-15-round35-playback-ui.md) · [scene-serialize-undo](2026-08-15-round35-scene-serialize-undo.md) |
| 2026-08-15 | 第 36 轮：播放 observables/模型加载器/库核心 | `scene/motion/playback`(initPlaybackObservables), `scene/manager/model-loader`, `menus/library-core` | 3 模块：1✅ / 2⚠️（P1×0 / P2×1 修复：playback test 11 假阳性——断言对齐 autoLoop 快照语义；P3×11 登记：library-core mock 陈旧 rejection 泄漏、model-loader 分支重复等） | [playback-observables](2026-08-15-round36-playback-observables.md) · [model-loader](2026-08-15-round36-model-loader.md) · [library-core](2026-08-15-round36-library-core.md) |

---

## 改进优先级建议

### ⚡ 立即修复（P1）

| 优先级 | 问题 | 影响 |
|--------|------|------|
| 1 | `lighting.ts` `transitionLighting` 未调度 → 灯光过渡静默不执行 | 用户调灯光预设无过渡效果 |
| 2 | `env-water.ts` `disposeWater` `getScene()` 无 null guard | dispose 后再次调用抛 NPE |
| 3 | `proc-motion-autodance.ts` 零测试 + 超限 + undefined 问题 | 运行时可能产生错误骨骼帧 |
| 4 | `bone-override.ts` `MmdRuntimeBoneExtended` 接口重复定义 | 修改一处需手动同步另一处 |

### 📋 短期改进（P2）

| 问题 | 涉及模块 |
|------|----------|
| 补充 `as any` 安全性注释 | water, facade, lighting, loader, layers |
| 添加 dispose 统一清理入口 | lighting.ts（缺少 `disposeLighting()`） |
| 拆分超限模块（>250LOC） | lighting, layers, bridge, autodance |
| 水面反射 BFC 恢复（`onAfterRenderObservable` 缺失） | env-water.ts（P2.1，影响所有材质网格性能+正确性） |
| 水面/地面 renderList 每帧重建（应加脏标记） | env-water.ts, env-impl.ts（性能隐患） |
| 添加核心零测试模块的基础测试 | clouds, particles, facade, loader, layers, blender |

### 🔧 持续改进（P3）

| 问题 | 涉及模块 |
|------|----------|
| 修复循环依赖 | facade↔water, blender↔scene |
| 非空断言加 guard | 全模块 canvas.getContext, _scene |
| 优化 GC | particles splash `new Vector3` 每帧 |

---

## 审核标准参考

- 审核执行标准见 `AGENTS.md` → `# 审核代码可用性`
- ADR 参考: ADR-051(图层), ADR-052(地面), ADR-056(WASM), ADR-083(地面架构)
- 术语规范: `docs/terminology.md`
