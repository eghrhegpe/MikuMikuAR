# AI 行为约束（必须遵守）

## 一、目录规范：10 章 + 附录

本目录的章节文件**必须且只能**放入以下 10 个顶级文件夹之一，或 `appendix/` 下的 4 个分组之一，优先利用已有文档，已有文件夹。

> **映射表唯一事实源**：10 个顶级文件夹 ↔ `frontend/src/` 代码目录、附录 4 组的主题与典型内容，由 `scripts/gen-novel-index.mjs` 扫描生成，完整映射见 [README.md](./README.md)（目录结构总览）。此处**不手维护映射表**——改映射请改脚本常量 `MAIN_CHAPTERS` / `APPENDIX_GROUPS`，再跑 `npm run gen:novelindex` 同步 README，避免双源漂移。

具体路由决策（改了代码 → 命中哪一章）见第二节。

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

## 六、写作标杆

**标杆章节：[07-环境渲染/02-天穹之图](07-环境渲染/02-天穹之图.md)**

AI 写作时必须以此为基准，确保以下七个维度达标：

| 维度 | 要求 |
|------|------|
| 叙事主体 | 桌面壳（系统人格）作为叙事者，外交官通过对话推动发现 |
| Bug 驱动 | 第一章第一段必须呈现 bug 的结果（"屏幕是黑的"），不是背景描述 |
| 情感弧线 | 至少包含"困惑→发现→感慨"三个情感节点 |
| 对话 | 至少有一个对话推动情节转折，不是装饰性对话 |
| 代码嵌入 | 代码嵌入排查过程，是角色正在读的东西，不是引用附注 |
| 反思隐喻 | 尾声用空间/物理隐喻收束，不用总结金句 |
| 精确细节 | 至少包含一个能让读者"看到"的精确数字（如"2 像素宽、256 像素高"） |
