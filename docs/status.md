# MikuMikuAR 项目现状

> 最后更新：2026-07-23
> 本文件记录当前状态，可随项目进展维护。
> **⚠️ 非权威状态源**：ADR 状态以 `docs/adr/` 各文件首部状态行为准（见项目铁律）。本文件仅作里程碑摘要，不作为 ADR 状态的判定依据。

---

## ADR 索引（权威全量）

> 本表由 `scripts/gen-status-index.mjs` 自动生成。修改状态请在 ADR 文件首部 `> **状态**: xxx` 进行，然后重新运行脚本。
> 状态以各 ADR 源文件为准。

<!-- GEN:ADR_INDEX start -->

| ADR | 主题 | 状态 |
|-----|------|------|
| ADR-177 | Web Loader 与主应用统一路径 | Phase 0 Spike 通过（2026-07-23；S1-S7 全绿，主应用在浏览器成功启动。可进入 Phase 1 Runtime Bridge 实施。资源拖入加载需手动验证） |
| ADR-176 | 前端 Backend 适配器双实现（Web/Desktop 通杀） | 已完成（2026-07-23；Phase 1-3 全部落地。Phase 3 已完成 web-loader 准完整网页入口、IndexedDB 模型库、能力徽章、lastModel 恢复引导和库面板；验证：tsc 0 错、backend 16/16、契约 17/17、全量回归绿） |
| ADR-175 | 光照强度多入口设计意图裁决 | ✅ 已裁决（裁决为「保留多入口，不收敛为单入口」；无代码改动，仅固化契约）（2026-07-22） |
| ADR-174 | 质量维度注册表 — 统一 qualityProfile 扩展点 | 已完成（2026-07-22） |
| ADR-173 | env-bridge setEnvState 中间件化重构 | 已完成（2026-07-22） |
| ADR-172 | 湿身效果：雨天角色材质湿润感 | 已完成（2026-07-22） |
| ADR-171 | 场景级拖拽模式：快捷开关 + 收纳文件夹 | 已完成（2026-07-22） |
| ADR-170 | 动作库选中范式 —— 将「默认」暴露为逐行「选中」（对齐模型焦点范式） | 已实施（2026-07-22, 9ac064d9） |
| ADR-169 | 动作装载语义统一 —— 原位替换默认动作（replaceDefaultMotion） | 已实施（2026-07-21） |
| ADR-168 | 动态追光：舞台灯跟随角色/骨骼 | 已实现（Phase A-D 完成，E 远期搁置）（2026-07-22（立项）→ 2026-07-23（Phase A-D 落地）） |
| ADR-167 | 场景级动作库（Scene Motion Library）— 多主动作平等共存 | 已完成（2026-07-23 核心功能落地，P0-P3 全部实施）（2026-07-21） |
| ADR-166 | 感知层 per-model 上下文真实隔离（ADR-162/163 返工） | 已完成（2026-07-21；P4-4 对象池 per-context 追加于 2026-07-22 commit 20f1e8f7；独立审核：tsc 0 错误 / frontend 1829 测试全绿） |
| ADR-165 | 感知层性能基准 — 为 ADR-164 全员感知降级提供阈值依据 | 已完成（2026-07-21） |
| ADR-164 | 感知层 per-model 实例化 — Phase 2（全员感知 + 性能降级） | 已实现（2026-07-21；全员感知 + 三档自动降级已落地，1821 测试通过） |
| ADR-163 | 感知层冲突可视化 — 闭环「左右脑互博」用户层可见性 | 已完成（2026-07-21；P2-1 重 claim / P2-2 unpin 入口 / P2-3 banner 泛化由 ADR-166 收口；独立审核 frontend 1821 测试 0 失败） |
| ADR-162 | 感知层 per-model 实例化 — Phase 1（pinned 模型支持） | 已完成（2026-07-21；per-model 真实隔离由 ADR-166 收口；独立审核 frontend 1821 测试 0 失败） |
| ADR-161 | balanceSway 独立参数暴露 — 补齐感知层 UI 可调性 | 已完成（2026-07-21） |
| ADR-160 | Gaze Delta 指数衰减 — 闭环「左右脑互博」物理根因最后一环 | 已完成（2026-07-21） |
| ADR-159 | 渲染模块重复收口 + 关键补测 + 两项结构性重构决策 | 已实施（Phase 1/2/P3-A/P3-B/P4 全部完成）（2026-07-21） |
| ADR-158 | 动作系统三连修 + 全项目审核快修 | 已实施（2026-07-21） |
| ADR-157 | 设置界面信息架构重组 — 10 分类 → 7 分类 | 已实施 — Phase 1（IA 重组 + 缺陷修复 + 5 语言 i18n）+ Phase 1.5（审核后补修：监听器泄漏 / i18n 冻结 / renderCustom 契约）均完成并通过构建/单测；搜索/color picker 留待 Phase 3（2026-07-21） |
| ADR-156 | 大模型交流 — 创意路线（角色台词生成） | 🔄 规划中（候选）（2026-07-20） |
| ADR-155 | 大模型交流 — 激进路线（直接 NL 控场景） | 🔄 规划中（候选，非推荐）（2026-07-20） |
| ADR-154 | 引入大模型交流能力 — 推荐路线（聊天面板打底） | 🔄 规划中（推荐）（2026-07-20） |
| ADR-153 | 无障碍（a11y）支持总体方案 | ✅ 全部完成（2026-07-21）— 三阶段全部落地：焦点环、`aria-live`、focus trap/restore、canvas ARIA（P1）；`prefers-*` 媒体查询、Android 返回键、3D 键盘轨道控制、模型 alt（P2）；aria-label 补全、`aria-keyshortcuts`、axe E2E 扫描、`ui-keyboard-nav.ts` 公共工具、Go 系统主题桥接（P3）。（2026-07-20） |
| ADR-152 | 舞台灯光光锥（Light Cone） | ✅ 已实施（v2 — 真实光锥网格）（2026-07-20） |
| ADR-151 | 反射系统统一架构（SSR/Probe 统一入口 + Planar 协调） | ✅ 已实施（2026-07-20） |
| ADR-150 | 模型替换原子操作契约（Model Replace Contract） | ✅ 已完成（2026-07-20） |
| ADR-149 | 材质系统 × 换装系统基线冲突登记 | 搁置登记（架构性风险，未修复）（2026-07-20） |
| ADR-148 | 过载文件拆分工程 | ✅ 已完成（5/5 阶段全部落地，2026-07-21 收口）（2026-07-20（收口 2026-07-21）） |
| ADR-147 | 动作管线显式调度器 + 集中骨骼覆盖状态 | 已完成（Phase 1 + Phase 2 运行时接入全部落地，R1/R2/R3/R4 根治；Phase 3 在 motion 子系统范围内已完成，见 §八 说明） |
| ADR-146 | 函数级重复摸排与收敛（第二波） | ✅ 已完成（P1 主题 1–5 / P2 主题 6–11 / P3 主题 12–14 全量落地；全量回归 `vitest run` 76 文件/1700 用例全绿；`npm run build` 0 错误）（2026-07-19） |
| ADR-145 | 多模块协同预设 — 一键启用组合姿态 | ✅ P1 已实施（类型定义 + applyMotionPreset + UI 卡片 + Go 侧 .mcpreset.json CRUD + 5 语言 i18n）（2026-07-17） |
| ADR-144 | Per-model Overlay Motion（动作2 叠加层） | 已废弃（被 ADR-167 取代）（2026-07-19） |
| ADR-143 | 可统一代码收敛（P1 之外剩余项） | 已完成（2026-07-19） |
| ADR-142 | withLoadingStatus 加载状态机统一 | 已完成（2026-07-19） |
| ADR-141 | state.ts 拆分 — 状态基座重构 | 实施完成（2026-07-19） |
| ADR-140 | DragSliderController 统一滑块输入 | 完成（已实施）（2026-07-19） |
| ADR-139 | Observer 生命周期统一管理 | ✅ 已完成（2026-07-19） |
| ADR-138 | env-dispatcher 破循环依赖 | 已完成（2026-07-19 Phase 3 完成：env-water/clouds/particles 各自注册回调 + env-bridge → env-impl 依赖消除） |
| ADR-137 | EnvState 单一源 Schema | 已实施（2026-07-19） |
| ADR-136 | 缩略图流式加载 AbortSignal 协作式取消 | ✅ 已完成（P2.2 落地；`tsc` 零错误 + 单测 5/5 + 关联回归 118/118 + `build` 通过）（2026-07-19） |
| ADR-135 | LibrarySessionStore — 资源库状态收敛基座 | ✅ 已完成（P0.1 ✅ / P0.3 ✅ / P1.2 ✅ / P1.3 ✅ / P2 ✅；P0.2 loadId trace 独立于本 store）（2026-07-19） |
| ADR-134 | 无限地面方案修正 — 废弃相机跟随，扩大地面尺寸范围 | 已采纳（2026-07-19） |
| ADR-133 | Android MPR 多线程物理缺失——构建门控与架构障碍 | 部分落地（构建门控已补）、架构障碍延期（2026-07-18） |
| ADR-132 | 环境亮度统一标量（EnvBrightness Unification） | 已实施（2026-07-21 UI/i18n/预设层补齐闭环）（2026-07-18） |
| ADR-131 | 资源浏览选中结果统一契约（BrowseOutcome） | ✅ 已完成（2026-07-20 代码核查确认：BrowseOutcome 类型定义、`activateItem` 派发（stay/jumpToDir/close）、grid 模式适配、`buildLevel` outcome 参数均已落地；旧全局标志位 `modelReplaceTargetId`/`layerBindingTargetId`/`motionBindingTargetId` 已移除）（2026-07-18） |
| ADR-130 | 场景 UI 整体设计与前后端发展方向路线图 | 规划中（Phase 1 技术债 ✅1.1 部分完成（外观收口），1.2/1.3 已解决；Phase 2 ✅2.1/2.2/2.3 已完成，✅2.4 已完成，✅2.7 已完成，2.5/2.6 待推进；Phase 3 能力扩展待推进）（2026-07-18） |
| ADR-129 | 动作菜单场景级重设计（Scene-level Motion UI） | 已完成—最终实现偏离设计（2026-07-18） |
| ADR-128 | 镜面道具化重命名（debugMirror → mirror） | ✅ 已完成（2026-07-20 代码核查确认：全部 debugMirror 重命名已迁移，仅 env-bridge.ts 迁移代码维持旧字段兼容引用；i18n 5 语种无残留） |
| ADR-127 | 场景级破坏性操作撤销 — Memento 快照 + 撤销 Toast | 已实现（2026-07-18） |
| ADR-126 | 变换适配器统一（TransformAdapter Registry）— 跨 kind 拖拽/数值双模态去重 | ✅ 已完成（Phase 1 + Phase 2 + Phase 3 全量落地；2026-07-18 代码审核通过：P1 修复 + P4 派生单测补齐） |
| ADR-125 | 动作覆盖撤销/重做 — 模块层 `setParam` 历史栈 | 已实施（P1+P2+P3 完成）（2026-07-17） |
| ADR-124 | 文件服务架构审计 —— 从 HTTP 中转到 ArrayBuffer 直传 | 已完成（Phase 1-3 全部落地；HTTP 文件服务保留作 fallback）（2026-07-17） |
| ADR-123 | `_computeOverride` 语义正式化 — weight≥1 复合、overrideRotation 标志、absolute 模式 | P1 已实施（2026-07-21）— `absolute` 标志已加入 `_OverrideSlot`/`OverrideSlotLike`/`BoneOverrideEntry`，`_computeOverride` 已增加 absolute 分支，高级骨骼覆盖 UI 写 `absolute=true`；P2（`restoreOverrides` 处理）已完成（2026-07-17） |
| ADR-122 | IK 感知骨骼覆盖 — 运动模块 IK 适配 | P1 已实施（2026-07-21）— `applyBoneOverrideIK` 辅助函数已新增，riding-model 膝/足骨已改用 IK 感知写入；P2（module-base 暴露）已完成；**P3（高级骨骼覆盖 UI IK 骨骼标记）已完成** — `motion-override-levels.ts:580/743` 两处 `_isIkBone` 标记（2026-07-17） |
| ADR-121 | 全局动作意图（Scene-level Motion Intent）— 场景级意图 + 每实例继承/覆盖 | 已实施（P0+P1+P2 已完成，2026-07-18）（2026-07-17） |
| ADR-120 | 环境预设分类化 — 天空/地面/水面/大气 | ✅ Phase 1 完成（Go API + bindings + TS 分类预设 + UI 重写 + i18n + 单测全绿；待真机验证）（2026-07-16） |
| ADR-119 | 缩略图缓存键单一源治理 | Phase 1 + Phase 2 已完成（模型 + 道具写侧收口至 `thumbnail-key.ts`；VMD 缩略图死路径已删除；meta 缓存错位已修复）。后续审计曾将 `thumbnailCache` 内存缓存与 `GetModelMeta.thumbnail` 列为待清理 deferred，经核实二者均**无需清理**（`thumbnailCache` 为活跃 UI 缩略图数据源；`ModelMeta` 本无 `thumbnail` 字段，先前误将 `DanceSet.Thumbnail` 归错）。治理已闭环。契约测试 `thumbnail-key.contract.test.ts` 已作防反弹熔断丝（16 例全过） |
| ADR-118 | 刷新率感知的自动降级阈值 | ✅ 已完成（Phase 1 刷新率相对阈值 + Phase 2 运行时峰值校准全量落地） |
| ADR-117 | Go 端用户可见错误的 i18n 化 | ✅ 已完成（Phase 1 + 2 + 3 全部完成；信封方案见 §2.6） |
| ADR-116 | 动作覆盖系统 — 模块化架构 + 骨骼覆盖下沉 | 已完成（P0+P1+P2+P3 全部实施并通过验证：tsc + 1557 单测 + ESLint）。2026-07-17 补充：`_computeOverride` `weight≥1` 语义修正为复合父骨传播旋转，详见 §十一。 |
| ADR-115 | 风格化水体竞品调研与波光粼粼增强方向 | P1+P2+P3+P4 已完成（2026-07-22）；P5 海洋波澜专项已实施。 |
| ADR-114 | 地面反射增强 — 从平面近似到 PBR 材质 | 已完成（Phase 1 ✅ 2026-07-16 — PBR 材质 + 程序化木纹 + UI 面板 + i18n + Go/TS 状态同步；Phase 2 ✅ 2026-07-16 — 反射模糊(mipmap+roughness) + 法线扭曲(bumpTexture) + 低质量守卫；Phase 3 ✅ 2026-07-16 — 接触阴影(屏幕空间 ray marching 后处理) + 中/高质量守卫） |
| ADR-113 | 体积云延展地平线与画质/性能升级 | 完成（前置渲染分层 + Phase A slab-uniform 步长/地平线延展/地面交界/距离雾 + Phase B Weather Map/Erosion + Phase C 双瓣散射/Powder/高度梯度日落着色 + Phase D1 Blue-noise dither 全部落地） |
| ADR-112 | SdefInjector + SdefMesh 接入 — SDEF 球面变形 | 已完成（2026-07-14 决策；2026-07-22 修正实现 — 由空操作 side-effect import 改为显式 `OverrideEngineCreateEffect(engine)` 调用，SDEF 方真正生效） |
| ADR-111 | 场景/环境菜单按用户直觉重新划分 | 已实施 |
| ADR-110 | IMmdModel 接口类型补全 — 上游 PR 计划 | 草案 · 待立项 |
| ADR-109 | AR 模块审查结论与遗留项排期 | `部分实现`（2026-07-14） |
| ADR-108 | AnimationRetargeter + HumanoidMmd 接入 — 扩展动作来源 | 已落地（2026-07-14 — 桥接模块 + UI 入口；2026-07-22 — 文件格式过滤 + 场景序列化 + 状态管理完整落地） |
| ADR-107 | StreamAudioPlayer 接入 — 替换自建音频管线 | 已完成（2026-07-14 落地 — 全 3 阶段：内部实现替换 + 测试适配 + MmdRuntime 集成） |
| ADR-106 | 时序审核与异步生命周期规范 | ✅ 全部完成（Phase 1 ✅ + Phase 2 ✅ + Phase 3 ✅） |
| ADR-105 | AbortSignal 传递规范与异步异常处理基线 | ✅ Phase 1 + Phase 2 完成（2026-07-14） |
| ADR-104 | 物理/换装/音频子系统设计债暂缓登记 | 已完成（Claim 11/12 已落地偿付）；Claim 13 正式搁置（2026-07-19）（2026-07-14） |
| ADR-103 | SettingsStore 接入 setUIState 持久化链路 | 已完成（2026-07-13） |
| ADR-102 | main.ts 拆分（init / events / render-loop / dev-hooks） | 已完成（2026-07-13） |
| ADR-101 | 通用逻辑模式收敛（第二波） | 已完成（P1-a/P1-b/P2/P3 全部完成；12 纯函数新增 + 43 单测 + 15 处调用点迁移；tsc 通过 / vitest 1476 测试通过） |
| ADR-100 | 相机系统「控制方案 × 运动行为」双轴拆分 | 已完成（2026-07-16 对账：P1-P5 全部落地，无 P6 阶段） |
| ADR-99 | babylon-mmd 未利用 API 接入 · Item 4 MPR 多线程 WASM 物理（Go 端 COOP/COEP 注入 POC） | 已完成（Go 端 COOP/COEP 注入 `c2a0734` + 前端 MPR 切换 + 真机 WebView2 验证 `crossOriginIsolated=true` / `SharedArrayBuffer=true` / `useMultiThread=true` 全绿，2026-07-14 收口）（2026-07-13） |
| ADR-98 | babylon-mmd 未利用 API 接入 · 批次一（描边渲染 + Composite 动画类型收敛） | 已完成（2026-07-13） |
| ADR-97 | 资源库浏览与恢复决策汇总（含模型记忆） | ✅ 已实施（2026-07-13） |
| ADR-96 | 通用 Helper 单点收敛 | 已完成（2026-07-13） |
| ADR-95 | 路径归一化与归属判定统一 | 已完成（批次 1–5 全落地，2026-07-13） |
| ADR-94 | 资源库替换模式 — 加载后自动保持替换状态并回到模型列表 | 已完成 |
| ADR-93 | 菜单声明式 Schema —— 单一数据源 + 单渲染器，根治「大」与「AI 难改」 | 已完成 P0+P1+P2（57 个面板迁移完成，env/motion/scene/model/settings 全域覆盖；library/language 为动态列表/纯导航性质，非面板类面板，无需 schema 化）；P3 收尾（移除死 builder、删除 barrel 兼容 re-export、全量类型化）待推进 |
| ADR-92 | 贴图与反射统一 —— 单一纹理工厂 + 单一平面反射引擎 | 已完成 |
| ADR-91 | 地面纹理统一 —— 4 种样式合并为单一 canvas + StandardMaterial 路径 | 已完成 |
| ADR-90 | 对话框默认目录记忆（按资源类型）—— 双端可用 | 已完成（2026-07-12）（2026-07-11 / 2026-07-12（双端重构 + 浏览器扩展）） |
| ADR-89 | 地面模式分类重构 —— 拆分为几何类型(groundType) + 外观样式(groundStyle) | 已完成 |
| ADR-88 | 音效系统 — 脚步声与 SFX 总线 | Phase A + Phase B 已完成；Phase C（音乐增强）搁置（2026-07-19）（2026-07-11） |
| ADR-87 | 模型广场 · 浏览器体验增强路线图 | 已完成（P0+P1+P2 全部实施完毕：window 模式下载拦截 `/__plaza_dl__` + 导航控制 + 遥控面板 + URL 追踪 `/__plaza_url__` + 下载进度 + Per-site 模式记忆 + Embed 加载指示 + 拖放导入 + 下载完成 Toast + 模型库自动刷新 + 键盘快捷键） |
| ADR-86 | 猫步走秀程序化动作（Catwalk Procedural Motion） | 通过（2026-07-11） |
| ADR-85 | 脚部地面跟随（Feet Adjustment） | Phase A 已完成；Phase B/C 降级搁置（2026-07-19）· 已纳入代码审核 4 项修正（纯文档，无代码变更）（2026-07-11） |
| ADR-84 | Mesh-to-Cloth 虚拟裙骨生成 —— WASM Bullet 运行时刚体注入 | 已完成（Phase 1-5 POC 全链路 + P2/P3 审计加固 + 单测全绿 + 五语言 i18n。代码层无剩余待办；「真机/模型实测微调参数」归用户验证，非开发任务。P2b(A1 蒙皮天花板)/P3c(worldId 回收) 为已知限制，详见 §3.5 / §十 P3c） |
| ADR-83 | 地面功能扩展 —— 反射/倾斜/纹理滚动/高程着色/跟随网格/图案扩展/法线贴图 | 已交付 — Phase A + Phase B 全部实施完成；terrain 倾斜于 2026-07-12 追加支持（坐标变换方案） |
| ADR-82 | 跨发版 CI 缓存预热（cache-warm 落盘 main 作用域） | 已实施（2026-07-11 经 commit `788b2e9` 落地 `cache-warm.yml`，Linux GTK 修复 `4192631`；v1.2.7 tag run `29118031286` 实测三平台全命中） |
| ADR-81 | XPBD(TS) 测试物理全栈移除与受影响 ADR 审计 | 已实施（2026-07-10 经 commit `530af6e` 落地；`go build` / `npm run check` / `vitest` 1206 测试全绿） |
| ADR-80 | 预设动画 observer 级联暴涨——addOnce 自注册陷阱 | 已修复（2026-07-10） |
| ADR-79 | 感知层扩展——always-on 实时叠加的适用边界 | Phase 1-4 已实施（2026-07-14） |
| ADR-78 | 模型广场 · 下载拦截（iframe 内一键入库） | 已实施 |
| ADR-77 | 模型广场 · Cookie 中继（登录态代理） | 已实施 |
| ADR-76 | 卡通化渲染后处理模式 | ✅ 已实施（2026-07-10）（2026-07-09） |
| ADR-75 | 模型广场 · 网页浏览（内嵌代理 + 外链闭环） | 已采纳 · 已实施（Phase 1 基础代理 + 导航接入） |
| ADR-74 | 动态 Cubemap RT 球面反射 | 🗑️ 已放弃（2026-07-19，stash 内容已清理。Stash 中的 cubemap 代码与当前 HEAD 架构冲突——水反射已改用统一 `PlanarReflection` 引擎（ADR-092），model-loader 传参方式也不同（二进制 vs URL）。材料诊断工具等附属代码一并移除。后续若重新评估此方案，需基于当前 HEAD 重写。） |
| ADR-73 | AR 地形识别 —— 原生 ARCore / ARKit 桥接 | 提案（Proposed）—— ADR-055 §3.1 方案 C「平台原生 ARCore / ARKit 桥接」的细化，远期可 reconsider（2026-07-09） |
| ADR-72 | AR 平面检测 —— WebXR hit-test + plane detection | 提案（Proposed）—— ADR-055 Phase 3「WebXR 升级」的细化，待 P1 探针结果后批准（2026-07-09） |
| ADR-71 | 程序化动作与角色感知边界重构 | 已实施（方案 B 全部落地；2026-07-09 创建，2026-07-10 核实代码已落地） |
| ADR-70 | 相机模式「演唱会」语义重构（拆分出「环绕」模式） | 已实施 |
| ADR-69 | 材质面板纹理支持审计与推进路线 | 调研落档 — 材质面板当前仅支持 4 标量乘率，贴图槽位归 outfit，PBR 流延续 ADR-024 决策延期（2026-07-09） |
| ADR-67 | UI 重复率审计与重构 | 已完成（2026-07-05 执行两轮重构） |
| ADR-66 | 全屏资源库界面（精简版） | ✅ 已实施（Phase 1-4） |
| ADR-65 | 纯 items 层级语言热切换刷新（精简版） | ✅ 已实施（2026-07-09） |
| ADR-64 | 技术债清偿（续）—— *Dir 包装维持现状 + scene.ts 业务循环依赖破除 | 已实施（2026-07-08 起草并落地，循环依赖审计确认零残留——两条业务型环已通过动态 `import()` 破除，`*Dir` 包装保持现状） |
| ADR-63 | 架构债务清偿（精简版） | ✅ 已实施（2026-07-08，build+1128 tests 通过） |
| ADR-62 | 水面反射渲染目标与通用反射系统 | 已完成（2026-07-10）— P1 核心（MirrorCamera + RT + 着色器扩展 + UI）+ P2 增强（波浪 UV 偏移 + 泡沫衰减） |
| ADR-61 | 高级骨骼操控与姿态工作室实现计划 | 已完成（2026-07-10，2026-07-16 对账修正）— Pose Studio ✅、Motion Override ✅、Accessory ✅、T-pose/A-pose ✅（并入 Pose Studio）。Ragdoll ❌ 永久废弃（随 XPBD 全栈移除 530af6e，不再恢复）。 |
| ADR-60 | E2E 测试策略（Playwright + 双模式 Fixture + 场景数值钩子） | ✅ 已完成（Phase 0 / Phase 1 / Phase 2 / Phase 3，2026-07-07 提出并推进） |
| ADR-59 | i18n 多语言切换框架 | 已完成（2026-07-10 全部 Phase 落地，奇偶校验脚本已接 CI；2026-07-22 废弃 Go UIState 持久化升级预留路径；剩余 ja/ko/zh-TW 翻译质量为人工/AI 走查任务，非框架范畴） |
| ADR-58 | 纹理路径字节级匹配 —— basenameFallbackFS 多编码兜底 | 已实施（2026-07-06） |
| ADR-57 | Shift-JIS URL 乱码修复 —— Base64 查询参数方案（链路 A） | 已实施（2026-07-06） |
| ADR-56 | WASM 运行时 Motion Layers 解锁 — JS 帧流合并 + 单图层兜底 | ✅ 已实施（2026-07-08 代码核实；wasm-layers-blender.ts 实现 + vmd-layers.ts:630 集成） |
| ADR-55 | AR 相机模式 —— 摄像头视频透传与模型叠加 | 已实施（2026-07-06 评审通过；2026-07-11 Phase 1 桌面 MVP 落地；**2026-07-11 代码核查确认 Phase 2 移动端 + Gaze 协同已全部实现**） |
| ADR-54 | 后续开发方向路线图 | 规划（2026-07-06 创建；2026-07-07 代码复核修订；2026-07-11 全量核实更新 + 正式废弃 JS 调试运行时，所有剩余功能仅面向 WASM；后经代码核查修复：修正 5 处文件路径、Ragdoll 回滚标注、补充 ADR-083、i18n 5 语言补齐；2026-07-11 AR 相机 Phase 1 落地；**2026-07-11 Playback Modes + Remix 标记为废弃**；**2026-07-11 智能材质分类已核实为已完成**；**2026-07-11 LipSync 共振峰口型已核实为已完成**；**2026-07-11 Scene Bundle 分发已核实为已完成**）（2026-07-20 复核：P0/P1 已清空；P2 仅剩 Mesh-to-Cloth（ADR-084）+ AR Phase 3/WebXR（ADR-072）+ 原生 ARCore/ARKit（ADR-073）三项开放缺口） |
| ADR-53 | Gaze 图层集成 —— 视线追踪作为图层类型 | 已完成（2026-07-06） |
| ADR-52 | 地面模式增强 —— 网格大小/第二颜色/高度/纹理旋转 | 已完成（2026-07-06） |
| ADR-51 | VMD 图层系统与骨骼级过滤 | 已完成（2026-07-06） |
| ADR-50 | 保存触发机制统一 | 已实施（代码完成；完整构建受无关预存错误阻塞，见 §6）（2026-07-06） |
| ADR-49 | 轨道控制统一 — 球面坐标扩展到模型/道具 | 已实现（2026-07-06 落地 Phase 1 + Phase 2，`tsc --noEmit` 与 `vite build` 通过） |
| ADR-48 | 变换系统统一 — 模型/灯光/道具移动一致性 | 已完成 — 反序列化统一 + 输入验证均已实施。回调统一标记为可选（优先级低），未做（2026-07-06） |
| ADR-47 | 配置持久化覆盖现状 | 已完成 — 2026-07-06 会话中修复了配置未持久化 Bug（clothConfig 防抖、调试开关、相机/时间流逝状态等），并完成全量覆盖梳理。 |
| ADR-46 | 渲染独立开关 — Custom 性能模式（精简版） | ✅ 已实施（2026-07-06） |
| ADR-45 | 统一加载与资源管理（精简版） | ✅ 已完成（Phase 1 + Phase 2 全部落地） |
| ADR-44 | MMD 生态竞品分析 | 已完成 — 调研归档（2026-07-05） |
| ADR-43 | DanceXR 功能差距挖掘 | 已完成 — 调研归档（2026-07-05） |
| ADR-42 | motion/ → motion-algos/ 目录改名 | 已完成（2026-07-05） |
| ADR-41 | CI 自动检查 — Markdown 链接校验 + AI Mistake Tracker | 已完成（2026-07-05） |
| ADR-39 | 文档体系精简 | 已完成（2026-07-05 执行） |
| ADR-38 | 动作系统审计修复 + 雾系统增强 + 颜色滑块拖拽 | 已完成（2026-07-05） |
| ADR-37 | P2 功能批量交付 — Lifelike / Formation / Auto Camera / Scene Bundle | 已完成（2026-07-05） |
| ADR-36 | ShortcutRegistry — 可配置快捷键系统 | 已完成 — ShortcutRegistry 核心 + main.ts 迁移 + 设置面板 UI 全部就位（2026-07-05） |
| ADR-35 | 设置面板功能缺口评估 | 已完成 (Completed) — Phase A / B / C 全部落地（含 i18n 语言切换、自动更新开关、默认模型 auto-center），所有设置缺口均已补齐，见下方「实施进度」（2026-07-05） |
| ADR-34 | 菜单体系大统一 — slideRow + cardContainer + lcard | 已完成 — 全量迁移完成，所有菜单面板统一为 slideRow/cardContainer 体系，CSS 变量集中管理（2026-07-05） |
| ADR-33 | config.ts 四向分裂 + tryCatchStatus 泛化 + slideRow 收束 | 已完成 — config.ts 分裂、tryCatchStatus 替换 13 处、slideRow 替换 5 处，tsc + vite build 通过（2026-07-05） |
| ADR-32 | 体积云渲染方案调查 | 已完成 — 调查完毕，结论：Babylon.js 无内置体积云，现有自定义 shader 保留（2026-07-05） |
| ADR-31 | 2026-07-05 会话清理 — 文档翻新 + AGENTS.md 瘦身 + 硬约束精简 | 已完成（2026-07-05） |
| ADR-30 | 小说目录按功能分类重组 | 已实现 — 小说素材目录按功能分类重组完成（2026-07-05） |
| ADR-29 | 物理设置界面重构 — 从布料单页到双系统分治 | 已实现 — XPBD 布料/WASM Bullet/碰撞开关统一入口（2026-07-05） |
| ADR-28 | 风场系统统一 — 从碎片化到集中治理 | 已实现 — wind-utils.ts 统一风向量 + 云/粒子/水面/布料四子系统联动（2026-07-05） |
| ADR-27 | 菜单响应式系统 — 控件自更新 + Proxy 自动触发 | 已实现 — Proxy 拦截 envState + 控件自更新机制 + scheduleRefresh 去抖（2026-07-05） |
| ADR-26 | 环境系统增强 — 纹理地面、粒子系统、粒子溅射、水下后处理联动 | 已完成 — Phase A 纹理地面 + Phase B 粒子系统+溅射 + Phase C 水下后处理全部完成（2026-07-04） |
| ADR-25 | 触屏交互优化与 ZIP 模型扫描通用化 | 已完成 — P0/P1/P2 全部实现（含双击聚焦、滑动返回、安全区适配）（2026-07-04） |
| ADR-24 | 渲染增强 Phase 2（精简版） | ✅ 部分完成 — SSR/ReflectionProbe/SSAO 已实施，SSS 阻塞未实施（2026-07-04） |
| ADR-22 | 预设治理 — 统一管理范围与分级架构 | 已实现 — 8 项改动全完成：EnvPreset 精简 + L2 环境预设扩展 + 用户预设快照迁移（2026-07-04） |
| ADR-21 | 程序化动作系统（Idle/Auto Dance + LipSync + 视线追踪） | 已完成 — Idle/AutoDance/LipSync/VPD/VMD-writer 5 套测试全通过（2026-07-03） |
| ADR-20 | 换装系统（服装变体/纹理替换） | 已完成 — Phase 8 完成，outfit.ts 加载/应用/重置 + 自动发现 + 序列化（2026-06-28） |
| ADR-19 | XPBD 布料模拟引擎选型与架构 | 已完成 — xpbd-solver/collider/cloth/renderer + 20 tests 全通过（2026-06-28） |
| ADR-18 | PathManager 平台抽象层 + 文件 I/O 审计 | 已完成 — PathManager 接口 + trustedRoots 修复 + copyDir 流式复制 + zipextract 句柄关闭修正（2026-07-04） |
| ADR-17 | Android 平台适配（精简版） | 主体已完成（Phase A/B/C ✅）；P0(A0-01/A0-02) 与 P1(A1-01~05) ✅ 全部已实施；P2 七项 ✅ 全部已落地（A2-04 于 2026-07-22 完成全路径 `toBlob` 迁移）；P3 四项 ✅ 全部已修复（A3-01/04 于 2026-07-22 完成事件总线消费）。唯一剩余：A0-01 采用 `MIXED_CONTENT_ALWAYS_ALLOW` 偏离推荐方案（技术债，建议收窄为 PathHandler 代理）。§四 SAF 目录选择方案已放弃，改用 `MANAGE_EXTERNAL_STORAGE` 授权 `/sdcard/MMD`（2026-07-22 核对）。 |
| ADR-16 | 视线追踪子系统架构 | 已完成 — 双路径方案已实施（WASM frontBuffer 直写 + JS linkedBone + updateWorldMatrix），手动计时方案（方案 A）为优化项，需上游 babylon-mmd 暴露 beforePhysics/afterPhysics API（2026-07-03） |
| ADR-15 | 材质编辑器 UI 重构 + 逐材质开关 | 已完成 — buildMatRootLevel/ListLevel/BatchLevel 三级面板 + _matEnabled 开关（2026-06-27） |
| ADR-14 | 模型加载预设库（角色设置快照） | 已完成 — 保存/加载/库管理/自动匹配/tryAutoApplyPreset 全部实现（2026-06-27） |
| ADR-13 | Skybox 贴图系统改进 | 已完成 — SelectEnvTextureFile binding + CubeTexture 统一加载 + 天空穹顶（2026-06-27） |
| ADR-12 | 云渲染改进 — Perlin 噪声 + 双分层 | 已完成 — env-clouds.ts Perlin FBM 噪声 + 双分层云 + 风漂移视差（2026-06-27） |
| ADR-11 | Wails v3 迁移评估与决策 | 已完成 — 已迁至 Wails v3，项目当前运行于 v3 构建管线（2026-07-03（初版），2026-07-（迁移完成）） |
| ADR-9 | 模型详情面板 — 运行时模型实例控制 | 已完成 — Phase 1-5 全部完成（动作绑定改为预设间接绑定）（2026-07-16） |
| ADR-6 | 扫描简化 + 文件名多编码自动检测 | 已完成 — bestDecode/cleanModelName + modelMetaCache 全链路上线（2026-07-16） |
| ADR-5 | 待修复项 — 已知技术债务 | 已完成 — #1 HTTP 目录隔离（IsolateModelDir）+ #2 HasThumb 扫描检测 + #3 失败进度条 auto-hide（2026-07-16） |
| ADR-4 | CSS 统一重构 + 弹窗单例模式 | 已完成 — CSS 变量体系 12 token + closeAllOverlays + 5 弹窗复用类统一（2026-07-16） |
| ADR-3 | 下载监听策略（精简版） | 方案 C 已实施 ✅；方案 E 远期构想 |
| ADR-2 | 配置写入分离 — writeConfig 轻写 vs writeConfigAndRescan 全量 | 已完成 — writeConfig 从 writeConfigAndRescan 拆出，SetBlenderPath 改用轻写（2026-07-16） |
| ADR-1 | 项目基础设施决策 | 已完成 — 5 条基础设施决策已定案。注意：foundation.md / fix-cycle.md / reusables.md 已于 ADR-039 删除，AGENTS.md 章节编号已在 ADR-031 重构后变更（2026-07-16） |

<!-- GEN:ADR_INDEX end -->

---

## Bug 记录

详见 git history。
