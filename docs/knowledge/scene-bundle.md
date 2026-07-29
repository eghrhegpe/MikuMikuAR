---
kind: scene_bundle
name: 场景打包/解包
category: scene
scope:
  - frontend/src/scene/**
source_files:
  - frontend/src/scene/scene-bundle.ts
adr:
  - ADR-037
symbols:
  - exportSceneBundle
  - importSceneBundle
  - collectSceneAssets
invariants:
  - collectSceneAssets 收集模型/VMD/相机VMD/道具引用资源的绝对路径并去重
  - 打包时调用 Go 后端 BundleScene/SelectBundleSaveFile；解包调用 ExtractZip/SelectSceneOpenFile/LoadSceneFile
  - libraryRef 在打包/解包时重写以适配目标机器路径
tests: []
use_when:
  - 场景打包
  - 场景解包
  - 资产收集
---

## 系统概览
场景打包/解包（[doc:architecture]）。收集场景引用资源、重写 `libraryRef`、调用 Go 后端 `BundleScene` / `ExtractZip` / `LoadSceneFile` 等绑定完成打包与解包。依赖 `scene-serialize.ts` 与 `config.ts` / wails bindings。

## 核心职责
- `scene-bundle.ts` — 资产收集（去重绝对路径）、libraryRef 重写、Go 打包/解包编排

## 对外 API（节选）
- `collectSceneAssets(scene)` — 收集模型(PMX)/VMD/相机VMD/道具等引用资源的绝对路径（去重）
- 打包/解包入口（调用 wails-bindings 的 `BundleScene` / `SelectBundleSaveFile` / `ExtractZip` / `SelectSceneOpenFile` / `LoadSceneFile`）
- 依赖 `scene-serialize` 的 serialize/deserialize 与 `core/config` 的 `libraryRoot`

## 与其他子系统关系
- 依赖 `scene-serialize`（SceneFile 序列化）、`core/wails-bindings`（Go 后端）、`core/config`
