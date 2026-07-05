# AI 行为约束（必须遵守）

## 一、目录规范：10 章 + 附录

本目录的章节文件**必须且只能**放入以下 10 个顶级文件夹之一，或 `appendix/` 下的 4 个分组之一。

10 个顶级文件夹与 `frontend/src/` 代码目录一一对应：

| 章号 | 文件夹 | 对应代码目录 | 主题 |
|------|--------|------------|------|
| 01 | `01-基础设施与依赖/` | `frontend/src/core/` | 共享状态、配置、文件URL、图标、UI helpers、快捷键路由 |
| 02 | `02-UI交互/` | `frontend/src/menus/` | MenuStack、弹窗、设置页、模型库UI、动作UI、环境UI、场景UI |
| 03 | `03-动作演算/` | `frontend/src/motion/` | 程序化动作、VMD写入、VPD解析、节拍检测、LipSync算法 |
| 04 | `04-音频与换装/` | `frontend/src/outfit/` | 音频播放、VMD同步、节拍挂载、换装系统、纹理变体 |
| 05 | `05-布料物理/` | `frontend/src/physics/` | XPBD求解器、布料生成、SDF碰撞、调试可视化、布料管理器 |
| 06 | `06-相机移动/` | `frontend/src/scene/camera/` | 相机模式、自由飞行、相机VMD轨道 |
| 07 | `07-环境渲染/` | `frontend/src/scene/env/` | 天空、地面、雾、云、水、粒子、风、环境预设、光照推导 |
| 08 | `08-模型管理/` | `frontend/src/scene/manager/` | 模型注册表、PMX加载、缩略图、材质系统、模型操作、预设 |
| 09 | `09-程序化动作/` | `frontend/src/scene/motion/` | VMD加载播放、程序化动作桥接、LipSync桥接、播放控制 |
| 10 | `10-灯光与阴影/` | `frontend/src/scene/render/` | 渲染管线、灯光、阴影、性能降级、后处理 |

`appendix/` 下分 4 组，收纳非代码目录锚定的章节：

| 分组 | 主题 | 典型内容 |
|------|------|---------|
| `appendix/跨模块重构/` | 多模块同时动刀的工程事件 | 八城审计、瘦身日、八城之盟、中段清算、审计报告 |
| `appendix/文档演进/` | 文档/测试体系本身的发展 | 绘图师、读图、议会与织工、试金石、审计之光、伪影与真镜、代码的镜厅 |
| `appendix/Go后端/` | Go 代码与 Wails 框架 | 地下管道、西西弗斯之夜、断桥重建 |
| `appendix/安全横切/` | 横切多模块的安全问题 | XSS攻坚战、追赶者的阴影、路径的陷阱 |

## 二、AI 决策链路（核心规则）

**改了代码 → 看路径前缀 → 命中 01-10 某一章 → 直接去更新该章尾部。**

```
frontend/src/core/              → 01-基础设施与依赖
frontend/src/menus/             → 02-UI交互
frontend/src/motion/            → 03-动作演算
frontend/src/outfit/            → 04-音频与换装
frontend/src/physics/           → 05-布料物理
frontend/src/scene/camera/      → 06-相机移动
frontend/src/scene/env/         → 07-环境渲染
frontend/src/scene/manager/     → 08-模型管理
frontend/src/scene/motion/      → 09-程序化动作
frontend/src/scene/render/      → 10-灯光与阴影

app.go / internal/ / main.go / Wails 配置 / Taskfile.yml → appendix/Go后端/
AGENTS.md / docs/*.md / reusables.md / SKELETON.md       → appendix/文档演进/
tests/ / .github/ / CI / Vitest                           → appendix/文档演进/
跨多个模块同时动刀（审计/重构/清算）                          → appendix/跨模块重构/
安全/路径/XSS 横切问题                                      → appendix/安全横切/
```

**判断优先级**：单一模块命中 01-10 > 跨模块归 appendix/跨模块重构/ > 文档归 appendix/文档演进/ > Go 归 appendix/Go后端/。

## 三、禁止行为

- ❌ **严禁在 `novel/` 根目录创建新的 `.md` 文件**（`README.md` / `SKELETON.md` / `AGENTS.md` 除外）
- ❌ **严禁创建新的顶级文件夹**（10 章 + `appendix/` 已锁定）
- ❌ **严禁在 `appendix/` 下创建新的分组**（4 组已锁定）
- ✅ 新增章节时，根据改动的代码目录放入对应章，附录内容放入对应分组
- ✅ 文件名按 `NN-标题.md` 命名，两位数字编号
- ✅ 章节文件内推荐标准如下，章名不写编号，背景与过程需精炼。
# {章名}

> **背景**：{≤35字为什么}
>
> **过程**：{≤25字做了什么}

## 四、卷号与目录解耦

- **物理目录**服从"代码目录锚定"（10 章 + appendix）
- **叙事卷号**（vol-0 ~ vol-10）是叙事时间线，在章节文件内顶部标题保留，在 `README.md` 映射表中维护
- 两套体系互不干扰：AI 按物理目录定位章，读者按卷号读叙事

## 五、现有章节索引

各章详细映射详见 [README.md](./README.md) 。
世界观模板详见 [SKELETON.md](./SKELETON.md) 。
