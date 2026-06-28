---
name: babylon-mmd-helper
description: Babylon.js MMD 前端开发助手。当需要修改前端渲染、场景、菜单、UI、材质、换装系统、动作/VMD 同步、模型库时使用。触发词：改前端、Babylon.js、MMD、修复渲染、添加菜单、材质调节、换装、VMD、模型库。
agent_created: true
---

# Babylon.js MMD 前端开发助手

本 skill 提供 MikuMikuAR 前端开发的约定、文档地图和常见任务工作流。

## 核心原则

1. **只读文档地图列出的文件** - 禁止递归扫描 `docs/`、禁止读取 `docs/research/`（除非明确指定）
2. **先读后改** - 禁止基于记忆修改，每次改前用 `read_file` 或 `grep` 确认最新状态
3. **小步快跑** - 一个修改一个 build，不攒多个修改
4. **失败熔断** - 同一命令连续失败 2 次 → 停止并分析原因

## 文档地图速查

### 前端相关文档

| 任务 | 优先读 | 其次读 |
|------|--------|--------|
| 前端渲染/场景 | `docs/architecture.md` §渲染环节 | `frontend/src/scene/scene.ts` |
| 菜单/弹窗/UI | `docs/menu-architecture.md` | `frontend/src/menus/menu.ts` |
| 换装/纹理变体 | `docs/architecture.md` §16 | `frontend/src/outfit/outfit.ts` |
| 材质调节 | `docs/architecture.md` §材质系统 | `frontend/src/scene/scene-material.ts` |
| 模型详情 | `docs/architecture.md` | `frontend/src/menus/model-detail.ts` |
| 模型库/扫描/zip | `docs/architecture.md` §模型库管理 | `frontend/src/menus/library-core.ts` |
| 动作/VMD 同步 | `docs/architecture.md` §VMD 环节 | `frontend/src/outfit/audio.ts` |
| 程序化动作 | `docs/architecture.md` | `frontend/src/motion/procedural-motion.ts` |
| VPD 姿势导入 | `docs/architecture.md` | `frontend/src/motion/vpd-parser.ts` |
| LipSync | `docs/architecture.md` | `frontend/src/motion/lipsync.ts` |
| 环境/天空/粒子 | `docs/architecture.md` §环境系统 | `frontend/src/menus/env-menu.ts` |
| 修复前端问题 | `docs/troubleshooting.md` | `docs/fix-cycle.md` |
| 新增函数 | `docs/reusables.md` | — |

完整地图见 `references/frontend-doc-map.md`。

## 工作流

### 前端构建验证

```bash
cd MikuMikuAR/frontend && npx vite build 2>&1
```

### 修复周期

1. 读 `docs/fix-cycle.md` 了解修复流程
2. 重现问题 → 定位根因 → 提出方案 → 用户确认 → 实施 → 构建验证

### 添加新菜单项

1. 读 `docs/menu-architecture.md` 了解 MenuStack 用法
2. 在对应菜单文件添加项（如 `frontend/src/menus/scene-menu.ts`）
3. 实现功能 → 构建验证

## 项目结构（前端部分）

```
MikuMikuAR/frontend/
├── src/
│   ├── scene/              # Babylon.js 场景
│   │   ├── scene.ts        # 主场景
│   │   ├── camera.ts      # 相机控制
│   │   ├── scene-material.ts   # 材质系统
│   │   ├── scene-model.ts  # 模型管理
│   │   └── env-lighting.ts # 环境光照
│   ├── menus/              # UI 菜单
│   │   ├── menu.ts         # MenuStack 基础
│   │   ├── scene-menu.ts   # 场景菜单
│   │   ├── model-detail.ts # 模型详情
│   │   ├── model-material.ts  # 材质调节
│   │   ├── outfit-ui.ts    # 换装 UI
│   │   ├── library.ts      # 模型库
│   │   ├── env-menu.ts     # 环境菜单
│   │   └── motion-popup.ts # 动作库弹窗
│   ├── motion/             # 动作系统
│   │   ├── procedural-motion.ts  # 程序化动作
│   │   ├── beat-detector.ts      # 节拍检测
│   │   ├── vpd-parser.ts         # VPD 姿势
│   │   └── lipsync.ts            # LipSync
│   ├── core/               # 核心服务
│   │   └── fileservice.ts  # 文件 URL/HTTP 服务器
│   ├── outfit/             # 换装系统
│   │   ├── outfit.ts       # 换装逻辑
│   │   └── audio.ts        # 音频同步
│   └── app.css             # 全局样式
└── package.json
```

## 关键约定

### TypeScript 代码风格
- 严格模式，禁止 `any`
- 使用 Babylon.js 官方 API
- 遵循 `docs/terminology.md` 中的命名规范

### CSS 类命名
- 遵循 `docs/menu-architecture.md` 中的类命名规范
- 菜单项使用 `menuItem` 类
- 弹窗使用 `popup` 类

### 前端构建
- 在 `MikuMikuAR/frontend/` 目录执行
- 使用 `npx vite build` 验证

## 常见任务模板

### 任务：修复渲染问题

1. 读 `docs/troubleshooting.md` 排查常见问题
2. 检查浏览器控制台错误
3. 定位相关代码（查文档地图）
4. 提出修复方案 → 用户确认
5. 实施 → `npx vite build` 验证

### 任务：添加新功能菜单

1. 读 `docs/menu-architecture.md` 了解如何添加
2. 在对应菜单文件添加项
3. 实现功能函数
4. 构建验证

### 任务：修改材质系统

1. 读 `docs/architecture.md` §材质系统
2. 修改 `frontend/src/scene/scene-material.ts`
3. 测试不同模型

### 任务：添加换装变体

1. 创建 `outfits.json`
2. 实现纹理加载逻辑
3. 更新 `frontend/src/outfit/outfit.ts`

## 调试技巧

### 场景不显示
- 检查控制台错误
- 验证 PMX 文件路径
- 检查 HTTP 服务器是否启动
- 查看 `frontend/src/core/fileservice.ts`

### 动作不同步
- 检查音频加载状态
- 验证 VMD 文件格式
- 查看 `syncAudioPlayback` 逻辑
- 检查 `frontend/src/outfit/audio.ts`

### 材质不生效
- 检查材质索引
- 验证纹理路径
- 查看 `setMatParams` 调用
- 检查 `frontend/src/scene/scene-material.ts`

### 菜单不显示
- 检查 MenuStack 状态
- 验证 CSS 类
- 查看 `build*Level` 函数
- 检查 `frontend/src/menus/menu.ts`

### 换装不生效
- 检查 `outfits.json` 格式
- 验证纹理路径
- 查看 `frontend/src/outfit/outfit.ts` 逻辑

## 复用函数

写新函数前，先查 `docs/reusables.md` 确认是否已存在类似函数。

常见前端复用函数：
- Babylon.js 辅助函数
- UI 组件
- 文件操作
- HTTP 请求

## 参考资料

- 完整前端文档地图: `references/frontend-doc-map.md`
- 菜单架构指南: `docs/menu-architecture.md`
- 复用函数索引: `docs/reusables.md`
- 术语表: `docs/glossary.md`
- 代码级规范: `docs/terminology.md`

---

**使用本 skill**: 当用户提出 MikuMikuAR 前端相关开发任务时，自动加载本文档，按文档地图定位文件，遵循工作流执行任务。
