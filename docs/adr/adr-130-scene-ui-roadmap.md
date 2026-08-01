# ADR-130: 场景 UI 整体设计与前后端发展方向路线图

> **日期**: 2026-07-18
> **状态**: 规划中（Phase 1 技术债 ✅1.1 已完成（实质达成，载体 ADR-138 + env 子系统大拆分；env-impl.ts 227 行、edgeFade 纹理独立接入 dispose、循环依赖破除、env 子系统 8 个测试文件 70+ it），✅1.2 已完成（popUndoSnapshot 已实现 + Ctrl+Z + 菜单撤销按钮接入 + 测试覆盖），✅1.3 已完成（ADR-128 首部 2026-07-20 标注 5 语种无残留）；Phase 2 ✅2.1/2.2/2.3/2.4/2.5 已完成，✅2.6 已完成（2026-07-27 核对确认：撤销保护已全覆盖——卸载舞台 scene-stage-levels.ts:188-196 + 卸载道具 scene-stage-levels.ts:247-259 + 加载列表统一组件 scene-prop-levels.ts 已接入 offerSceneUndo，共 10 处破坏性操作均有 pushUndoSnapshot + offerSceneUndo/AndRefresh；异步操作反馈统一用 feedbackStatus/feedbackInfo/feedbackError，覆盖 env-preset-levels.ts、library-setup.ts 等关键路径），✅2.7 已完成（ADR-176 收口传输/存储层统一；环境预设导入/导出已闭合；新增 core/preset-meta.ts 读侧 PresetMeta 信封 + listPresets() 归一，单元测试覆盖；写侧信封化待需求驱动）；Phase 3 能力扩展：3.1 ✅ 已完成（2026-08-01 扫尾 2 处手写空状态：scene-stage-levels 舞台空状态与 model-material 材质空状态统一接入 addEmptyRow（含新增 hint 双行参数）；scene-prop-levels 处已随 ADR-215 删除道具菜单而不复存在）、3.2 ✅ 已完成、3.3 ✅ 已完成（打包/解包；env preset + URL 分享待需求驱动）、3.4 ✅ 已完成（ADR-017）、3.5 📋 已记录（ADR-054：PBR/SSS 上游阻塞，其余待需求驱动）；ADR-093 P3 已关闭（2026-07-27 裁定非死代码））

## 背景

2026-07-18 完成场景菜单布局审核与 8 项修复（ADR-128 镜面重命名、死代码清理、i18n 抽 key、ADR-111 修订、CTA 上提、灯光列表组件化等）。修复过程中发现：场景子系统虽功能完备（16 条相关 ADR 多数已闭合），但存在结构性技术债与方向性待决策项，需一份路线图统一指引前后端后续发展，避免局部修复导致整体失衡。

本 ADR 是**路线图性质**，不是单一功能决策。各 Phase 落地时建议拆分为独立子 ADR。

## 现状基线

### 已闭合的能力（勿重复造轮子）

| 能力 | ADR | 备注 |
|------|-----|------|
| 场景序列化 v1 + .mmascene bundle + UUID 持久化 | ADR-037 | SceneFile v1，500ms 防抖自动保存 |
| 环境预设分类化 v3 | ADR-120 | sky/ground/water/atmosphere 4 类，v2 自动迁移 |
| 场景破坏性撤销 | ADR-127 | Memento 快照栈，UNDO_LIMIT=5，toast 8s |
| 菜单声明式 Schema | ADR-093 | P0+P1+P2 完成，57 面板迁移 |
| 地面/水面/反射统一 | ADR-091/092/114 | canvas + StandardMaterial 单一路径 |
| 镜面道具化 | ADR-128 | debugMirror → mirror 重命名 |
| 体积云延展地平线 | ADR-113 | Phase A-D 全落地 |
| 风格化水体 | ADR-115 | P1-P4 全阶段 |

### 场景菜单当前结构

