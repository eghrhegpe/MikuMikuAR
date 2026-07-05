# ADR-030: 小说目录按功能分类重组

> **状态**: 已实现 — 小说素材目录按功能分类重组完成
> **日期**: 2026-07-05
> **关联**: README.md, SKELETON.md

---

## 0. 问题陈述

`novel/` 目录下直接平铺了 11 个 `vol-N-name/` 卷目录，加上 `appendix/`、`sisyphus-stories/`、`README.md`、`SKELETON.md`，共 15 个顶层条目。

| 问题 | 表现 |
|------|------|
| **AI 无法通过路径判断内容** | `vol-3-upper/` 和 `vol-3-lower/` 看起来像连续编号，但实际属于 UI 重构主题；`vol-2-expansion/` 是依赖管理而非"扩展"。AI 扫描文件树时只能看到编号，无法快速定位功能相关的章节 |
| **查找特定主题需要搜索全文** | 想找"所有物理相关章节"必须遍历 11 个卷的 README 索引，无法通过目录结构一眼锁定 |
| **顶层条目过多** | 11 个 vol + 2 个目录 + 2 个文件，全部平铺在根目录，缺乏语义分组 |

---

## 1. 决策概览

将 11 个卷按核心主题归入 6 个功能父目录，保持每个卷内部的章节顺序和文件名不变。

```
改前:
novel/
├── vol-0-foundation/       # 零散平铺
├── vol-1-genesis/
├── vol-2-expansion/
├── vol-3-upper/
├── vol-3-lower/
├── vol-4-the-new-world/
├── vol-5-the-light-of-physics/
├── vol-6-federal-checkup/
├── vol-7-the-frontiers/
├── vol-8-the-heraldry-of-materials/
├── vol-9-the-bridge/
├── vol-10-incremental-republic/
├── appendix/
├── sisyphus-stories/
├── README.md
└── SKELETON.md

改后:
novel/
├── 01-基础设施与依赖/      ← vol-0-foundation, vol-2-expansion
├── 02-核心渲染与场景/      ← vol-1-genesis, vol-8-heraldry-of-materials
├── 03-UI交互系统/          ← vol-3-upper, vol-3-lower, vol-10-incremental-republic
├── 04-架构重构与模块化/    ← vol-4-new-world, vol-7-frontiers, vol-9-bridge
├── 05-物理引擎与环境系统/  ← vol-5-light-of-physics
├── 06-安全审计与性能优化/  ← vol-6-federal-checkup
├── appendix/
├── sisyphus-stories/
├── README.md
└── SKELETON.md
```

---

## 2. 分类依据

每个卷的 SKELETON.md 定义了一组关键词和定位，基于这些定位决定归属。

### 01-基础设施与依赖

| 卷 | 理由 |
|----|------|
| vol-0-foundation | Go 后端、测试、依赖审计——地基设施 |
| vol-2-expansion | DanceXR 对标、标签系统、术语标准化——依赖管理和外部对标 |

### 02-核心渲染与场景

| 卷 | 理由 |
|----|------|
| vol-1-genesis | PMX 加载、Babylon-MMD 集成、场景初始化——核心渲染管线 |
| vol-8-the-heraldry-of-materials | 材质分类系统演进——渲染的上层 |

### 03-UI交互系统

| 卷 | 理由 |
|----|------|
| vol-3-upper | MenuStack、样式大修、键盘导航——UI 重构 |
| vol-3-lower | 面板架构、SlideMenu、菜单发现——UI 系统深化 |
| vol-10-incremental-republic | 增量渲染架构、三路分流——UI 渲染革命 |

### 04-架构重构与模块化

| 卷 | 理由 |
|----|------|
| vol-4-the-new-world | 产品级重构、代码拆分、打包优化 |
| vol-7-the-frontiers | 深入依赖库内部（babylon-mmd/WASM）——探索模块边界 |
| vol-9-the-bridge | Wails v2→v3 框架迁移——架构层更换 |

### 05-物理引擎与环境系统

| 卷 | 理由 |
|----|------|
| vol-5-the-light-of-physics | 环境系统（天空/水面/云/粒子）和 XPBD 布料模拟 |

### 06-安全审计与性能优化

| 卷 | 理由 |
|----|------|
| vol-6-federal-checkup | 模块审计、XSS 修复、物理校准、性能优化——纯治理卷 |

---

## 3. 为什么不按章节细拆

单章内容常跨越多个主题（例如第四卷第 13 章"纹理织工"同时涉及换装、编码坑、竞态条件），硬拆会割裂故事叙事线。按卷归入功能父目录是最粗粒度最安全的方式：

- 叙事完整性不受破坏
- AI 看到 `03-UI交互系统/vol-3-upper/08-滑动的议会.md` 时，父目录名提供了强语义上下文
- 读者按故事顺序可通过父目录内卷的数字前缀自然排序

---

## 4. 影响范围

### 改动的文件

| 文件 | 改动 |
|------|------|
| `novel/README.md` | 全文重写：增加顶部目录结构图，所有章节链接增加功能父目录前缀，按功能分组展示各卷 |
| `novel/SKELETON.md` | 命名规范增加"功能父目录"分类；新增父目录→卷对照表；续写清单增加路径前缀提醒 |

### 未改动的文件

- 所有 `vol-*/NN-标题.md` 章节文件：内容不变，路径不变（仅父目录层级上移）
- `appendix/`、`sisyphus-stories/`：保持原位
- 各章之间的交叉引用：经 grep 确认无跨卷路径引用，无断裂链接

---

## 5. 注意事项

### 续写时路径变化

新章节的链接在 `README.md` 中必须包含功能父目录前缀：

```markdown
# ✅ 正确
[01-基础设施与依赖/vol-0-foundation/04-新章.md](01-基础设施与依赖/vol-0-foundation/04-新章.md)

# ❌ 错误（旧格式，路径不存在）
[vol-0-foundation/04-新章.md](vol-0-foundation/04-新章.md)
```

### 功能迁移

若某卷的叙事横跨多个功能领域（例如未来的 vol-11 同时涉及 UI 和物理），优先归入主导主题的父目录，在 `README.md` 中标注跨域说明。

---

## 6. 验证

- 所有 `move` 操作完成，卷内文件完整
- `README.md` 中所有链接已更新为新路径
- `SKELETON.md` 更新了命名规范和续写指引
- grep 确认无未更新的跨卷路径引用
