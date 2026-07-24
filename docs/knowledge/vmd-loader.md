---
kind: vmd_loader
name: VMD 动作加载器
category: motion
scope:
  - frontend/src/scene/motion/vmd-loader.ts
source_files:
  - frontend/src/scene/motion/vmd-loader.ts
adr: []
symbols:
  - loadVMDMotion
  - isValidVmd
  - _vmdLoadGenMap
invariants:
  - per-model generation counter 防止异步竞态
  - VMD 签名前缀校验防止损坏文件
  - 同名伴音缓存避免重复加载
tests: []
use_when:
  - VMD 加载
  - 动作文件导入
  - 伴音自动加载
  - 动作时长
  - 文件格式校验
  - 动作播放开始
---

## 系统概览
**VMD 动作文件加载与播放入口**。负责读取 VMD 文件、校验签名、加载到 MMD runtime，
启动播放并关联伴音。使用 per-model generation counter 防止多模型同时加载时的异步竞态。

## 核心职责
- `vmd-loader.ts` — VMD 文件加载、格式校验、伴音自动关联、播放启动、状态更新。

## 对外 API（节选）
- `loadVMDMotion(filePath, modelId?, options?)` — 加载 VMD 文件到指定模型。
- `isValidVmd(data)` — 校验 ArrayBuffer 是否为合法 VMD（检查 "Vocaloid Motion Data 0002" 签名）。
- `VMD_SIGNATURE` / `VMD_HEADER_MIN` — 文件校验常量。

## 与其他子系统关系
- 使用 `babylon-mmd` 的 `VmdLoader` / `MmdWasmAnimation`。
- 伴音加载：`@/outfit/audio.loadAudioFile`。
- 相机 VMD：`../camera/camera.loadCameraVmd`。
- 动作意图：`./motion-intent.replaceDefaultMotion`。
- 文件读取：`@/core/wails-bindings.readFileBytes`。
- 文件引用：`@/core/fileservice.encodeFileRef`。
- 加载指示：`@/core/utils.withLoadingIndicator`。

## 不变量
- per-model `_vmdLoadGenMap`：每次 `loadVMDMotion` 调用递增，await 后检查防止过期。
- 同名伴音缓存 `_companionAudioCache`：同一文件只加载一次伴音。
- VMD 签名校验失败时返回 `false`，不触发后续逻辑。
