# ADR-031: 全量文档翻新 + 结构清理 + ADR 体系整饬 + DanceXR 差距挖掘 + AGENTS.md 瘦身

**日期**：2026-07-05
> **状态**: 已完成 — 30 条 ADR 全量状态标记 + 粒子溅射实现 + HTTP 隔离修复 + roadmap/status 翻新

---

## 背景

30 条 ADR 中大部分无状态标记，其他 AI 会话无法快速判断哪些已完成、哪些待做。同时存在多条技术债和过时文档。AGENTS.md 516 行过长，AI 读不完或读完后上下文被填满，导致决策质量下降。

## 决策

### 1. 全量 ADR 状态标记

给 30 个 ADR 文件头部统一追加 `> **状态**:` 行，格式一致，grep 可检索。

| 状态 | 数量 | 编号 |
|------|------|------|
| 已完成/已实现 | 25 | 001-002, 004-006, 008-009, 011-022, 025-030 |
| 部分完成 | 3 | 003（远期构想）, 023（SAF）, 024（SSS） |
| 参考文档 | 2 | 007, 010 |

### 2. 代码实现

**ADR-026 Phase B：粒子落地溅射**
- `env-particles.ts`：新增 `createSplashEmitter()` / `disposeSplash()` / `syncSplashState()` + splash 纹理
- `env-impl.ts`：新增 `splash` 状态管理 + 每帧同步
- `env-menu.ts`：粒子面板新增「落地溅射」开关
- 方案：视觉欺骗（ADR-026 B1），独立 GPUParticleSystem 地面随机位置脉冲触发

**ADR-005 #1：HTTP 目录隔离**
- `watch.go`：`ImportLocalFile` 对 .pmx/.vmd 调用 `IsolateModelDir`，外部文件 copy 到 temp_serve
- 隔离失败时降级到原目录（保功能不保隐私）

**ADR-025 / ADR-016：核验确认已实现**
- ADR-025 双击聚焦：`main.ts:422-429` 已实现
- ADR-016 视线追踪：WASM frontBuffer 直写 + JS linkedBone 双路径已实施，手动计时为优化项

### 3. 文档翻新

**`docs/roadmap.md`**：383 行 → ~130 行
- 砍掉重复已完成段落、旧 ASCII 时间线、空泛长期愿景
- 更新核心价值定位表（渲染调参/环境系统/换装已标 ✅）
- 重新排列 Phase 11+ 优先级

**`docs/status.md`**：794 行 → ~120 行
- 砍掉 200+ 行已实现清单、32 条 Bug 记录、200+ 行审查记录
- 更新 Phase 进度表（Phase 10 + 环境增强已完成）
- 保留键盘快捷键、环境依赖、构建命令、已知限制

### 4. ADR 状态更正

| ADR | 原状态 | 新状态 | 原因 |
|-----|--------|--------|------|
| 005 | 部分已修复 | 已完成 | #1 HTTP 隔离已实施 |
| 011 | 部分完成 | 已完成 | v3 已迁移（alpha2.105） |
| 014 | 部分完成 | 已完成 | 库 CRUD/自动匹配已实现 |
| 016 | 部分完成 | 已完成 | 双路径方案已实施 |
| 017 | 部分完成 | 已完成 | prompt() 全部替换 |
| 025 | 部分完成 | 已完成 | P0/P1/P2 全部实现 |
| 026 | 实施中 | 已完成 | Phase A+B+C 全部完成 |

### 5. AGENTS.md 重构 + 前端 AGENTS.md 新建

**根 AGENTS.md**：666 行 → 427 行（-36%）
- 删除 §四（多 AI 并发）/ §七（工作流）/ §八（会话边界）/ §九（子代理详情）
- §六（沟通风格）合并到 `docs/terminology.md` §九
- 提取为独立文件：`docs/workflow.md`、`docs/multi-ai.md`
- §一新增 `frontend/AGENTS.md` 条目、`audit-2026-06-30.md` 条目
- 7 处过时文件路径修复（`app.go`→`internal/app/app.go`、`pmx.go`→`internal/util/pmx.go`、`motion-dance-sets.ts`→`internal/app/dancesets.go` 等）

