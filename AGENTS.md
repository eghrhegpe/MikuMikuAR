# MikuMikuAR — AI 入口

> TypeScript/Babylon.js 项目。回复简洁精准。
> 本文件定义读什么、不读什么。深水区信息按地图跳转，禁止自由探索。

## 硬约束

1. **禁止递归扫描 `docs/`** — 只读地图列出的文件
2. **禁止全量读 `docs/research/`** — 允许 grep 搜索，读取需用户确认或任务明确涉及
3. **大文件 (>500 行) 先 grep 再读** — 不要一次读完整个大文件，先定位再读匹配段落
4. **改代码后立即 build** — 不攒修改；改文档/markdown 不需要 build
5. **写新函数前查 `docs/reusables.md`** — 已有不重复
6. **Markdown 链接写完确认目标存在** — 断链 = 下一个 AI 被误导

## AI 高频犯错区（tracker 数据驱动）

| 区域 | fix 数 | 最长连续链 | 教训 |
|------|--------|-----------|------|
| **env 天空 shader** | 31 | 16 次 | Babylon.js ShaderMaterial 生命周期极复杂：先创建新材质 → 再 dispose 旧材质 → 避免 GL program-ID 复用冲突。**禁止**直接替换 material，必须走 `forceCompilationAsync` |
| **CI/构建** | 24 | 9 次 | Wails v3 构建参数与 v2 不兼容，改构建脚本前先读 `Taskfile.yml` |
| **library-core.ts** | 6 | - | 路径迁移后旧字段易残留，改 library 逻辑前先 grep `resource_root` vs `library_root` |

## 文件职责

| 文件 | 角色 | 可写 |
|------|------|------|
| `docs/status.md` | 只读快照：Phase 进度 + 快捷键 + 环境依赖 + 构建命令 + 已知限制 | ❌ |
| `docs/roadmap.md` | 规划文档：DanceXR 对标 + 差距清单 + 下一步 + ADR 速查 | ✅ |
| `docs/architecture.md` | 架构方案（Wails/PMX/VMD/纹理/zip/环境/材质/序列化） | ❌ |
| `docs/requirements.md` | 需求 + 技术选型决策 | ❌ |
| `docs/foundation.md` | 项目地基 — AI 不可修改 | ❌ |
| `docs/menu-architecture.md` | MenuStack 用法 + 添加新菜单项流程 | ❌ |
| `docs/design.md` | UI 组件规范（lcard/cs-row/preset-chip/折叠/分区） | ❌ |
| `docs/reusables.md` | 复用函数索引 — 写代码前必查 | ❌ |
| `docs/terminology.md` | 代码级命名规范 + 沟通风格 | ❌ |
| `docs/troubleshooting.md` | 故障排查 | ❌ |
| `docs/workflow.md` | 环境约定 + 会话边界 + 失败熔断 | ❌ |
| `docs/multi-ai.md` | 多 AI 并发约束 | ❌ |
| `docs/function-map.md` | 函数映射表（按需 grep，不全读） | ❌ |
| `docs/competitive-analysis.md` | 竞品分析报告（20+ GitHub 项目对标） | ❌ |
| `docs/fix-cycle.md` | Bug 修复流程模板 | ❌ |
| `docs/outfits-spec.md` | 换装系统用户文档 | ❌ |
| `frontend/AGENTS.md` | 前端子包专用（构建/测试/TS 约定/目录索引） | ❌ |
| `docs/adr/` | 决策记录（30 条） | ❌ |
| `docs/research/` | 调研归档 — **默认不读** | ❌ |

## 按任务跳转

| 任务 | 读什么 |
|------|--------|
| 接新任务 | `status.md` → `roadmap.md` |
| 改前端 | `frontend/AGENTS.md` → 子模块 |
| 改 Go | `architecture.md` → `internal/app/app.go` |
| 找函数 | `docs/function-map.md`（grep，不全读） |
| 加菜单项 | `docs/menu-architecture.md` |
| UI 组件 | `docs/design.md` |
| 复用函数 | `docs/reusables.md`（grep） |
| 修 Bug | `docs/troubleshooting.md` → `docs/fix-cycle.md` |
| 多 AI 并发 | `docs/multi-ai.md` |
| 竞品对标 | `docs/competitive-analysis.md` |

## 仓库结构

