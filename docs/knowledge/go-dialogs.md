---
tier: leaf
kind: go_dialogs
name: Go 文件对话框封装
category: backend
scope:
  - internal/dialogs/file_dialog.go
source_files:
  - internal/dialogs/file_dialog.go
symbols:
  - OpenFile
  - SaveFile
  - SelectAudio
  - SelectBundleSave
  - SelectDir
  - SelectEnvTexture
  - SelectExe
  - SelectImport
  - SelectLibraryDir
  - SelectMotionPresetOpen
  - SelectMotionPresetSave
  - SelectPMX
  - SelectPresetOpen
  - SelectPresetSave
  - SelectRetarget
  - SelectSceneOpen
  - SelectSceneSave
  - SelectVMD
  - SelectVPD
  - audioFilters
  - envTextureFilters
  - exeFilters
  - importFilters
  - motionPresetFilters
  - pmxFilters
  - presetFilters
  - retargetFilters
  - sceneFilters
  - vmdFilters
  - vpdFilters
invariants:
  - 所有对话框走 Wails v3 application.Dialog，禁止自绘/混用平台原生 API
  - 过滤器集中定义（pmx/import/vmd/vpd/audio/envTexture/exe/preset/scene/bundle），新增类型在此登记
  - SelectDir 在安卓会被框架翻译成 SAF 建树（应避免，见 android-file-access 卡）
tests: []
use_when:
  - Go 文件对话框 OpenFile SaveFile SelectDir
  - 打开选择 PMX VMD 音频 预设 场景 文件过滤器
---

# Go 文件对话框封装

## 系统概览
Wails v3 原生文件对话框封装（`internal/dialogs/file_dialog.go`）。按用途提供类型化选择器（`SelectPMX`/`SelectVMD`/`SelectPreset*`/`SelectBundleSave` 等），统一过滤器定义。被 `internal/app` 的 `selectFile` 分发层调用。

## 核心职责
- `OpenFile(wailsApp, title, filters, startDir)` / `SaveFile(...)` — 通用开/存对话框。
- `SelectDir(wailsApp, title, startDir)` — 目录选择。
- 各 `Select*` 类型化入口 — 复用集中定义的过滤器（pmx/import/vmd/vpd/audio/envTexture/exe/retarget/preset/scene/bundle）。

## 对外 API（节选）
- `SelectPMX(wailsApp, startDir) (string, error)` — 选 PMX 文件。
- `SelectDir(wailsApp, title, startDir) (string, error)` — 选目录（安卓注意 SAF 建树）。

## 与其他子系统关系
- 被 `internal/app/app.go`（`selectFile` + 各 Select 绑定）调用。
- 前端 `go-adapter.ts` 能力矩阵 `fsSelectDir` 决定是否弹目录选择（安卓 false）。

## 不变量
- 过滤器集中声明，新增文件类型在 `file_dialog.go` 登记而非调用处散落。
- 安卓端 SelectDir 属应避免路径（framework SAF），新功能目录选择优先 `os.ReadDir` shared 模式。

## 验证入口
- 无单测（依赖 Wails 运行时），手动验证绑定。
