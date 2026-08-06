---
tier: architecture
kind: go_presets
name: Go 预设持久化与标签
category: backend
scope:
  - internal/app/env_preset.go
  - internal/app/model_preset.go
  - internal/app/motion_preset.go
  - internal/app/render_preset.go
  - internal/app/scene_preset.go
  - internal/app/tags.go
source_files:
  - internal/app/env_preset.go
  - internal/app/model_preset.go
  - internal/app/motion_preset.go
  - internal/app/render_preset.go
  - internal/app/scene_preset.go
  - internal/app/tags.go
symbols:
  - AddTag
  - DeleteEnvPreset
  - DeleteModelPreset
  - DeleteMotionPreset
  - DeletePresetScene
  - DeleteRenderPreset
  - EnvPresetEntry
  - GetAllTags
  - GetLibraryIndex
  - GetModelPresets
  - GetModelsByTag
  - GetMotionPresets
  - GetPresetScenes
  - GetPresetScenesDir
  - GetRenderPresets
  - GetTagsByModel
  - ListEnvPresets
  - LoadEnvPreset
  - LoadModelPreset
  - LoadModelPresetFromLib
  - LoadMotionPreset
  - LoadMotionPresetFromLib
  - ModelPresetEntry
  - MotionPresetEntry
  - RemoveTag
  - RenameModelPreset
  - RenameMotionPreset
  - SaveEnvPreset
  - SaveEnvPresetAuto
  - SaveModelPreset
  - SaveModelPresetToLib
  - SaveModelPresetToLibAuto
  - SaveMotionPreset
  - SaveMotionPresetToLib
  - SaveMotionPresetToLibAuto
  - SaveRenderPreset
  - SaveScenePreset
  - SelectMotionPresetOpenFile
  - SelectMotionPresetSaveFile
  - SelectPresetOpenFile
  - SelectPresetSaveFile
  - autoNumberedSave
  - deletePresetFile
  - envPresetsDir
  - indexRelevantChanged
  - modelPresetDir
  - motionPresetDir
  - parseLibraryIndex
  - presetDir
  - scenePresetDir
  - validatePresetName
  - writeConfig
  - writeIndexAfterScan
invariants:
  - 预设名经 validatePresetName 清洗（防路径穿越/非法字符），保存路径必须经 presetDir 派生
  - 库内预设（ToLib/FromLib）与用户预设文件（Save*/Load*）两套命名空间，不可混用
  - 配置型预设（模型/渲染等）写入后须 writeConfigAndRescan 触发前端刷新
  - 删除/重命名预设必须原子：先落盘再清内存索引（GetModelPresets/GetMotionPresets 读缓存）
tests:
  - internal/app/app_test.go
use_when:
  - Go 预设 保存加载 环境预设 模型预设 动作预设 渲染预设 场景预设
  - 标签系统 AddTag GetTagsByModel
  - 库内预设模型 GetModelPresets SaveModelPresetToLibAuto
---

# Go 预设持久化与标签

## 系统概览
五类预设（环境/模型/动作/渲染/场景）与资源标签的 Go 侧持久化（6 个文件）。统一 `presetDir(subDir)` 派生目录、`autoNumberedSave` 自动编号命名、`validatePresetName` 名称清洗；库内预设（保存到资源库）与用户文件预设并存。模型预设额外承载 `GetLibraryIndex`（库索引解析）。

## 核心职责
- `env_preset.go` — 环境预设保存/自动保存/加载/列表/删除。
- `model_preset.go` — 模型预设（文件 + 库内 ToLib/FromLib）+ `writeConfig`/`writeConfigAndRescan` + `GetLibraryIndex`/`parseLibraryIndex`。
- `motion_preset.go` — 动作预设（文件 + 库内）。
- `render_preset.go` — 渲染预设保存/列表/删除。
- `scene_preset.go` — 场景预设（`presetDir`/`autoNumberedSave`/`deletePresetFile` 共享工具）。
- `tags.go` — 标签增删查 + 按标签反查模型。

## 对外 API（节选）
- `SaveEnvPresetAuto(jsonStr) (string, error)` — 自动编号保存并返回文件名。
- `GetModelPresets() []ModelPresetEntry` — 库内模型预设列表（前端模型预设 UI）。
- `GetLibraryIndex() ([]ModelEntry, error)` — 资源库索引（前端 library 用）。
- `GetPresetScenes() []string` — 场景预设列表。

## 与其他子系统关系
- 前端预设 UI：`model-preset-ui.ts`、`motion-preset-ui`、`settings` 相关页调用。
- 场景预设联动 `go-scene.md` 的 `LoadSceneFile`。

## 前端接入入口
- 模型菜单 → 模型预设；动作菜单 → 动作预设；场景菜单 → 场景预设（`model-preset-ui.ts`、`motion-binding-ui.ts`）。
- 标签管理：资源库菜单（`library-actions.ts`）。

## 不变量
- 用户输入路径必须 `validatePresetName`，任何预设名不得直接拼进文件路径。
- 「库内」与「文件」预设命名空间分离，同名不互覆。
- 模型/渲染预设变更后触发 rescan/刷新，否则前端库视图过期。

## 验证入口
- 测试：`internal/app/app_test.go`（`validatePresetName` 等）。
- 命令：`go test ./internal/app/ -run "Preset|Tag|Index"`。
