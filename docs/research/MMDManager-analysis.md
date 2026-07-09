# MMDManager 分析

> https://github.com/guozihang/gzhlaker_mmdmanager
> 51 commits, 26 releases, 4 stars
> License: 未声明（默认 All Rights Reserved）

---

## 概述

MMDManager 是一个**桌面端 MMD 资源管理器**，而非编辑器。支持拖拽导入、3D 预览、批量截图、一键导出到 MMD 软件。定位介于文件管理器和轻量查看器之间。

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | Electron |
| 前端框架 | Vue 2 + Vue Router + Vuex |
| UI 库 | Element UI |
| 3D 渲染 | Three.js + MMDLoader |
| 语言 | JavaScript 97.6% / HTML 2.3% / CSS 0.1% |

---

## 核心功能

| 功能 | 说明 |
|------|------|
| 拖拽导入 | 多文件夹拖入，自动分类到模型/场景/VMD/MME |
| 3D 预览 | 点击"模"加载模型，鼠标旋转/缩放/平移 |
| 自动截图 | 导入或加载模型后自动生成预览缩略图 |
| 预览悬浮 | 鼠标悬停"模"按钮显示大图，缩略图模式直接展示 |
| VMD 播放 | 点击"动"播放动作，未加载模型时自动加载默认模型 |
| 导出到 MMD | 右键"模"或"动"发送到 MMD 软件，贴图正常加载 |
| 软件管理 | `software/` 目录放入 `.exe` 自动识别到菜单栏 |
| 批量导入 | 多文件夹拖入时弹出列表对话框，逐个选择模型/场景 |
| 进度条 | 导入时右上角显示实时进度 |
| 分页 | 可配置每页显示数量 |

---

## 目录结构

```
gzhlaker_mmdmanager/
├── main.js           # Electron 主进程
├── preload.js        # 预加载脚本（IPC 桥接）
├── index.html        # 主页面
├── package.json
├── css/              # 样式
├── js/
│   ├── main.js       # 入口 / 导入逻辑
│   ├── components.js # Vue 组件
│   ├── show.js       # Three.js 3D 渲染
│   ├── manager.js    # 路径管理
│   └── lib/          # 第三方库
├── data/             # 用户数据（模型/场景/VMD/MME）
├── software/         # 可执行程序（菜单栏自动识别）
└── project/          # 工程文件
```

---

## 3D 预览实现

核心在 `js/show.js`（Three.js 渲染）和 `js/lib/`（第三方库）。使用 Three.js 的 `MMDLoader` 加载 PMX/PMD 模型，通过 `THREE.AnimationMixer` 播放 VMD 动作。

---

## 与 MikuMikuAR 的对比

| | MMDManager | MikuMikuAR |
|--|-----------|------------|
| 定位 | 资源管理 + 预览 | MMD 编辑工具 |
| 技术栈 | Electron + Vue 2 | Wails (Go + WebView2) + TypeScript |
| 3D 引擎 | Three.js + MMDLoader | Babylon.js + babylon-mmd |
| 编辑功能 | ❌ | ✅ |
| 资源管理 | ✅ | 待定 |
| 开源 | ✅ (无 License 声明) | ✅ |

---

## 参考价值

- **Three.js MMDLoader 使用方式** — 资源预览的加载逻辑
- **Electron + Vue 2 项目结构** — 作为 Electron 项目参考
- **拖拽导入 + 自动分类** — 文件管理逻辑
- **缩略图生成** — Three.js 渲染后截图保存