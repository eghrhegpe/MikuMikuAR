---
tier: architecture
kind: go_scene
name: Go 场景序列化与打包
category: backend
scope:
  - internal/app/scene.go
source_files:
  - internal/app/scene.go
symbols:
  - BundleScene
  - LoadLastScene
  - LoadSceneFile
  - SaveLastScene
  - SaveSceneFile
  - SelectBundleSaveFile
  - SelectSceneOpenFile
  - _bundleRelPath
  - _bundleTextureExts
  - _copyFileToZip
  - expandBundleAssets
  - findBestLibRoot
invariants:
  - SaveLastScene 经 sceneMu 串行化，防并发截断/交错写入（App 结构体 sceneMu）
  - BundleScene 先 expandBundleAssets 展开目录，再按 libRoot 相对路径收 zip；路径转换经 findBestLibRoot 对齐
  - 场景文件读写是纯字节/JSON 透传，Go 端不做业务校验（校验在前端 scene-serialize）
tests:
  - internal/app/app_test.go
use_when:
  - Go 场景保存加载 SaveSceneFile LoadSceneFile SaveLastScene
  - 场景打包 BundleScene 场景 bundle
  - 自动存档 SaveLastScene 韧性
---

# Go 场景序列化与打包

## 系统概览
场景文件持久化与打包的 Go 侧实现（`scene.go`，273 行）。负责场景 JSON 的保存/加载、最后场景自动存档（`SaveLastScene`/`LoadLastScene`）、场景 Bundle 打包（模型/贴图/动作资产收 zip）。前端序列化逻辑见 [scene-serialize 卡](./scene-serialize.md)。

## 核心职责
- `SaveSceneFile(jsonStr, path)` / `LoadSceneFile(path)` — 场景 JSON 读写（前端已序列化）。
- `SaveLastScene` / `LoadLastScene` — 自动存档（`sceneMu` 串行化写）。
- `BundleScene(targetPath, sceneJSON, assetPaths)` — 将场景 + 资产打包 zip；`expandBundleAssets` 展开目录，`findBestLibRoot` 定相对路径基座，`_bundleRelPath`/`_copyFileToZip` 落 zip。
- `SelectSceneOpenFile` / `SelectBundleSaveFile` — 对话框入口。

## 对外 API（节选）
- `SaveSceneFile(jsonStr, path string) error` — 绑定 `SaveSceneFile`。
- `LoadLastScene() (string, error)` — 启动恢复上次场景。
- `BundleScene(targetPath, sceneJSON string, assetPaths []string) error` — 场景打包。

## 与其他子系统关系
- 前端场景序列化：`scene-serialize.ts` 产出 JSON，Go 侧透传存储（ADR-198 保存韧性）。
- 打包资产遍历依赖 `go-library.md` 的库扫描结果确定相对路径。

## 前端接入入口
- 场景菜单 → 保存/加载场景（`scene-menu.ts`、`scene-serialize.ts`）。
- 场景 Bundle 导出：`scene-bundle.ts`。

## 不变量
- 自动存档必须串行（sceneMu），否则多场景快速切换会截断/交错。
- Bundle 内路径必须相对 libRoot，禁止绝对路径污染 zip（跨机器还原保证）。

## 验证入口
- 测试：`internal/app/app_test.go`。
- 命令：`go test ./internal/app/ -run "Scene|Bundle"`。