```
仓库根
├── internal/app/     # Go 后端（app.go / dancesets.go）
├── main.go           # Wails 入口
├── frontend/         # Vite + TS + Babylon.js → 详见 frontend/AGENTS.md
├── docs/             # 项目文档（需求/架构/状态/ADR/调研）
└── build/            # Wails 构建配置
```

## 前端目录（精简）

```
frontend/src/
├── core/         # 基础设施
│   ├── main.ts          # ★ 应用入口（事件绑定 + 快捷键 + 初始化）
│   ├── config.ts        # barrel re-export（→ types/state/dom/utils）
│   ├── types.ts         # 类型定义（ModelInstance/EnvState/UIState 等）
│   ├── state.ts         # 可变全局状态 + setter（envState/uiState/focusedModelId 等）
│   ├── dom.ts           # DOM 元素引用（#statusBar/#fpsClock 等）
│   ├── utils.ts         # 工具函数（setStatus/showHint/formatTime 等）
│   ├── fileservice.ts   # resolveFileUrl 统一文件 URL 解析
│   ├── dialog.ts        # prompt/confirm 对话框封装
│   ├── reactivity.ts    # 状态订阅机制（subscribe/notify）
│   ├── shortcut-registry.ts # 快捷键注册表
│   ├── icons.ts         # Iconify 图标创建
│   ├── iconify-registry.ts  # 本地图标注册表
│   ├── ui-helpers.ts    # DOM 构建工具（slideRow / addToggleRow 等）
│   ├── ui-rows.ts       # 行类型渲染（folder/action/slider/toggle/modeSlider）
│   ├── ui-slide-row.ts  # SlideMenu 行组件
│   ├── ui-collapsible.ts # 折叠面板组件
│   ├── ui-advanced-rows.ts # 高级行组件（colorSlider 等）
│   ├── ui-types.ts      # UI 类型定义
│   └── wails-bindings.ts # Wails Go binding 类型
├── scene/
│   ├── scene.ts              # ★ 场景编排入口（初始化 + 模型加载 + VMD + 程序化动作）
│   ├── scene-serialize.ts    # 场景序列化/反序列化（.mmascene）
│   ├── scene-bundle.ts       # 场景打包（export）
│   ├── camera/               # 相机模式（orbit/freefly/oneshot/concert）
│   ├── motion/               # VMD 加载/播放/LipSync 桥接
│   ├── manager/              # ModelManager + 材质系统 + 模型操作
│   ├── env/                  # 天空/水面/云/粒子/道具/光照联动
│   └── render/               # 渲染管线 + 灯光 + 性能降级
├── menus/        # 菜单系统
│   ├── menu.ts               # SlideMenu 导航栈（push/pop/reRender/updateControls）
│   ├── menu-factory.ts       # registerPopupMenu 工厂
│   ├── library*.ts           # 模型库（扫描/搜索/层级/标签）
│   ├── model-*.ts            # 模型详情/材质/预设
│   ├── env-*.ts              # 环境菜单（天空/水面/风/云/预设）
│   ├── scene-*.ts            # 场景菜单（渲染/舞台/道具/灯光/物理）
│   ├── motion-*.ts           # 动作菜单（动作绑定/相机/程序化/布料）
│   └── settings*.ts          # 设置页（UI 主题 / 外部库 / 软件管理）
├── motion-algos/ # procedural-motion, vmd-writer, vpd-parser, beat-detector, lipsync
├── outfit/       # outfit.ts + audio.ts
├── physics/      # xpbd-solver/cloth/collider/renderer + cloth-manager
└── app.css       # CSS 变量体系
```

## 技术栈

| 层 | 选型 |
|----|------|
| 桌面 | Wails v3 (Go + WebView2) |
| 前端 | Vite + TypeScript |
| 3D | Babylon.js + babylon-mmd |
| 物理 | XPBD (TS) + WASM Bullet |
| 存储 | zip 原档 + 惰性 cache |

## 构建

```bash
go build ./...                    # Go
cd frontend && npm run build      # 前端
cd frontend && npm run test       # 测试
```

## 其他入口

- 多 AI 并发约束 → `docs/multi-ai.md`
- 环境约定 + 会话边界 → `docs/workflow.md`
- 沟通风格 → `docs/terminology.md` §九
- 审计记录 → `docs/audit-2026-06-30.md`