```
场景菜单（根级）
├─ 灯光（stageLight）              ← ADR-111 修订：从舞台 folder 提至根级
├─ 舞台（stage）
│  ├─ 功能入口（加载舞台/道具）    ← ADR-130 前置修复：CTA 上提
│  ├─ 已加载舞台列表
│  ├─ 已加载道具列表
│  ├─ 地面（ground）
│  ├─ 水面（water）
│  └─ 镜面（mirror）
├─ 阵形（formation）              ← 多模型时显示
├─ 物理（physics）
├─ 渲染预设（renderPresets）
└─ 高级（archive）                ← 仅含预设场景 + 保存场景 2 项
```

### 已识别技术债

| 优先级 | 来源 | 问题 | 状态 |
|--------|------|------|------|
| 🔴 P1 | audit round-3-facade-terrain | `env-impl.ts` 1065 行无直接单测 + `_edgeFadeTexCache` 无 dispose（~25MB 泄漏上限）+ env-impl ↔ env-water 循环依赖 | ✅ 已解决（Phase 1.1，载体 ADR-138 + env 子系统大拆分） |
| 🟠 P2 | audit water-reflection-boundary | 水面 RT 分辨率 high=512（建议 1024） | ✅ 已超出建议（env-water.ts:148 当前 high=2048, medium=1024, low=512） |
| 🟠 P2 | ADR-127 | `_undoStack`/`canUndo` 死代码遗留（栈只 push 不 pop） | ✅ 已解决（Phase 1.2，`popUndoSnapshot` 已实现 + Ctrl+Z + 撤销按钮接入 + 测试覆盖） |
| 🟡 P3 | ADR-093 | P3 收尾（移除死 builder、删除 barrel re-export） | ✅ 已关闭（2026-07-27 裁定：`library.ts`/`library-core.ts` barrel re-export 被 5 处活跃消费者依赖，非死代码，无需移除；全量类型化由 ADR-190 声明式收口自然完成） |
| 🟡 P3 | ADR-120 | 分类预设导入/导出待定；待真机验证 | ✅ 导入/导出已完成（env-lighting.ts:308-325 `exportCategorizedEnvPreset`/`importCategorizedEnvPreset` + env-lighting.test.ts 往返/v2 兼容/异常测试）；⚠️ 真机验证仍待推进 |
| 🟡 P3 | audit env-review-triage | 3 处 `createCanvasTexture` 直调绕过缓存 | ✅ 已不构成问题（4 处直调均有合理设计理由：env-particles 模块自管缓存、env-water 单实例+safeDispose、env-ground `_updateGroundTexture` dispose-then-replace 模式） |
| 🟡 P3 | env-bridge.ts:421/543/700/716 | `SetEnvState({ ...envState })` 全量覆盖，无 partial update | ✅ 已解决（Phase 2.4，双端 partial update：前端 env-bridge.ts:589 Proxy 局部更新 + Go config.go:277 JSON merge） |

## 决策

### Phase 1：技术债清欠（P1）

**目标**：消除 env-impl 单测缺失与资源泄漏风险。

#### 1.1 env-impl Facade 拆分 + 单测

- 拆 `env-impl.ts` 为 `env-facade.ts`（纯组装，<300 行）+ `env-terrain-cache.ts`（`_edgeFadeTexCache` 独立模块，含 dispose）
- 补 env-facade 单测：mock 子系统，验证 `_applyEnvStateFacade` 的 changed 集合计算正确性
- 破除 env-impl ↔ env-water 循环依赖：env-water 通过 env-facade 接口调用，不直接 import env-impl

#### 1.2 ADR-127 死代码处理

`_undoStack`/`canUndo` 二选一：
- **选项 A**（推荐）：接 UI，根级加撤销按钮 + Ctrl+Z 快捷键，与 toast 互补
- **选项 B**：删除，toast 已够用

#### 1.3 ADR-128 镜面重命名收尾验证

- 旧 scene preset / config.json 含 `debugMirrorEnabled` 字段加载测试
- 5 语种 UI 显示「镜面」而非「调试镜面」真机验证

### Phase 2：结构化治理（P2）

**目标**：状态链路单一源 + 迁移机制可维护 + 性能降级统一。

#### 2.1 EnvState 单一源 schema

