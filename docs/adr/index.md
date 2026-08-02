<!-- 本文件由 scripts/gen-docs-index.mjs 自动生成，请勿手改。重跑：npm run gen:docsindex -->

# 决策记录（ADR）

> 架构决策日志，共 **225** 篇（ADR-001 起按编号递增）。决策一旦写下即不可变；状态变化以各 ADR 文件首部「状态」行为准。

## 按状态分布

| 状态 | 数量 | 含义 |
|------|------|------|
| [推进中](#推进中) | 5 | 已开工，尚未收口（含部分实施） |
| [规划中](#规划中) | 8 | 已立项，等待实施 |
| [已落地](#已落地) | 201 | 实施完成，代码已合入 |
| [已归档](#已归档) | 10 | 被取代、放弃、过时或搁置，保留供追溯 |
| [其他](#其他) | 1 | 状态行缺失或表述不可归类 |

> 本文件为 ADR **规范索引**（按状态分组导航，可锚点跳转）。带日期的全量列表见 [项目现状 · ADR 索引](../status.md)（附表，由 `scripts/gen-status-index.mjs` 生成）。

## 推进中

| ADR | 主题 | 状态 |
|-----|------|------|
| [ADR-220](./adr-220-schema-integrity-metatest.md) | Schema 完整性元测试 —— 不开浏览器，秒级捕获 schema 漂移 | 实施中 |
| [ADR-215](./adr-215-eliminate-prop-kind.md) | 取消「道具」资源类型 — 模型附属关系替代 prop + accessory 体系 | 🔄 实施中 |
| [ADR-204](./adr-204-unit-test-layering-and-hygiene.md) | 单测分层与治理规范（拆上帝文件 · 降 mock 密度 · fixtures 复用 · unit/integration 分层） | 🟢 实施中 |
| [ADR-189](./adr-189-ktx2-texture-compression.md) | 纹理加载路径优化（并行读取 + basename 共享 + LRU + KTX2 基础设施） | 实施中 — Phase 0/1 全量 2133/… |
| [ADR-109](./adr-109-ar-audit-resolution-and-deferral.md) | AR 模块审查结论与遗留项排期 | `部分实现` |

## 规划中

| ADR | 主题 | 状态 |
|-----|------|------|
| [ADR-229](./adr-229-e2e-automation-advancement.md) | E2E 自动化推进 —— 从 schema 到测试零映射 | 📝 规划 |
| [ADR-223](./adr-223-water-surface-overhaul.md) | 水面视觉效果整顿 —— 法线混合、深度泡沫、折射扭曲、SSS、渐变颜色 | 规划 |
| [ADR-222](./adr-222-water-depth-fog.md) | 水面深度差雾（Depth-Difference Fog）—— 从相机距离雾迁移至水柱厚度雾 | 规划 |
| [ADR-209](./adr-209-lunar-celestial-body.md) | 月亮 —— 第二天体的渐进式设计（复用太阳骨架） | 📝 规划 |
| [ADR-187](./adr-187-babylon-mmd-remaining-apis-analysis.md) | babylon-mmd 剩余高价值功能综合分析 | 草案 · 待立项 |
| [ADR-110](./adr-110-immdmodel-upstream-pr.md) | IMmdModel 接口类型补全 — 上游 PR 计划 | 草案 · 待立项 |
| [ADR-073](./adr-073-native-arcore-arkit.md) | AR 地形识别 —— 原生 ARCore / ARKit 桥接 | 提案 |
| [ADR-072](./adr-072-webxr-plane-detection.md) | AR 平面检测 —— WebXR hit-test + plane detection | 提案 |

## 已落地

| ADR | 主题 | 状态 |
|-----|------|------|
| [ADR-228](./adr-228-ui-rows-round3.md) | UI 行控件公共化第三轮 + 命名去 `_` 前缀 | 已完成 |
| [ADR-227](./adr-227-personal-light-shadow-toggle.md) | 个人灯阴影按需开关与分辨率可调 | 已完成 |
| [ADR-226](./adr-226-ground-material-spec-single-source.md) | 地面材质单一事实源重构（GroundMaterialSpec） | 已落地 |
| [ADR-225](./adr-225-web-pages-path-reallocation.md) | Web 部署路径重分配 — 文档站占 Pages 根、主应用降 /app/ 子路径 | 已实施 |
| [ADR-224](./adr-224-plaza-广场数据源统一与持久化.md) | Plaza 广场数据源统一与持久化 — GitHub 远程配置 + Go 用户目录缓存 + 内置兜底 + id 统一 | 已实施 |
| [ADR-221](./adr-221-per-material-alpha.md) | 逐材质透明度（alphaMul）—— 材质编辑器第 11 参数 | 已完成 |
| [ADR-219](./adr-219-测试并发调优与-isolate-污染治理.md) | 测试并发调优与 isolate 污染治理 — vitest 全量提速：maxWorkers 落地 + isolate=false 障碍清理 | 已完成 |
| [ADR-218](./adr-218-knowledge-base-governance.md) | 知识库（docs/knowledge）分层治理 — 痛点与方案 | 已实施 |
| [ADR-217](./adr-217-water-infinite-size-single-source.md) | 地水无限尺寸单源化 — 水面跟进 groundInfiniteEnabled | ✅ 已实施 |
| [ADR-216](./adr-216-remove-dead-underwater-fog-fields.md) | 移除死状态字段 underwaterFogDensity / underwaterFogMultiplier | ✅ 已实施 |
| [ADR-214](./adr-214-menu-id-naming.md) | Menu ID 命名规范治理 | ✅ 已完成 |
| [ADR-213](./adr-213-go-envstate-binding-drift.md) | Go 后端 EnvState 命名漂移修复与契约补全 | ✅ 已完成 |
| [ADR-212](./adr-212-naming-vs-functionality-audit.md) | 命名 vs 翻译 vs 实际功能错位系统审计与治理 | ✅ 已完成 |
| [ADR-211](./adr-211-水面功能开关体系.md) | 水面功能开关体系 — 噪声原语消重与效果分组开关化 | ✅ Part 1/2/3 完成 |
| [ADR-210](./adr-210-env-lighting-field-rename.md) | 环境光照字段名名实相符重命名（envIntensity/envBrightness） | ✅ 已完成 |
| [ADR-208](./adr-208-ground-preset-sourcekind.md) | 地面预设贴图设计统一 —— sourceKind 语义标注（预留）+ 程序化纹理防覆盖 | ✅ 已完成 |
| [ADR-207](./adr-207-motion-menu-restructure.md) | 动作菜单重构 —— 程序化动作可加载化 + 双面板对称 | ✅ 已完成 |
| [ADR-206](./adr-206-test-infra-consolidation-and-assertion-quality.md) | 测试基础设施收敛与断言质量治理 | 🟢 已完成 |
| [ADR-205](./adr-205-ai-tools-read-write-loop.md) | AI 工具体系全景 — 从写操作到读写闭环 | ✅ 已完成 |
| [ADR-203](./adr-203-ai-assistant-sessions-and-panel.md) | AI 助手会话持久化与独立面板 | 🟢 已完成 |
| [ADR-202](./adr-202-fork-autonomy-batch.md) | fork 自治改动批次 — 一次回灌批量根治可改 fork 的上游缺口 | ✅ P0 已落地 |
| [ADR-201](./adr-201-path2-native-rigidbody-handle.md) | 路径2 — 给 babylon-mmd fork 增加原生刚体施力导出（wasm 侧解析） | ✅ 已实施 |
| [ADR-200](./adr-200-wind-physics-empty-bundle-map.md) | 风力对模型自带刚体无效 — 遍历 map 恒空的架构误解 | ✅ 已定性 |
| [ADR-198](./adr-198-场景序列化异常的保存韧性.md) | 场景序列化异常的保存韧性 | 已实施 |
| [ADR-197](./adr-197-unified-action-registry.md) | 统一动作注册表 — 菜单可维护性归一化 | 🟢 已完成 |
| [ADR-196](./adr-196-llm-diagnostic-assistant.md) | 内置 AI 诊断助手（LLM Diagnostic Assistant） | ✅ 已完成 |
| [ADR-195](./adr-195-download-folder-unification.md) | 下载文件夹统一修订（三平台系统下载目录 + 消除"二扫"） | 已完成 |
| [ADR-194](./adr-194-wind-physics-fix.md) | 风物理系统修复 — 从「假风」到真实风场 | 已完成 |
| [ADR-193](./adr-193-stable-model-identity.md) | 模型稳定身份（inst.id = 持久化 uuid） | 已立项 · 已实现 |
| [ADR-192](./adr-192-upstream-adapter-layer.md) | 上游适配层重构（MmdAdapter） | 已立项 · Phase 2 已完成 |
| [ADR-191](./adr-191-god-barrel-debarreling.md) | 神桶 `@/core/utils` 去桶化（零依赖叶下沉） | 已完成 |
| [ADR-190](./adr-190-capability-declarative-consolidation.md) | 端能力声明式收口（淘汰散落 isAndroidPlatform 分支） | 已完成 |
| [ADR-188](./adr-188-pbr-material-builder.md) | PBRMaterialBuilder 材质系统迁移 — PBR 渲染升级 | Phase 1 基本完成 |
| [ADR-186](./adr-186-bone-override-frame-timing.md) | bone-override 帧内时序图 | accepted |
| [ADR-185](./adr-185-web-zip-pmx-subdir-relpath.md) | 网页端 ZIP 内子目录 PMX 贴图路径维度对齐 | 已完成 |
| [ADR-184](./adr-184-web-zip-encoding-and-bomb-guard.md) | 网页端 ZIP 嵌套识别能力补齐（多编码检测 + 炸弹防护对齐 Go 端） | 已完成 |
| [ADR-183](./adr-183-fsa-auth-guidance.md) | 网页端 FSA 根目录授权引导（四态探针 + 重授权兜底） | 已完成 |
| [ADR-182](./adr-182-web-zip-keyspace-namespacing.md) | 网页端 ZIP 导入键规约命名空间化（消除同名 PMX 纹理碰撞） | 已完成 |
| [ADR-181](./adr-181-download-manager-panel.md) | 下载管理面板（扫描→解压→入库→processed 标记）【经 ADR-195 修订定位与行为】 | 已完成 |
| [ADR-180](./adr-180-fsa-handle-persistence.md) | Web 资源库 FSA 句柄持久化与启动自动重扫 | 已完成 |
| [ADR-179](./adr-179-update-install-launch-platform-tiered.md) | 更新安装拉起（按平台分级） | 已完成 |
| [ADR-178](./adr-178-capability-matrix-host-keys.md) | 能力矩阵补全宿主级键（四端统一收口） | 已完成 |
| [ADR-177](./adr-177-web-loader-main-app-unification.md) | Web Loader 与主应用统一路径 | 已完成 — Phase 0-3 落地 + Pha… |
| [ADR-176](./adr-176-frontend-backend-adapter.md) | 前端 Backend 适配器双实现（Web/Desktop 通杀） | 已完成 |
| [ADR-175](./adr-175-light-intensity-multi-entry-ruling.md) | 光照强度多入口设计意图裁决 | ✅ 已裁决 |
| [ADR-174](./adr-174-quality-dimension-registry.md) | 质量维度注册表 — 统一 qualityProfile 扩展点 | 已完成 |
| [ADR-173](./adr-173-env-bridge-middleware.md) | env-bridge setEnvState 中间件化重构 | 已完成 |
| [ADR-172](./adr-172-wet-body-effect.md) | 湿身效果：雨天角色材质湿润感 | 已完成 |
| [ADR-171](./adr-171-scene-drag-mode.md) | 场景级拖拽模式：快捷开关 + 收纳文件夹 | 已完成 |
| [ADR-170](./adr-170-motion-selection-paradigm.md) | 动作库选中范式 —— 将「默认」暴露为逐行「选中」（对齐模型焦点范式） | 已实施 |
| [ADR-169](./adr-169-motion-load-replace-default.md) | 动作装载语义统一 —— 原位替换默认动作（replaceDefaultMotion） | 已实施 |
| [ADR-168](./adr-168-dynamic-light-tracking.md) | 动态追光：舞台灯跟随角色/骨骼 | 已实现 |
| [ADR-167](./adr-167-scene-motion-library.md) | 场景级动作库（Scene Motion Library）— 多主动作平等共存 | 已完成 |
| [ADR-166](./adr-166-perception-permodel-rework.md) | 感知层 per-model 上下文真实隔离（ADR-162/163 返工） | 已完成 |
| [ADR-165](./adr-165-perception-performance-benchmark.md) | 感知层性能基准 — 为 ADR-164 全员感知降级提供阈值依据 | 已完成 |
| [ADR-164](./adr-164-perception-permodel-phase2.md) | 感知层 per-model 实例化 — Phase 2（全员感知 + 性能降级） | 已实现 |
| [ADR-163](./adr-163-perception-conflict-visibility.md) | 感知层冲突可视化 — 闭环「左右脑互博」用户层可见性 | 已完成 |
| [ADR-162](./adr-162-perception-permodel-phase1.md) | 感知层 per-model 实例化 — Phase 1（pinned 模型支持） | 已完成 |
| [ADR-161](./adr-161-balancesway-params-exposure.md) | balanceSway 独立参数暴露 — 补齐感知层 UI 可调性 | 已完成 |
| [ADR-160](./adr-160-gaze-delta-exponential-decay.md) | Gaze Delta 指数衰减 — 闭环「左右脑互博」物理根因最后一环 | 已完成 |
| [ADR-159](./adr-159-render-dedup-and-refactor.md) | 渲染模块重复收口 + 关键补测 + 两项结构性重构决策 | 已实施 |
| [ADR-158](./adr-158-motion-system-refactor.md) | 动作系统三连修 + 全项目审核快修 | 已实施 |
| [ADR-157](./adr-157-settings-ia-restructure.md) | 设置界面信息架构重组 — 10 分类 → 7 分类 | 已实施 — Phase 1 |
| [ADR-156](./adr-156-llm-character-dialogue-route.md) | 大模型交流 — 创意路线（角色台词生成） | 🟡 Step 1 + Step 2a 已实施 |
| [ADR-155](./adr-155-llm-nl-scene-control-route.md) | 自然语言控场景 — 叠加于 AiService 管线之上 | 🟢 已完成 |
| [ADR-153](./adr-153-accessibility-roadmap.md) | 无障碍（a11y）支持总体方案 | ✅ 全部完成 |
| [ADR-152](./adr-152-stage-light-cone.md) | 舞台灯光光锥（Light Cone） | ✅ 已实施 |
| [ADR-151](./adr-151-reflection-unified-architecture.md) | 反射系统统一架构（SSR/Probe 统一入口 + Planar 协调） | ✅ 已实施 |
| [ADR-150](./adr-150-model-replace-contract.md) | 模型替换原子操作契约（Model Replace Contract） | ✅ 已完成 |
| [ADR-148](./adr-148-overload-file-split.md) | 过载文件拆分工程 | ✅ 已完成 |
| [ADR-147](./adr-147-explicit-motion-pipeline-scheduler.md) | 动作管线显式调度器 + 集中骨骼覆盖状态 | 已完成 |
| [ADR-146](./adr-146-function-duplication-triage.md) | 函数级重复摸排与收敛（第二波） | ✅ 已完成 |
| [ADR-145](./adr-145-motion-presets.md) | 多模块协同预设 — 一键启用组合姿态 | ✅ P1 已实施 |
| [ADR-143](./adr-143-unification-remaining.md) | 可统一代码收敛（P1 之外剩余项） | 已完成 |
| [ADR-142](./adr-142-with-status.md) | withLoadingStatus 加载状态机统一 | 已完成 |
| [ADR-141](./adr-141-state-split.md) | state.ts 拆分 — 状态基座重构 | 实施完成 |
| [ADR-140](./adr-140-drag-slider-controller.md) | DragSliderController 统一滑块输入 | 完成 |
| [ADR-139](./adr-139-observer-registry.md) | Observer 生命周期统一管理 | ✅ 已完成 |
| [ADR-138](./adr-138-env-dispatcher-decouple.md) | env-dispatcher 破循环依赖 | 已完成 |
| [ADR-137](./adr-137-envstate-single-source-schema.md) | EnvState 单一源 Schema | 已实施 |
| [ADR-136](./adr-136-thumbnail-abortsignal.md) | 缩略图流式加载 AbortSignal 协作式取消 | ✅ 已完成 |
| [ADR-135](./adr-135-library-session-store.md) | LibrarySessionStore — 资源库状态收敛基座 | ✅ 已完成 |
| [ADR-134](./adr-134-infinite-ground-correction.md) | 无限地面方案修正 — 废弃相机跟随，扩大地面尺寸范围 | 已采纳 |
| [ADR-132](./adr-132-env-brightness-unification.md) | 环境亮度统一标量（EnvBrightness Unification） | 已实施 |
| [ADR-131](./adr-131-resource-browse-selection-outcome.md) | 资源浏览选中结果统一契约（BrowseOutcome） | ✅ 已完成 |
| [ADR-130](./adr-130-scene-ui-roadmap.md) | 场景 UI 整体设计与前后端发展方向路线图 | 规划中 |
| [ADR-129](./adr-129-scene-level-motion-ui.md) | 动作菜单场景级重设计（Scene-level Motion UI） | 已完成—最终实现偏离设计 |
| [ADR-128](./adr-128-mirror-prop-rename.md) | 镜面道具化重命名（debugMirror → mirror） | ✅ 已完成 |
| [ADR-127](./adr-127-scene-destructive-undo.md) | 场景级破坏性操作撤销 — Memento 快照 + 撤销 Toast | 已实现 |
| [ADR-126](./adr-126-transform-adapter.md) | 变换适配器统一（TransformAdapter Registry）— 跨 kind 拖拽/数值双模态去重 | ✅ 已完成 |
| [ADR-125](./adr-125-motion-undo-redo.md) | 动作覆盖撤销/重做 — 模块层 `setParam` 历史栈 | 已实施 |
| [ADR-124](./adr-124-filesystem-architecture.md) | 文件服务架构审计 —— 从 HTTP 中转到 ArrayBuffer 直传 | 已完成 |
| [ADR-123](./adr-123-compute-override-semantics.md) | `_computeOverride` 语义正式化 — weight≥1 复合、overrideRotation 标志、absolute 模式 | P1 已实施 |
| [ADR-122](./adr-122-ik-aware-bone-override.md) | IK 感知骨骼覆盖 — 运动模块 IK 适配 | P1 已实施 |
| [ADR-121](./adr-121-global-motion-intent.md) | 全局动作意图（Scene-level Motion Intent）— 场景级意图 + 每实例继承/覆盖 | 已实施 |
| [ADR-120](./adr-120-env-preset-categorized.md) | 环境预设分类化 — 天空/地面/水面/大气 | ✅ Phase 1 完成 |
| [ADR-119](./adr-119-thumbnail-key-single-source.md) | 缩略图缓存键单一源治理 | Phase 1 + Phase 2 已完成 |
| [ADR-118](./adr-118-refresh-rate-aware-degradation.md) | 刷新率感知的自动降级阈值 | ✅ 已完成 |
| [ADR-117](./adr-117-go-error-i18n.md) | Go 端用户可见错误的 i18n 化 | ✅ 已完成 |
| [ADR-116](./adr-116-bone-override-ui-redesign.md) | 动作覆盖系统 — 模块化架构 + 骨骼覆盖下沉 | 已完成 |
| [ADR-115](./adr-115-stylized-water-glint-research.md) | 风格化水体竞品调研与波光粼粼增强方向 | P1+P2+P3+P4 已完成 |
| [ADR-114](./adr-114-ground-reflection-enhancement.md) | 地面反射增强 — 从平面近似到 PBR 材质 | 已完成 |
| [ADR-113](./adr-113-horizon-volumetric-clouds.md) | 体积云延展地平线与画质/性能升级 | 完成 |
| [ADR-112](./adr-112-sdef-injector.md) | SdefInjector + SdefMesh 接入 — SDEF 球面变形 | 已完成 |
| [ADR-111](./adr-111-scene-env-menu-restructuring.md) | 场景/环境菜单按用户直觉重新划分 | 已实施 |
| [ADR-108](./adr-108-animation-retargeter.md) | AnimationRetargeter + HumanoidMmd 接入 — 扩展动作来源 | 已落地 |
| [ADR-107](./adr-107-stream-audio-player.md) | StreamAudioPlayer 接入 — 替换自建音频管线 | 已完成 |
| [ADR-106](./adr-106-timing-audit-and-async-lifecycle.md) | 时序审核与异步生命周期规范 | ✅ 全部完成 |
| [ADR-105](./adr-105-abort-signal-and-async-error-handling.md) | AbortSignal 传递规范与异步异常处理基线 | ✅ Phase 1 + Phase 2 完成 |
| [ADR-104](./adr-104-physics-outfit-design-debt-deferral.md) | 物理/换装/音频子系统设计债暂缓登记 | 已完成 |
| [ADR-103](./adr-103-settings-store-persistence.md) | SettingsStore 接入 setUIState 持久化链路 | 已完成 |
| [ADR-102](./adr-102-main-ts-split.md) | main.ts 拆分（init / events / render-loop / dev-hooks） | 已完成 |
| [ADR-101](./adr-101-utility-logic-consolidation-wave2.md) | 通用逻辑模式收敛（第二波） | 已完成 |
| [ADR-100](./adr-100-camera-control-behavior-dual-axis.md) | 相机系统「控制方案 × 运动行为」双轴拆分 | 已完成 |
| [ADR-099](./adr-099-mpr-coop-coep-poc.md) | babylon-mmd 未利用 API 接入 · Item 4 MPR 多线程 WASM 物理（Go 端 COOP/COEP 注入 POC） | 已完成 |
| [ADR-098](./adr-098-babylon-mmd-api-adoption-batch1.md) | babylon-mmd 未利用 API 接入 · 批次一（描边渲染 + Composite 动画类型收敛） | 已完成 |
| [ADR-097](./adr-097-library-restore-consolidation.md) | 资源库浏览与恢复决策汇总（含模型记忆） | ✅ 已实施 |
| [ADR-096](./adr-096-general-helper-consolidation.md) | 通用 Helper 单点收敛 | 已完成 |
| [ADR-095](./adr-095-path-normalization-consolidation.md) | 路径归一化与归属判定统一 | 已完成 |
| [ADR-094](./adr-094-replace-mode-auto-return-library.md) | 资源库替换模式 — 加载后自动保持替换状态并回到模型列表 | 已完成 |
| [ADR-093](./adr-093-menu-declarative-schema.md) | 菜单声明式 Schema —— 单一数据源 + 单渲染器，根治「大」与「AI 难改」 | 已完成 P0+P1+P2 |
| [ADR-092](./adr-092-unified-texture-reflection.md) | 贴图与反射统一 —— 单一纹理工厂 + 单一平面反射引擎 | 已完成 |
| [ADR-091](./adr-091-ground-texture-unification.md) | 地面纹理统一 —— 4 种样式合并为单一 canvas + StandardMaterial 路径 | 已完成 |
| [ADR-090](./adr-090-dialog-last-dir.md) | 对话框默认目录记忆（按资源类型）—— 双端可用 | 已完成 |
| [ADR-089](./adr-089-ground-mode-split.md) | 地面模式分类重构 —— 拆分为几何类型(groundType) + 外观样式(groundStyle) | 已完成 |
| [ADR-088](./adr-088-audio-sfx-footstep.md) | 音效系统 — 脚步声与 SFX 总线 | Phase A + Phase B 已完成；Ph… |
| [ADR-087](./adr-087-plaza-browser-experience.md) | 模型广场 · 浏览器体验增强路线图 | 已完成 |
| [ADR-086](./adr-086-catwalk-procedural-motion.md) | 猫步走秀程序化动作（Catwalk Procedural Motion） | 通过 |
| [ADR-085](./adr-085-feet-adjustment.md) | 脚部地面跟随（Feet Adjustment） | Phase A 已完成；Phase B/C 降级… |
| [ADR-084](./adr-084-mesh-to-cloth-virtual-skirt-bones.md) | Mesh-to-Cloth 虚拟裙骨生成 —— WASM Bullet 运行时刚体注入 | 已完成 |
| [ADR-083](./adr-083-ground-enhancement-expansion.md) | 地面功能扩展 —— 反射/倾斜/纹理滚动/高程着色/跟随网格/图案扩展/法线贴图 | 已交付 — Phase A + Phase B … |
| [ADR-082](./adr-082-ci-cross-tag-cache-warm.md) | 跨发版 CI 缓存预热（cache-warm 落盘 main 作用域） | 已实施 |
| [ADR-081](./adr-081-xpbd-removal.md) | XPBD(TS) 测试物理全栈移除与受影响 ADR 审计 | 已实施 |
| [ADR-080](./adr-080-observer-cascade-preset-anim.md) | 预设动画 observer 级联暴涨——addOnce 自注册陷阱 | 已修复 |
| [ADR-079](./adr-079-perception-layer-expansion.md) | 感知层扩展——always-on 实时叠加的适用边界 | Phase 1-4 已实施 |
| [ADR-078](./adr-078-plaza-download-intercept.md) | 模型广场 · 下载拦截（iframe 内一键入库） | 已实施 |
| [ADR-077](./adr-077-plaza-cookie-relay.md) | 模型广场 · Cookie 中继（登录态代理） | 已实施 |
| [ADR-076](./adr-076-cel-shading-postprocess-mode.md) | 卡通化渲染后处理模式 | ✅ 已实施 |
| [ADR-075](./adr-075-model-plaza-web-browsing.md) | 模型广场 · 网页浏览（内嵌代理 + 外链闭环） | 已采纳 · 已实施 |
| [ADR-071](./adr-071-proc-vs-perception-boundary.md) | 程序化动作与角色感知边界重构 | 已实施 |
| [ADR-070](./adr-070-concert-camera-rename.md) | 相机模式「演唱会」语义重构（拆分出「环绕」模式） | 已实施 |
| [ADR-067](./adr-067-ui-duplication-audit.md) | UI 重复率审计与重构 | 已完成 |
| [ADR-066](./adr-066-fullscreen-resource-library.md) | 全屏资源库界面（精简版） | ✅ 已实施 |
| [ADR-065](./adr-065-pure-items-hot-render.md) | 纯 items 层级语言热切换刷新（精简版） | ✅ 已实施 |
| [ADR-064](./adr-064-scene-cycle-and-dir-wrappers.md) | 技术债清偿（续）—— *Dir 包装维持现状 + scene.ts 业务循环依赖破除 | 已实施 |
| [ADR-063](./adr-063-architecture-debt-paydown.md) | 架构债务清偿（精简版） | ✅ 已实施 |
| [ADR-062](./adr-062-water-reflection-render-target.md) | 水面反射渲染目标与通用反射系统 | 已完成 |
| [ADR-61.1](./adr-061.1-plan.md) | Ragdoll 保真度补齐 实施计划 | 已交付 |
| [ADR-61.1](./adr-061.1-ragdoll-fidelity.md) | Ragdoll 保真度补齐（球面关节 + 旋转求解 + 暂停/过渡仲裁 + 关节参数化） | 已交付 |
| [ADR-061](./adr-061-advanced-bone-systems.md) | 高级骨骼操控与姿态工作室实现计划 | 已完成 |
| [ADR-060](./adr-060-e2e-testing-strategy.md) | E2E 测试策略（Playwright + 双模式 Fixture + 场景数值钩子） | ✅ 已完成 |
| [ADR-059](./adr-059-i18n-framework.md) | i18n 多语言切换框架 | 已完成 |
| [ADR-058](./adr-058-basenameFallbackFS.md) | 纹理路径字节级匹配 —— basenameFallbackFS 多编码兜底 | 已实施 |
| [ADR-057](./adr-057-shift-jis-url-base64.md) | Shift-JIS URL 乱码修复 —— Base64 查询参数方案（链路 A） | 已实施 |
| [ADR-056](./adr-056-wasm-runtime-motion-layers.md) | WASM 运行时 Motion Layers 解锁 — JS 帧流合并 + 单图层兜底 | ✅ 已实施 |
| [ADR-055](./adr-055-ar-camera-mode.md) | AR 相机模式 —— 摄像头视频透传与模型叠加 | 已实施 |
| [ADR-054](./adr-054-roadmap-next.md) | 后续开发方向路线图 | 规划 |
| [ADR-053](./adr-053-gaze-layer-integration.md) | Gaze 图层集成 —— 视线追踪作为图层类型 | 已完成 |
| [ADR-052](./adr-052-ground-mode-enhancement.md) | 地面模式增强 —— 网格大小/第二颜色/高度/纹理旋转 | 已完成 |
| [ADR-051](./adr-051-vmd-layers-bonefilter.md) | VMD 图层系统与骨骼级过滤 | 已完成 |
| [ADR-050](./adr-050-save-callback-unification.md) | 保存触发机制统一 | 已实施 |
| [ADR-049](./adr-049-orbit-control-extension.md) | 轨道控制统一 — 球面坐标扩展到模型/道具 | 已实现 |
| [ADR-048](./adr-048-transform-unification.md) | 变换系统统一 — 模型/灯光/道具移动一致性 | 已完成 — 反序列化统一 + 输入验证均已实施。… |
| [ADR-047](./adr-047-config-persistence-coverage.md) | 配置持久化覆盖现状 | 已完成 — 2026-07-06 会话中修复了配… |
| [ADR-046](./adr-046-render-custom-mode.md) | 渲染独立开关 — Custom 性能模式（精简版） | ✅ 已实施 |
| [ADR-045](./adr-045-unified-loading.md) | 统一加载与资源管理（精简版） | ✅ 已完成 |
| [ADR-042](./adr-042-motion-algos-rename.md) | motion/ → motion-algos/ 目录改名 | 已完成 |
| [ADR-041](./adr-041-ci-auto-checks.md) | CI 自动检查 — Markdown 链接校验 + AI Mistake Tracker | 已完成 |
| [ADR-039](./adr-039-docs-simple.md) | 文档体系精简 | 已完成 |
| [ADR-038](./adr-038-scene-motion-audit-and-env-fog.md) | 动作系统审计修复 + 雾系统增强 + 颜色滑块拖拽 | 已完成 |
| [ADR-037](./adr-037-session-ui-improvements.md) | P2 功能批量交付 — Lifelike / Formation / Auto Camera / Scene Bundle | 已完成 |
| [ADR-036](./adr-036-shortcut-registry.md) | ShortcutRegistry — 可配置快捷键系统 | 已完成 — ShortcutRegistry 核… |
| [ADR-035](./adr-035-settings-gap-analysis.md) | 设置面板功能缺口评估 | 已完成 |
| [ADR-034](./adr-034-menu-unification.md) | 菜单体系大统一 — slideRow + cardContainer + lcard | 已完成 — 全量迁移完成，所有菜单面板统一为 s… |
| [ADR-033](./adr-033-config-split-and-dedup.md) | config.ts 四向分裂 + tryCatchStatus 泛化 + slideRow 收束 | 已完成 — config.ts 分裂、tryCa… |
| [ADR-032](./adr-032-cloud-rendering-investigation.md) | 体积云渲染方案调查 | 已完成 — 调查完毕，结论：Babylon.js… |
| [ADR-031](./adr-031-session-2026-07-05-adr-cleanup.md) | 2026-07-05 会话清理 — 文档翻新 + AGENTS.md 瘦身 + 硬约束精简 | 已完成 |
| [ADR-030](./adr-030-novel-directory-restructure.md) | 小说目录按功能分类重组 | 已实现 — 小说素材目录按功能分类重组完成 |
| [ADR-029](./adr-029-physics-ui-restructure.md) | 物理设置界面重构 — 从布料单页到双系统分治 | 已实现 — XPBD 布料/WASM Bulle… |
| [ADR-028](./adr-028-wind-system-unification.md) | 风场系统统一 — 从碎片化到集中治理 | 已实现 — wind-utils.ts 统一风向… |
| [ADR-027](./adr-027-menu-reactivity-system.md) | 菜单响应式系统 — 控件自更新 + Proxy 自动触发 | 已实现 — Proxy 拦截 envState … |
| [ADR-026](./adr-026-environment-system-enhancement.md) | 环境系统增强 — 纹理地面、粒子系统、粒子溅射、水下后处理联动 | 已完成 — Phase A 纹理地面 + Pha… |
| [ADR-025](./adr-025-touch-optimization-and-zip-scanning.md) | 触屏交互优化与 ZIP 模型扫描通用化 | 已完成 — P0/P1/P2 全部实现 |
| [ADR-024](./adr-024-rendering-enhancement-phase2-ssr-reflectionprobe.md) | 渲染增强 Phase 2（精简版） | ✅ SSR/ReflectionProbe/SS… |
| [ADR-022](./adr-022-preset-governance.md) | 预设治理 — 统一管理范围与分级架构 | 已实现 — 8 项改动全完成：EnvPreset… |
| [ADR-021](./adr-021-procedural-motion.md) | 程序化动作系统（Idle/Auto Dance + LipSync + 视线追踪） | 已完成 — Idle/AutoDance/Lip… |
| [ADR-020](./adr-020-outfit-system.md) | 换装系统（服装变体/纹理替换） | 已完成 — Phase 8 完成，outfit.… |
| [ADR-018](./adr-018-path-manager-abstraction.md) | PathManager 平台抽象层 + 文件 I/O 审计 | 已完成 — PathManager 接口 + t… |
| [ADR-017](./adr-017-android-adaptation.md) | Android 平台适配（精简版） | 主体已完成 |
| [ADR-016](./adr-016-gaze-tracking-architecture.md) | 视线追踪子系统架构 | 已完成 — 双路径方案已实施 |
| [ADR-015](./adr-015-material-editor-refactor.md) | 材质编辑器 UI 重构 + 逐材质开关 | 已完成 — buildMatRootLevel/… |
| [ADR-014](./adr-014-model-preset-library.md) | 模型加载预设库（角色设置快照） | 已完成 — 保存/加载/库管理/自动匹配/try… |
| [ADR-013](./adr-013-skybox-improvement.md) | Skybox 贴图系统改进 | 已完成 — SelectEnvTextureFi… |
| [ADR-011](./adr-011-wails-version-strategy.md) | Wails v3 迁移评估与决策 | 已完成 — 已迁至 Wails v3，项目当前运… |
| [ADR-009](./adr-009-model-details-panel.md) | 模型详情面板 — 运行时模型实例控制 | 已完成 — Phase 1-5 全部完成 |
| [ADR-006](./adr-006-scan-and-encoding.md) | 扫描简化 + 文件名多编码自动检测 | 已完成 — bestDecode/cleanMo… |
| [ADR-005](./adr-005-pending-debt.md) | 待修复项 — 已知技术债务 | 已完成 — #1 HTTP 目录隔离 |
| [ADR-004](./adr-004-css-unification.md) | CSS 统一重构 + 弹窗单例模式 | 已完成 — CSS 变量体系 12 token … |
| [ADR-003](./adr-003-download-strategy.md) | 下载监听策略（精简版） | 方案 C 已实施 ✅；方案 E 远期构想 |
| [ADR-002](./adr-002-writeconfig-split.md) | 配置写入分离 — writeConfig 轻写 vs writeConfigAndRescan 全量 | 已完成 — writeConfig 从 writ… |
| [ADR-001](./adr-001-project-infrastructure.md) | 项目基础设施决策 | 已完成 — 5 条基础设施决策已定案。注意：fo… |

## 已归档

| ADR | 主题 | 状态 |
|-----|------|------|
| [ADR-199](./adr-199-llm-capability-boundaries.md) | LLM 能力边界与缓解策略（归档） | 📋 归档登记 |
| [ADR-154](./adr-154-llm-chat-panel-route.md) | 引入大模型交流能力 — 推荐路线（聊天面板打底） | 🗑️ 已被 ADR-196 取代 |
| [ADR-149](./adr-149-material-outfit-baseline-conflict.md) | 材质系统 × 换装系统基线冲突登记 | 搁置登记 |
| [ADR-144](./adr-144-per-model-overlay-motion.md) | Per-model Overlay Motion（动作2 叠加层） | 已废弃 |
| [ADR-074](./adr-074-cubemap-rt-spherical-reflection.md) | 动态 Cubemap RT 球面反射 | 🗑️ 已放弃 |
| [ADR-069](./adr-069-material-texture-support-audit.md) | 材质面板纹理支持审计与推进路线 | 调研落档 — 材质面板当前仅支持 4 标量乘率，… |
| [ADR-044](./adr-044-competitive-analysis.md) | MMD 生态竞品分析 | 已完成 — 调研归档 |
| [ADR-043](./adr-043-dancexr-gap-analysis.md) | DanceXR 功能差距挖掘 | 已完成 — 调研归档 |
| [ADR-019](./adr-019-xpbd-cloth-simulation.md) | XPBD 布料模拟引擎选型与架构 | 已完成 — xpbd-solver/collid… |
| [ADR-012](./adr-012-cloud-rendering.md) | 云渲染改进 — Perlin 噪声 + 双分层 | ⚠️ 已过时 — 被 **[ADR-113] |

## 其他

| ADR | 主题 | 状态 |
|-----|------|------|
| [ADR-133](./adr-133-android-mpr-gap.md) | Android MPR 多线程物理缺失——构建门控与架构障碍 | ⚠️ 决策二证伪 — Android WebVi… |
