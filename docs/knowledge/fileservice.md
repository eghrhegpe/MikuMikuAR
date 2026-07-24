---
kind: fileservice
name: 统一文件服务层
category: core
scope:
  - frontend/src/core/fileservice.ts
source_files:
  - frontend/src/core/fileservice.ts
adr:
  - ADR-057
symbols:
  - encodeFileRef
  - resolveFileUrl
  - _toBase64Url
invariants:
  - base64url（无填充）编码文件名，避免 URL 路径段编码歧义
  - 文件服务器端口复用，同一目录不重复启动
tests: []
use_when:
  - 文件服务
  - 文件 URL
  - 文件编码
  - HTTP URL
  - 文件服务器
---

## 系统概览
**统一文件服务层**。集中 URL 构造逻辑，避免重复实现导致"改一处漏一处"。
所有通过 HTTP 加载模型/动作文件的函数都使用此模块。文件名采用 base64url（无填充）编码，
用于 `?f=<encoded>` 查询参数，绕开 URL 路径段编码歧义（ADR-057）。

## 核心职责
- `fileservice.ts` — 文件名编码、URL 解析、文件服务器管理。

## 对外 API（节选）
- `encodeFileRef(fileName)` — 文件名 → base64url 编码。
- `resolveFileUrl(filePath)` — 文件路径 → HTTP URL + 端口 + 目录。
  - 拆分目录/文件名 → 启动/复用文件服务器 → 构造 `?f=<base64url>` URL。

## 与其他子系统关系
- 文件服务器：`StartFileServer` / `IsolateModelDir`（`./wails-bindings`）。
- 路径归一化：`normPath`（`./utils`）。
- 被 `model-loader.ts` / `vmd-loader.ts` 调用。

## 不变量
- base64url 无填充编码：`btoa().replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')`。
- 文件服务器端口复用：同一目录不重复启动。
- URL 形态：`?f=<base64url(fileName)>`，绕开路径段编码歧义。