- 新建 `env-state-schema.ts`，types.ts/state.ts 从 schema 派生
- Go EnvState 字段用 codegen 或契约测试对齐（扩展 `app.contract.test.ts` 到字段级）
- Go EnvState 按 sky/ground/water/atmosphere 分组（struct embedding 或注释分组）

#### 2.2 迁移函数注册表化

当前 `migrateEnvState` 是 if-else 堆叠（groundMode + debugMirrorEnabled），难维护。改为：

```typescript
type Migrator = (raw: Record<string, unknown>, out: Record<string, unknown>) => void;
const migrators: Migrator[] = [
    migrateGroundMode,
    migrateDebugMirror,
    migrateLipSync,
    migratePerception,
    // 未来新增迁移在此注册
];
```

- `migrateEnvState` + `migrateLipSyncFromOldState` + `migratePerceptionFromProcMotion` 统一为注册表
- SceneFile version 1 → 2 迁移注册：合并所有字段级迁移

#### 2.3 性能降级策略统一

- 抽 `qualityProfile`（high/medium/low）统一管理水面/云/粒子/反射 RT 分辨率
- 接入 ADR-118 刷新率感知降级：FPS < 30 自动降一档
- 水面 RT 分辨率按 qualityProfile 动态调整（high=1024, medium=512, low=256）

#### 2.4 SetEnvState partial update

当前 `SetEnvState({ ...envState })` 全量覆盖 60+ 字段。改为 Go 簇新支持 partial：

- Go 端 `SetEnvState` 改为接收 `map[string]any` 或 `*EnvState + field mask`
- 前端 `setEnvState` 仅传 changed 字段
- 兼容旧调用：全量传时等价于当前行为

#### 2.5 菜单结构扁平化

- 「高级」folder 拆解：预设场景 + 保存场景提到根级 divider 后，去掉中间层（导航深度 -1）
- 「渲染预设」留场景（场景级快照），「环境预设」留环境（环境级快照），明确归属

#### 2.6 交互模式统一

- 已加载舞台/道具列表统一用 `addPresetChip` 或新增 `addListItemRow`（图标 + 名称 + 详情入口 + 删除按钮）
- 所有破坏性操作（卸载模型/舞台/道具、清除 VMD、删除图层）接入 ADR-127 撤销 toast
- 异步操作（加载舞台/道具/预设）强制状态反馈（loading → done/error）

#### 2.7 预设系统统一 API

- ⚠️ 原「抽 `PresetManager` 统一接口（`List/Save/Load/Delete/Import/Export`）」**撤回**：ADR-176 已落地 `BackendService` + `resolveBackend()` 代理，传输层与存储层本就统一（四类预设共 `presets` IndexedDB store，键前缀 `env:/render:/scene:/model:`），再抽 Manager 反而丢失类型安全，属为抽象而抽象。
- 环境预设导入/导出：**已完成**（ADR-120 已闭合，非本 Phase 缺口）。
- 元数据统一（Name/Label/Category/CreatedAt/Tags）：**读侧归一已落地** —— 新增 `frontend/src/core/preset-meta.ts`，定义 `PresetMeta` 信封 + `listPresets(category?)`（包裹 4 个 list 函数归一为 `PresetMeta[]`，对 Go nullable 返回做 `?? []` 守卫），配套单元测试覆盖。写侧信封化（`{meta,data}`）保持各系统独立写路径，待确有跨类浏览器 / 标签筛选需求时再做。

### Phase 3：能力扩展（P3）

**目标**：体验打磨 + 竞品差距闭合。

#### 3.1 空状态与首次引导

- ✅ 统一空状态组件：`addEmptyRow` 已存在于 `ui-rows.ts:319`（2026-08-01 新增可选 hint 参数支持双行引导），`model-detail` / `motion-binding-ui` / `motion-override-levels` / `motion-pose-levels` 共 6 处已接入；2026-08-01 扫尾：`scene-stage-levels.ts`（原 211-216 手写 innerHTML → addEmptyRow 双行）、`model-material.ts`（原 246-248 手写 `empty-hint` → addEmptyRow 单行）已统一；原 `scene-prop-levels.ts:24-27` 随 ADR-215 删除道具菜单而不复存在
- 首次使用引导：`library.firstUseHint` 已在 4 语种就绪，`library-setup.ts` 3 处反馈调用；`firstUseScene` 标志不存在

