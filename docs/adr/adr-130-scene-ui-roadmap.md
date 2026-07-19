# ADR-130: 场景 UI 整体设计与前后端发展方向路线图

**日期**: 2026-07-18
> **状态**: 规划（Phase 2.1/2.2/2.3 已完成）中

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

| 优先级 | 来源 | 问题 |
|--------|------|------|
| 🔴 P1 | audit round-3-facade-terrain | `env-impl.ts` 1065 行无直接单测 + `_edgeFadeTexCache` 无 dispose（~25MB 泄漏上限）+ env-impl ↔ env-water 循环依赖 |
| 🟠 P2 | audit water-reflection-boundary | 水面 RT 分辨率 high=512（建议 1024） |
| 🟠 P2 | ADR-127 | `_undoStack`/`canUndo` 死代码遗留（栈只 push 不 pop） |
| 🟡 P3 | ADR-093 | P3 收尾待推进 |
| 🟡 P3 | ADR-120 | 分类预设导入/导出待定；待真机验证 |
| 🟡 P3 | audit env-review-triage | 3 处 `createCanvasTexture` 直调绕过缓存 |
| 🟡 P3 | env-bridge.ts:421/543/700/716 | `SetEnvState({ ...envState })` 全量覆盖，无 partial update |

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

- 抽 `PresetManager` 统一接口：`List/Save/Load/Delete/Import/Export`
- 环境预设补导入/导出（ADR-120 未解决问题）
- 预设元数据统一：Name/Label/Category/CreatedAt/Tags

### Phase 3：能力扩展（P3）

**目标**：体验打磨 + 竞品差距闭合。

#### 3.1 空状态与首次引导

- 统一空状态组件 `addEmptyState(icon, message, ctaText?, onCta?)`
- 全仓 grep `empty-hint` class，迁移到统一组件
- 首次使用引导：检测 `uiState.firstUseScene` 标志，高亮关键入口

#### 3.2 视觉系统一致性

- 全仓 grep `style.background` / `style.color` inline 赋值，迁移到 CSS 变量
- 卡片头部（cardContainer）统一样式规范，写进 docs/design.md
- 折叠组 `addCollapsible` 的 defaultOpen 策略统一：核心参数 ≤8 项默认展开，高级参数默认折叠

#### 3.3 Scene Bundle 增强

- Bundle 扩展包含 env preset（可选），实现"场景一键分享"
- Bundle manifest 加版本号，支持向后兼容
- 考虑 URL 场景分享（竞品差距）：bundle 上传 CDN + URL 拉取

#### 3.4 Android localStorage 容量治理

- 自动保存优先用 Go 端文件系统（`SaveLastScene`），前端 localStorage 仅作 fallback
- 大场景检测：序列化后 > 4MB 时警告 + 建议保存为 .mmascene 文件

#### 3.5 竞品差距闭合

按优先级：
- BVH 导入/导出（动作来源扩展）
- PBR / SSS / RT 材质（渲染质量，部分依赖 babylon-mmd 上游）
- Lua / JS 脚本（高级用户扩展）
- Alembic / glTF 导出（工业流水线互通）

## 优先级总览

| Phase | 优先级 | 工作量 | 依赖 | 状态 |
|-------|--------|--------|------|------|
| Phase 1.1 env-impl 拆分 + 单测 | P1 | 中 | 无 | 待推进 |
| Phase 1.2 ADR-127 死代码处理 | P1 | 小 | 决策岔路 1 | 待推进 |
| Phase 1.3 ADR-128 验证 | P1 | 小 | ADR-128 已完成 | 待推进 |
| Phase 2.1 EnvState 单一源 | P2 | 大 | 无 | ✅ 完成（ADR-137，schema 派生 + Go 字段补齐） |
| Phase 2.2 迁移注册表化 | P2 | 中 | 无 | ✅ 完成（scene-serialize.ts 注册表化） |
| Phase 2.3 性能降级统一 | P2 | 中 | ADR-118 | ✅ 完成（qualityProfile 全链路 + Go 已补齐） |
| Phase 2.4 SetEnvState partial | P2 | 中 | Phase 2.1 | 待推进 |
| Phase 2.5 菜单扁平化 | P2 | 小 | 决策岔路 3 | 待推进 |
| Phase 2.6 交互模式统一 | P2 | 中 | 无 | 待推进 |
| Phase 2.7 预设系统统一 | P2 | 大 | 决策岔路 2 | 待推进 |
| Phase 3.1-3.5 能力扩展 | P3 | 大 | Phase 2 完成 | 待推进 |

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

- ADR-093 — 菜单声明式 Schema（P3 收尾待推进）
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