**`frontend/AGENTS.md`**：新建（138 行）
- 前端专用：构建命令/测试命令/TypeScript 约定/目录索引
- 消除根 AGENTS.md 的前端噪音

### 6. 深层文档审计（P1）

**`docs/architecture.md`**：21 处过时文件路径修复
- §10 目录树：6 个 `scene-*.ts` 文件名→当前子目录结构
- §11 模块依赖图：`camera.ts`→`scene/camera/camera.ts`、`audio.ts`→`outfit/audio.ts`、`fileservice.ts`→`core/fileservice.ts`
- §16.5 换装文件表：`scene.ts`→`outfit/outfit.ts`、`app.go`→`internal/app/app.go`（×3）
- 其余 §5.x/§13/§14/§17.2 等路径更新
- 验证：`go build` + `tsc --noEmit` 通过

**`docs/menu-architecture.md`**：删除已不存在的 `motion-dance-sets.ts` 条目

### 7. CI 自动检查

**新建 `tests/test_markdown_links.py`**：
- 白名单排除合法链接（外部 URL、HTML 标签、代码块）
- 验证 AGENTS.md/docs/ 内部 27 个 Markdown 链接全部有效
- 加入 `.github/workflows/ci.yml` config-syntax job

### 8. `motion/ → motion-algos/` 结构改名

**根本原因**：根级 `motion/`（算法层）与 `scene/motion/`（桥接层）命名冲突，导致 AI 重复放错文件。

```
改名：frontend/src/motion/ → frontend/src/motion-algos/
不动：scene/motion/（桥接层）、menus/motion-*.ts（UI 层）
```

**改动量**：14 个文件 import 更新 + 3 处文档同步，`tsc --noEmit` + `vite build` 通过。

**教训**：文档厚度与 AI 犯错概率正相关。目录名本身才是最强文档——`motion-algos/` 不需注释就能告诉 AI 该放什么。

### 9. `frontend/AGENTS.md` 目录标注增强

给三个易混淆目录加层标签：
- `motion-algos/` ← [算法层] 无 Babylon 依赖
- `scene/motion/` ← [桥接层] 调 motion-algos/ 算法
- `menus/motion-*.ts` ← [UI层] 动作菜单面板

同时：补录 `core/dialog.ts` / `core/reactivity.ts` / `core/wails-bindings.ts` 三个漏列文件，删除已不存在的"舞蹈套装"引用。

### 10. 风场广播注释

AGENTS.md §1.3 任务触发器索引新增：「风场 / windDirection / windSpeed」，标注 4 个消费方（env-water、env-particles、env-impl/env-clouds、xpbd-cloth），提示跨子系统广播。

`docs/reusables.md` TypeScript 区新增 `wind-utils.ts` 函数表（getWindVector / getWindStrength / isWindActive）＋广播警告。同步清理 2 个已不存在的 `scene-env.ts` / `scene-menus.ts` 引用。

### 11. `docs/roadmap.md` 翻新

383 行 → ~130 行
- 砍掉重复已实现段落、旧 ASCII 时间线、空泛长期愿景（插件市场/模型 marketplace/i18n 三语）
- 更新核心价值定位（渲染调参/环境系统/换装已标 ✅）
- 按 DanceXR 差距清单重排 Phase 11+ 优先级

### 12. `docs/status.md` 翻新

794 行 → ~120 行
- 砍掉 200+ 行已实现清单、32 条 ✅ Bug 记录、200+ 行审查记录
- 更新 Phase 进度表（Phase 10 + 环境增强已完成）、环境依赖版本、已知限制

### 13. DanceXR 功能差距挖掘

从 `docs/research/dancexr-zh/` 37 份文档中挖掘 25 个增量功能目标，按项目现有功能分区组织：