#### 3.2 视觉系统一致性

- ✅ 全仓 `style.color` / `style.background` 已全部使用 `var(--xxx)` 变量（`--accent`/`--hover`/`--warn`/`--danger`/`--success`），无裸值。剩余 inline 均为 `display`/`padding`/`marginLeft` 等动态交互行为，非 CSS 变量迁移范畴
- 卡片头部（cardContainer）统一样式规范，写进 docs/design.md
- 折叠组 `addCollapsible` 的 defaultOpen 策略统一：核心参数 ≤8 项默认展开，高级参数默认折叠

#### 3.3 Scene Bundle 增强

- ✅ Bundle 打包/解包全链路已实现（ADR-037 + ADR-054）：`scene-bundle.ts` `exportSceneBundle()` + `importSceneBundle()` + Go `BundleScene` + `ExtractZip` + 5 语言 i18n + UI 入口
- Bundle 含 env preset（决策岔路 4，倾向 A，待需求驱动）
- URL 场景分享（CDN 上传 + URL 拉取）：待需求驱动

#### 3.4 Android localStorage 容量治理

- ✅ 自动保存优先用 Go 端文件系统（`SaveLastScene`），前端 localStorage 仅作 fallback：**已完成**（ADR-017 确认：场景持久化唯一走 `SaveLastScene(json)` 写入 `last_scene.json`，localStorage 仅存 i18n 语言、dragMode 等小数据，5MB 配额风险已消除）
- 大场景检测：序列化后 > 4MB 时警告 + 建议保存为 .mmascene 文件

#### 3.5 竞品差距闭合

按优先级，均已写入 ADR-054 待后续决策：
- BVH 导入/导出（动作来源扩展）：决策岔路 5，倾向 A，待需求驱动
- PBR / SSS / RT 材质：**上游阻塞**（babylon-mmd），ADR-054 已记录，策略为等/推动上游贡献
- Lua / JS 脚本：ADR-054 已记录，远期
- Alembic / glTF 导出：ADR-054 已记录，远期

## 优先级总览

