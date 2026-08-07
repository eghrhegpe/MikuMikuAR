---
tier: architecture
adr:
  - ADR-189
kind: go_library
name: Go 模型库扫描
category: backend
scope:
  - internal/app/library.go
source_files:
  - internal/app/library.go
symbols:
  - GetModelMeta
  - GetModelMetaBatch
  - ListSubDirs
  - LoadOutfitFile
  - ScanModelDir
  - SelectDir
  - ToggleFavorite
  - expandZipEntries
  - formatByCategory
  - mapCategoryKey
  - maxZipEntryCount
  - maxZipEntryFileSize
  - maxZipTotalBytes
  - scanAllCategories
  - scanDirByExt
  - totalUncompressedZipSize
invariants:
  - 8 个资源分类各一个 goroutine 并行扫描，结果合并返回；调用方必须消费完整切片
  - expandZipEntries 用 totalUncompressedZipSize 预检 ZIP 解压总量，防止 ZIP 炸弹解压失控
  - bestDecode 兜底 Shift-JIS/GBK 乱码解码（与 zipextract.go 共享），改名后须同步两侧
tests:
  - internal/app/app_test.go
use_when:
  - Go 模型库扫描 ScanModelDir 资源分类
  - 模型元数据 GetModelMeta GetModelMetaBatch
  - 资源根目录 SelectDir
  - ZIP 内部条目展开 expandZipEntries
---

# Go 模型库扫描

## 系统概览
资源库扫描的 Go 侧实现：按 8 个分类（model/motion/audio/pose/scene/environment/outfit/prop）并行扫描目录树，识别扩展名与 ZIP 内部条目（PMX/VMD/Audio/VPD），返回统一 `ModelEntry` 列表供前端资源库渲染；按需解析 PMX 头部返回 `ModelMeta`。

## 核心职责
- `ScanModelDir()` — 触发全量扫描，8 分类各一 goroutine 并行，`scanAllCategories` 合并结果。
- `expandZipEntries()` — 打开 ZIP 识别内部可导入文件，Shift-JIS/GBK 用 `bestDecode()` 解码文件名。
- `GetModelMeta(path)` / `GetModelMetaBatch(paths)` — 按需解析 PMX 头部（走 `internal/util/pmx.go` 的 `ParsePMXHeader`）。
- `LoadOutfitFile` — 返回换装文件内容。
- `ToggleFavorite` — 收藏标记（写入配置）。

## 对外 API（节选）
- `ScanModelDir() ([]ModelEntry, error)` — 全库扫描主入口（绑定 `ScanModelDir`）。
- `GetModelMetaBatch(paths []string) (map[string]ModelMeta, error)` — 批量元数据，前端缩略图/详情用。
- `SelectDir() (string, error)` — 弹目录选择（安卓经 `fileaccess` 能力守卫，见 android-file-access 卡）。

## 与其他子系统关系
- 前端资源库：`frontend/src/menus/library*.ts` 调用 `ScanModelDir` / `GetModelMetaBatch`。
- 依赖 `internal/util/pmx.go`（PMX 头解析）、`internal/dialogs`（SelectDir）。
- 与 `go-zipextract.md` 共享 `bestDecode` 编码兜底逻辑。

## 前端接入入口
- 资源库菜单 → 加载资源库（`library-setup.ts` / `library-core.ts`）。
- 模型详情/缩略图：`model-detail.ts`、`thumbnail-capture.ts` 走 `GetModelMetaBatch`。

## 不变量
- 分类枚举与前端 `mapCategoryKey` 期望一致；新增分类须同步前端渲染与 `formatByCategory`。
- 扫描结果必须按返回顺序消费，不可依赖 goroutine 完成顺序。

## 验证入口
- 测试：`internal/app/app_test.go`（含 `bestDecode` 用例）。
- 命令：`go test ./internal/app/ -run TestApp`。