| 分区 | 新增目标数 | 代表功能 |
|------|-----------|---------|
| A. 动作与媒体 | 6 | Motion Layers、Lifelike Motions、Playback Modes、Remix、Motion Override、Catwalk |
| B. 角色呈现 | 3 | Eye Contact、Feet Adjustment、Auto Reset |
| C. 场景与编排 | 5 | Formation、Auto Camera、Concert Camera 增强、Mirror Prop、Scene Bundle |
| D. 渲染与外观 | 2 | Toon Shading、Mesh-to-Cloth |
| E. 物理扩展 | 2 | Soft Body、Ragdoll |
| F. 系统与工具 | 4 | Recording、Video Player、Accessory Attachment、Scene Relative Paths |

明确标注 4 个不适配项（AI Chat、Discovery App、Bone Mapper、Body Paint）。

### 14. Phase 11-13 规划写入

**`docs/roadmap.md`**：
- 流程图新增 Phase 11（动作组合与角色在场）/ Phase 12（场景导演与体验打磨）/ Phase 13（物理扩展与渲染增强）
- 新增「下一步规划」分近期/中期/远期三层，基于差距清单重排优先级
- 新增「DanceXR 功能差距清单」完整表格（A-F 六大块 25 项）

**`docs/status.md`**：
- Phase 进度总览表补充 Phase 11-13（📋 规划中/远期）

### 15. 文件职责边界明确化

**根因**：AGENTS.md 对 `status.md` 和 `roadmap.md` 的描述模糊（"项目现状" vs "路线图"），导致 AI 两边都写 Phase 进度表和 ADR 速查。

**修复**：
- `status.md` 标注为「只读快照」：Phase 进度 + 快捷键 + 环境依赖 + 构建命令 + 已知限制
- `roadmap.md` 标注为「规划文档（可写）」：DanceXR 对标 + 差距清单 + 下一步 + ADR 速查
- `status.md` 删除重复的 ADR 速查和 Phase 11-13 规划条目
- 两个文件顶部加互引标注

### 16. AGENTS.md 瘦身 516→106 行（-79%）

**砍掉的**：
- 函数映射表（140行）→ 移入 `docs/function-map.md`（新建）
- 任务触发索引（40行）→ 合并到「按任务跳转」表
- 前端完整目录树（80行）→ 只保留一级目录 + 指向 `frontend/AGENTS.md`
- 启动约束块（12行）→ 合并到硬约束
- 工作流规则（30行）→ 指向 `docs/workflow.md`
- docs/ 完整目录树（30行）→ 合并到文件职责表
- 审计/沟通/多AI/环境节（15行）→ 4 行交叉引用

**保留的信号**：
- 7 条硬约束（否定句，信号最强）
- 文件职责表（18行，含可写标记）
- 按任务跳转表（9行）
- 仓库结构 + 前端目录（精简版）
- 技术栈 + 构建命令

**教训**：文档厚度与 AI 犯错概率正相关。AGENTS.md 的函数映射表是上下文污染的元凶——AI 读了 200 行函数列表后，以为找到了"新功能入口"，没去确认实际目录结构。短文档在关键决策点给出更强信号。

### 17. `docs/function-map.md` 新建

从 AGENTS.md 提取的 140 行函数映射表，独立为按需 grep 文件。AGENTS.md 只需一行索引：`函数定位 → docs/function-map.md`。

## 影响

- 其他 AI 会话启动时 grep `docs/adr/` 即可掌握全局进展
- 剩余可做项仅 3 条：003（远期构想）、023（SAF Spike）、024（SSS 上游阻塞）
- 文档体积缩减 ~85%（核心三文件 1843→324 行），信息密度大幅提升
- `motion-algos/` 结构改名永久消除 AI 放错目录的根源
- CI stale-link 检查防止未来断链
- Phase 11-13 规划为后续开发提供明确方向（25 个增量目标，按优先级分层）
- 文件职责边界明确化防止 AI 重复更新同一内容