| Phase | 优先级 | 工作量 | 依赖 | 状态 |
|-------|--------|--------|------|------|
| Phase 1.1 env-impl 拆分 + 单测 | P1 | 中 | 无 | ✅ 完成（实质达成：env-impl.ts 227 行、edgeFade 纹理已独立并接入 dispose、循环依赖通过 ADR-138 破除、env 子系统 8 个测试文件 70+ it。形式上未改名 env-facade.ts / 未单独建 env-terrain-cache.ts，但 P1 风险已全部消除） |
| Phase 1.2 ADR-127 死代码处理 | P1 | 小 | 决策岔路 1 | ✅ 完成（采纳选项 A：`popUndoSnapshot` 已实现 + Ctrl+Z 快捷键接入 + scene-menu/scene-render-levels 撤销按钮接入 + scene-serialize-undo.test.ts 测试覆盖） |
| Phase 1.3 ADR-128 验证 | P1 | 小 | ADR-128 已完成 | ✅ 完成（ADR-128 首部 2026-07-20 标注：全部 debugMirror 重命名已迁移，i18n 5 语种无残留） |
| Phase 2.1 EnvState 单一源 | P2 | 大 | 无 | ✅ 完成（ADR-137，schema 派生 + Go 字段补齐） |
| Phase 2.2 迁移注册表化 | P2 | 中 | 无 | ✅ 完成（scene-serialize.ts 注册表化） |
| Phase 2.3 性能降级统一 | P2 | 中 | ADR-118 | ✅ 完成（qualityProfile 全链路 + Go 已补齐） |
| Phase 2.4 SetEnvState partial | P2 | 中 | Phase 2.1 | ✅ 已完成（2026-07-25，双端实现：前端 env-bridge.ts:589 Proxy 局部更新 + Go config.go:277 JSON merge；无需 `map[string]any`/field mask） |
| Phase 2.5 菜单扁平化 | P2 | 小 | 决策岔路 3 | ✅ 完成（「高级」folder 已拆解，预设场景/镜像/撤销/保存场景提至根级，scene-menu.ts:257 注释标注；渲染预设留场景、环境预设留环境归属明确） |
| Phase 2.6 交互模式统一 | P2 | 中 | 无 | ✅ 已完成（2026-07-27 核对：10 处破坏性操作全量接入 pushUndoSnapshot + offerSceneUndo/AndRefresh；异步反馈统一用 feedbackStatus/Info/Error） |
| Phase 2.7 预设系统统一 | P2 | 大 | 决策岔路 2 | ✅ 已完成（ADR-176 收口传输/存储层统一；环境预设导入/导出已闭合；新增 `core/preset-meta.ts` 读侧 `PresetMeta` 信封 + `listPresets()` 归一，单元测试覆盖；写侧信封化待需求驱动） |
| Phase 3.1 空状态组件 | P3 | 小 | 无 | ✅ 已完成（2026-08-01 扫尾：`addEmptyRow` 新增可选 hint 参数；scene-stage-levels 舞台空状态 + model-material 材质空状态统一接入；scene-prop-levels 处随 ADR-215 删除道具菜单而不复存在） |
| Phase 3.2 CSS 变量迁移 | P3 | 小 | 无 | ✅ 已完成（`style.color`/`background` 已全部 `var(--xxx)`，剩余 inline 均为动态交互） |
| Phase 3.3 Scene Bundle 增强 | P3 | 小 | ADR-037 | ✅ 已完成（打包/解包全链路；env preset + URL 分享待需求驱动） |
| Phase 3.4 localStorage 治理 | P3 | 小 | ADR-017 | ✅ 已完成（`SaveLastScene(json)` 文件持久化，localStorage 仅存小数据） |
| Phase 3.5 竞品差距 | P3 | 大 | 上游 | 📋 已记录（ADR-054：PBR/SSS 上游阻塞，BVH/脚本/glTF 待需求驱动） |

## 需决策的岔路

| # | 决策点 | 选项 A | 选项 B | 倾向 |
|---|--------|--------|--------|------|
| 1 | ADR-127 `_undoStack` 死代码 | 接 UI（撤销按钮 + Ctrl+Z） | 删除（toast 已够） | A |
| 2 | ADR-120 分类预设导入/导出 | 做（统一预设系统一部分） | 不做（用户手动复制文件） | A |
| 3 | 「高级」folder | 拆掉（2 项提根级） | 保留（未来扩展） | A |
| 4 | Scene Bundle 含 env preset | 做（一键分享完整） | 不做（bundle 只管资源） | A |
| 5 | 竞品差距优先级 | BVH 导入（动作来源扩展） | PBR/SSS（渲染质量） | A |

决策方式：用户在此 ADR 评审时指定，或各 Phase 拆分子 ADR 时再定。

## 验收标准

本路线图 ADR 的验收标准是"被引用"——后续子 ADR 在背景章节引用本 ADR 的 Phase 编号即可，无需独立代码验证。

各 Phase 落地后的验收标准在子 ADR 中定义。

## 相关文档

- ADR-093 — 菜单声明式 Schema（P3 已关闭，2026-07-27 裁定非死代码）
- ADR-111 — 场景/环境菜单重划分（已修订：灯光提到根级）
- ADR-115 — 风格化水体（P1-P4 已完成）
- ADR-118 — 刷新率感知自动降级（Phase 2 待推进）
- ADR-120 — 环境预设分类化（Phase 1 完成，导入/导出待定）
- ADR-127 — 场景破坏性撤销（死代码待处理）
- ADR-128 — 镜面道具化重命名（刚完成）
- ADR-137 — EnvState 单一源 Schema（Phase 2.1 子 ADR）
- docs/audit/round-3-facade-terrain.md — env-impl 审计报告
- docs/audit/water-reflection-boundary-audit.md — 水面反射边界审计
- docs/competitive-analysis.md — 竞品参考
