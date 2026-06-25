# MikuMikuAR — 跨平台 MMD PMX 模型查看器

基于 **Wails (Go) + babylon-mmd** 的跨平台 MMD PMX 模型查看器，支持模型加载、动作播放、物理模拟与本地模型库管理。

## 特性

- **PMX/PMD 模型加载** — 基于 babylon-mmd，支持完整 MMD 渲染管线
- **VMD 动作播放** — 加载 motion 数据驱动模型动画
- **WASM Bullet 物理** — 刚体/关节模拟，裙子/头发自然晃动
- **本地模型库** — 文件系统管理，支持 DanceXR 文件夹共用
- **跨平台** — Windows / macOS / Linux（Android 规划中）

## 快速开始

```bash
cd MikuMikuAR
wails dev
```

## 技术栈

| 层级 | 选型 |
|------|------|
| 桌面壳 | [Wails](https://wails.io) v2 (Go) |
| 前端 | Vite + TypeScript |
| 3D 渲染 | [Babylon.js](https://www.babylonjs.com/) + [babylon-mmd](https://github.com/liudpfork/babylon-mmd) |
| 物理引擎 | WASM Bullet |

## 文档

- [需求文档](docs/requirements.md)

## 许可

MIT
