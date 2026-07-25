## CORS：Wails WebView 跨域被拦

> **状态**: 🟢 已修复

**日期**: 2026-07-09
**严重程度**: 🔴 P1（功能破坏，模型文件无法加载）
**影响范围**: `internal/app/app.go` → `StartFileServer`（Go HTTP 服务器）
**发现方式**: 开发发现
**修复方案**: `corsMiddleware` 给所有响应加 `Access-Control-Allow-Origin: *`

### 错误信息
```
Access to XMLHttpRequest at 'http://127.0.0.1:39989/model.pmx'
from origin 'http://wails.localhost:34115' has been blocked by CORS policy
```

### 根因
`wails3 dev` 使用 `http://wails.localhost:34115` 作为页面源，Go HTTP 服务器在 `127.0.0.1:PORT`，浏览器视为跨域。

### 修复
`app.go:StartFileServer` 中的 `corsMiddleware` 给所有响应加 `Access-Control-Allow-Origin: *`。

---
